//! Token 用量上报队列：离线容错 + refresh token 自动续期。
//!
//! 工作流程：
//! 1. 后台线程每 60s 读取 Codex / Cursor 本地状态，与上次记录比对。
//! 2. 若 `tokens_used` 或 `latest_thread_id` 变化，构造 `UsageEvent` 入队。
//! 3. 队列持久化到 `~/.agent-light/usage-queue.json`，进程重启不丢。
//! 4. 排空线程向 `POST /api/usage/codex-thread` 发送事件：
//!    - 200：出队
//!    - 401：调用 `/api/auth/refresh` 续期，更新本地 session 后重试一次
//!    - 其他失败：保留在队列，退避后重试
//! 5. 不上传 cwd / rollout_path（schema 已 .strict() 拒绝多余字段）。

use crate::{
    cloud_session_path, platform, save_cloud_session_impl, timestamp_ms, CloudSessionSnapshot,
    CodexStatusSnapshot, CommandError,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

static REFRESH_LOCK: Mutex<()> = Mutex::new(());
static USAGE_QUEUE: OnceLock<Arc<UsageQueue>> = OnceLock::new();
use std::thread;
use std::time::{Duration, Instant};

const SYNC_POLL_INTERVAL: Duration = Duration::from_secs(60);
const USAGE_STATUS_LOG_COOLDOWN: Duration = Duration::from_secs(300);
const SYNC_DRAIN_INTERVAL: Duration = Duration::from_secs(15);
const SYNC_MAX_BACKOFF: Duration = Duration::from_secs(300);
const USAGE_QUEUE_FILE_NAME: &str = "usage-queue.json";
const REFRESH_RETRY_MARGIN_SECONDS: u64 = 60;

/// 一条待上报的 token 用量事件。字段对齐 `codexThreadUsageRequestSchema`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub agent_provider: String,
    pub workspace_id: String,
    pub device_id: String,
    pub codex_thread_id: String,
    pub model: Option<String>,
    pub tokens_used: u64,
    pub thread_updated_at_ms: u64,
    pub sampled_at_ms: u64,
}

/// 上次已记录的状态指纹，用于判断是否产生新用量。
#[derive(Debug, Clone, Default)]
struct LastReported {
    thread_id: Option<String>,
    tokens_used: Option<u64>,
}

/// 持久化队列：内存 + 磁盘镜像。
pub struct UsageQueue {
    events: Mutex<Vec<UsageEvent>>,
    path: PathBuf,
}

impl UsageQueue {
    fn new(path: PathBuf) -> Self {
        let queue = Self {
            events: Mutex::new(Vec::new()),
            path,
        };
        queue.load_from_disk();
        queue
    }

    fn load_from_disk(&self) {
        if !self.path.exists() {
            return;
        }
        if let Ok(raw) = std::fs::read_to_string(&self.path) {
            if let Ok(events) = serde_json::from_str::<Vec<UsageEvent>>(&raw) {
                if let Ok(mut guard) = self.events.lock() {
                    *guard = events;
                }
            }
        }
    }

    fn persist_to_disk(&self) {
        let snapshot = match self.events.lock() {
            Ok(guard) => guard.clone(),
            Err(_) => return,
        };
        let parent = match self.path.parent() {
            Some(dir) => dir,
            None => return,
        };
        if create_dir_all(parent).is_err() {
            return;
        }
        let json = match serde_json::to_string(&snapshot) {
            Ok(text) => text,
            Err(_) => return,
        };
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)
        {
            let _ = file.write_all(json.as_bytes());
        }
    }

    fn push(&self, event: UsageEvent) {
        if let Ok(mut guard) = self.events.lock() {
            guard.push(event);
        }
        self.persist_to_disk();
    }

    fn drain<F>(&self, mut sender: F)
    where
        F: FnMut(&UsageEvent) -> SendOutcome,
    {
        let mut guard = match self.events.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let mut index = 0;
        while index < guard.len() {
            match sender(&guard[index]) {
                SendOutcome::Sent => {
                    guard.remove(index);
                }
                SendOutcome::Retry => {
                    index += 1;
                }
                SendOutcome::Stop => break,
            }
        }
        drop(guard);
        self.persist_to_disk();
    }

    fn len(&self) -> usize {
        self.events.lock().map(|g| g.len()).unwrap_or(0)
    }

    fn clear(&self) {
        if let Ok(mut guard) = self.events.lock() {
            guard.clear();
        }
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)
        {
            let _ = file.write_all(b"[]");
        }
    }
}

pub(crate) fn clear_usage_queue() {
    if let Some(queue) = USAGE_QUEUE.get() {
        queue.clear();
        return;
    }
    if let Ok(path) = usage_queue_path() {
        let _ = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .and_then(|mut file| file.write_all(b"[]"));
    }
}

enum SendOutcome {
    Sent,
    Retry,
    Stop,
}

/// 启动同步后台线程：轮询 Codex / Cursor + 排空上报队列。
pub fn start_sync_worker() {
    #[cfg(debug_assertions)]
    if std::env::var("AGENT_LIGHT_ENABLE_USAGE_SYNC")
        .ok()
        .as_deref()
        != Some("1")
    {
        eprintln!(
            "agent-light: usage sync disabled in debug build (set AGENT_LIGHT_ENABLE_USAGE_SYNC=1 to enable)"
        );
        return;
    }

    let queue_path = match usage_queue_path() {
        Ok(path) => path,
        Err(error) => {
            eprintln!("agent-light: sync disabled, cannot resolve queue path: {}", error.message);
            return;
        }
    };
    let queue = Arc::new(UsageQueue::new(queue_path));
    let _ = USAGE_QUEUE.set(Arc::clone(&queue));

    let poller_queue = Arc::clone(&queue);
    thread::spawn(move || {
        eprintln!("agent-light: sync poller started");
        let mut last_reported: HashMap<String, LastReported> = HashMap::from([
            ("codex".to_string(), LastReported::default()),
            ("cursor".to_string(), LastReported::default()),
        ]);
        loop {
            thread::sleep(SYNC_POLL_INTERVAL);
            if !crate::is_cloud_sync_enabled() {
                continue;
            }
            if let Some(event) = detect_usage_delta(
                "codex",
                &platform::current().codex.read_status(),
                last_reported.entry("codex".to_string()).or_default(),
            ) {
                poller_queue.push(event);
            }
            if let Some(event) = detect_usage_delta(
                "cursor",
                &platform::current().cursor.read_status(),
                last_reported.entry("cursor".to_string()).or_default(),
            ) {
                poller_queue.push(event);
            }
        }
    });

    let drainer_queue = Arc::clone(&queue);
    thread::spawn(move || {
        eprintln!("agent-light: sync drainer started");
        let mut backoff = SYNC_DRAIN_INTERVAL;
        loop {
            thread::sleep(backoff);
            if !crate::is_cloud_sync_enabled() {
                backoff = SYNC_DRAIN_INTERVAL;
                continue;
            }
            let queue_len = drainer_queue.len();
            if queue_len == 0 {
                backoff = SYNC_DRAIN_INTERVAL;
                continue;
            }
            USAGE_QUEUE_LEN_HINT.store(queue_len, Ordering::Relaxed);
            let mut session = match platform::current().credentials.load() {
                Ok(Some(session)) => session,
                Ok(None) => continue,
                Err(_) => continue,
            };
            if is_token_expiring_soon(&session) {
                if let Some(refreshed) = refresh_session_locked(&session) {
                    if let Ok(saved) = save_cloud_session_impl(refreshed) {
                        session = saved;
                    }
                }
            }
            let outcome = drain_with_session(&drainer_queue, &session);
            backoff = match outcome {
                DrainOutcome::AllSent => SYNC_DRAIN_INTERVAL,
                DrainOutcome::Partial | DrainOutcome::NoSession => {
                    std::cmp::min(backoff * 2, SYNC_MAX_BACKOFF)
                }
            };
        }
    });
}

enum DrainOutcome {
    AllSent,
    Partial,
    NoSession,
}

fn detect_usage_delta(
    agent_provider: &str,
    snapshot: &CodexStatusSnapshot,
    last: &mut LastReported,
) -> Option<UsageEvent> {
    if !crate::is_cloud_sync_enabled() {
        return None;
    }
    let thread_id = snapshot.latest_thread_id.clone();
    let tokens_used = snapshot.tokens_used;

    let changed = thread_id.as_ref() != last.thread_id.as_ref()
        || tokens_used != last.tokens_used;
    if !changed {
        return None;
    }

    last.thread_id = thread_id.clone();
    last.tokens_used = tokens_used;

    let session = match platform::current().credentials.load() {
        Ok(Some(session)) => session,
        _ => return None,
    };
    let device_id = session.device_id.as_ref()?;
    let thread_id = thread_id?;
    let tokens_used = tokens_used?;

    Some(UsageEvent {
        agent_provider: agent_provider.to_string(),
        workspace_id: session.workspace_id.clone(),
        device_id: device_id.clone(),
        codex_thread_id: thread_id,
        model: snapshot.latest_model.clone(),
        tokens_used,
        thread_updated_at_ms: snapshot
            .thread_updated_at_ms
            .and_then(|ms| u64::try_from(ms).ok())
            .unwrap_or(0),
        sampled_at_ms: u64::try_from(timestamp_ms()).unwrap_or(0),
    })
}

fn drain_with_session(queue: &UsageQueue, session: &CloudSessionSnapshot) -> DrainOutcome {
    if session.device_id.is_none() {
        return DrainOutcome::NoSession;
    }
    let mut all_sent = true;
    let mut current_session = session.clone();

    queue.drain(|event| {
        let access_token = current_session.access_token.clone();
        match send_usage_event(&current_session.server_url, &access_token, event) {
            SendResult::Sent => SendOutcome::Sent,
            SendResult::Unauthorized => {
                match refresh_session_locked(&current_session) {
                    Some(refreshed) => {
                        current_session = refreshed.clone();
                        if let Err(error) = save_cloud_session_impl(refreshed) {
                            eprintln!("agent-light: failed to persist refreshed session: {}", error.message);
                            all_sent = false;
                            return SendOutcome::Stop;
                        }
                        match send_usage_event(&current_session.server_url, &current_session.access_token, event) {
                            SendResult::Sent => SendOutcome::Sent,
                            _ => {
                                all_sent = false;
                                SendOutcome::Retry
                            }
                        }
                    }
                    None => {
                        all_sent = false;
                        SendOutcome::Stop
                    }
                }
            }
            SendResult::Failed => {
                all_sent = false;
                SendOutcome::Retry
            }
        }
    });

    if all_sent {
        DrainOutcome::AllSent
    } else {
        DrainOutcome::Partial
    }
}

enum SendResult {
    Sent,
    Unauthorized,
    Failed,
}

static USAGE_QUEUE_LEN_HINT: AtomicUsize = AtomicUsize::new(0);
static USAGE_STATUS_ERROR_LOG: OnceLock<Mutex<HashMap<u16, (Instant, u32)>>> = OnceLock::new();

fn usage_event_payload(event: &UsageEvent) -> serde_json::Value {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "agent_provider".into(),
        serde_json::Value::String(event.agent_provider.clone()),
    );
    payload.insert(
        "workspace_id".into(),
        serde_json::Value::String(event.workspace_id.clone()),
    );
    payload.insert(
        "device_id".into(),
        serde_json::Value::String(event.device_id.clone()),
    );
    payload.insert(
        "codex_thread_id".into(),
        serde_json::Value::String(event.codex_thread_id.clone()),
    );
    if let Some(model) = &event.model {
        payload.insert("model".into(), serde_json::Value::String(model.clone()));
    }
    payload.insert(
        "tokens_used".into(),
        serde_json::Value::Number(event.tokens_used.into()),
    );
    payload.insert(
        "thread_updated_at_ms".into(),
        serde_json::Value::Number(event.thread_updated_at_ms.into()),
    );
    payload.insert(
        "sampled_at_ms".into(),
        serde_json::Value::Number(event.sampled_at_ms.into()),
    );
    serde_json::Value::Object(payload)
}

fn log_usage_report_status_error(status: u16) {
    let log_state = USAGE_STATUS_ERROR_LOG.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = match log_state.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let now = Instant::now();
    let entry = guard
        .entry(status)
        .or_insert((now - USAGE_STATUS_LOG_COOLDOWN, 0));
    entry.1 += 1;
    if now.duration_since(entry.0) < USAGE_STATUS_LOG_COOLDOWN {
        return;
    }
    let suppressed = entry.1.saturating_sub(1);
    let queue_len = USAGE_QUEUE_LEN_HINT.load(Ordering::Relaxed);
    if suppressed > 0 || queue_len > 0 {
        eprintln!(
            "agent-light: usage report failed with status {status} ({suppressed} suppressed, queue len {queue_len})"
        );
    } else {
        eprintln!("agent-light: usage report failed with status {status}");
    }
    *entry = (now, 0);
}

fn send_usage_event(server_url: &str, access_token: &str, event: &UsageEvent) -> SendResult {
    let endpoint = format!("{}/api/usage/codex-thread", server_url.trim_end_matches('/'));
    let response = ureq::post(&endpoint)
        .set("Authorization", &format!("Bearer {access_token}"))
        .send_json(usage_event_payload(event));

    match response {
        Ok(_) => SendResult::Sent,
        Err(ureq::Error::Status(status, _)) => {
            if status == 401 {
                SendResult::Unauthorized
            } else {
                log_usage_report_status_error(status);
                SendResult::Failed
            }
        }
        Err(error) => {
            eprintln!("agent-light: usage report network error: {error}");
            SendResult::Failed
        }
    }
}

pub(crate) fn refresh_session_locked(session: &CloudSessionSnapshot) -> Option<CloudSessionSnapshot> {
    let _guard = REFRESH_LOCK.lock().ok()?;
    refresh_session(session)
}

fn refresh_session(session: &CloudSessionSnapshot) -> Option<CloudSessionSnapshot> {
    let endpoint = format!("{}/api/auth/refresh", session.server_url.trim_end_matches('/'));
    let response = ureq::post(&endpoint)
        .send_json(serde_json::json!({
            "refresh_token": session.refresh_token,
        }));

    let response = match response {
        Ok(response) => response,
        Err(ureq::Error::Status(status, _)) => {
            eprintln!("agent-light: refresh token failed with status {status}");
            return None;
        }
        Err(error) => {
            eprintln!("agent-light: refresh token network error: {error}");
            return None;
        }
    };

    let body: serde_json::Value = response.into_json().ok()?;
    let data = body.get("data")?;
    let access_token = data.get("access_token")?.as_str()?.to_string();
    let refresh_token = data.get("refresh_token")?.as_str()?.to_string();
    let expires_in_seconds = data.get("expires_in_seconds")?.as_u64()?;

    let now_ms = u64::try_from(timestamp_ms()).unwrap_or(0);
    let expires_at_ms = now_ms.saturating_add(expires_in_seconds.saturating_mul(1000));

    Some(CloudSessionSnapshot {
        server_url: session.server_url.clone(),
        access_token,
        refresh_token,
        expires_at_ms,
        user_id: session.user_id.clone(),
        user_email: session.user_email.clone(),
        user_phone_number: session.user_phone_number.clone(),
        display_name: session.display_name.clone(),
        workspace_id: session.workspace_id.clone(),
        device_id: session.device_id.clone(),
        installation_id: session.installation_id.clone(),
    })
}

fn usage_queue_path() -> Result<PathBuf, CommandError> {
    Ok(cloud_session_path()?
        .parent()
        .ok_or(CommandError {
            code: "usage_queue_path_failed",
            message: "Could not resolve usage queue directory".to_string(),
        })?
        .join(USAGE_QUEUE_FILE_NAME))
}

/// 判断当前 access token 是否临近过期（用于 UI 提示主动续期）。
pub fn is_token_expiring_soon(session: &CloudSessionSnapshot) -> bool {
    let now_ms = u64::try_from(timestamp_ms()).unwrap_or(0);
    let margin_ms = REFRESH_RETRY_MARGIN_SECONDS * 1000;
    session.expires_at_ms.saturating_sub(now_ms) <= margin_ms
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_event_payload_omits_null_model() {
        let event = UsageEvent {
            agent_provider: "cursor".to_string(),
            workspace_id: "ws-1".to_string(),
            device_id: "dev-1".to_string(),
            codex_thread_id: "thread-1".to_string(),
            model: None,
            tokens_used: 100,
            thread_updated_at_ms: 1000,
            sampled_at_ms: 1100,
        };
        let payload = usage_event_payload(&event);
        assert!(payload.get("model").is_none());
        assert_eq!(payload["tokens_used"], 100);
    }

    #[test]
    fn usage_event_serializes_without_cwd() {
        let event = UsageEvent {
            agent_provider: "cursor".to_string(),
            workspace_id: "ws-1".to_string(),
            device_id: "dev-1".to_string(),
            codex_thread_id: "thread-1".to_string(),
            model: Some("composer-2".to_string()),
            tokens_used: 100,
            thread_updated_at_ms: 1000,
            sampled_at_ms: 1100,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(!json.contains("cwd"));
        assert!(!json.contains("rollout_path"));
        assert!(json.contains("tokens_used"));
    }

    #[test]
    fn is_token_expiring_soon_detects_near_expiry() {
        let now_ms = u64::try_from(timestamp_ms()).unwrap_or(0);
        let session = CloudSessionSnapshot {
            server_url: "https://example.com".to_string(),
            access_token: "a".repeat(32),
            refresh_token: "b".repeat(32),
            expires_at_ms: now_ms + 30_000,
            user_id: "u-1".to_string(),
            user_email: "u@example.com".to_string(),
            user_phone_number: None,
            display_name: "Test".to_string(),
            workspace_id: "ws-1".to_string(),
            device_id: Some("dev-1".to_string()),
            installation_id: "i-1".to_string(),
        };
        assert!(is_token_expiring_soon(&session));
    }
}
