//! Cursor IDE 本地 Composer 状态读取。
//!
//! 数据来源：`~/.cursor/projects/*/agent-transcripts/<composer-id>/<composer-id>.jsonl`
//! Windows 等价路径：`%USERPROFILE%\.cursor\projects\...`
//!
//! Token 口径：Cursor 未公开本地 token 字段，当前按 transcript 中 assistant 文本长度 / 4 估算。

use crate::{AgentStatus, CodexStatusSnapshot};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

const CURSOR_STREAMING_GRACE_SECONDS: u64 = 2;
const CURSOR_USER_PENDING_SECONDS: u64 = 180;
const CURSOR_COMPLETED_WINDOW_SECONDS: u64 = 5 * 60;
const CURSOR_STATUS_CACHE_TTL_MS: u128 = 1_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorTailSignal {
    ToolUseActive,
    AssistantTextOnly,
    UserWaiting,
    None,
}

#[derive(Debug, Clone)]
struct CursorTranscript {
    composer_id: String,
    updated_at_ms: u128,
    tail_signal: CursorTailSignal,
    tokens_used: u64,
    model: Option<String>,
}

fn resolve_cursor_state(tail: CursorTailSignal, age_seconds: Option<u64>) -> AgentStatus {
    let age = age_seconds.unwrap_or(u64::MAX);
    let is_streaming = age <= CURSOR_STREAMING_GRACE_SECONDS;
    let is_user_pending = age <= CURSOR_USER_PENDING_SECONDS;
    let is_recent_completed = age <= CURSOR_COMPLETED_WINDOW_SECONDS;

    match tail {
        CursorTailSignal::ToolUseActive => AgentStatus::Working,
        CursorTailSignal::AssistantTextOnly if is_streaming => AgentStatus::Working,
        CursorTailSignal::AssistantTextOnly if is_recent_completed => AgentStatus::Completed,
        CursorTailSignal::AssistantTextOnly => AgentStatus::Standby,
        CursorTailSignal::UserWaiting if is_user_pending => AgentStatus::Working,
        CursorTailSignal::UserWaiting => AgentStatus::Standby,
        CursorTailSignal::None => AgentStatus::Standby,
    }
}

#[derive(Debug, Clone)]
struct CursorStatusCache {
    sampled_at_ms: u128,
    transcript_path: PathBuf,
    transcript_mtime_ms: u128,
    snapshot: CodexStatusSnapshot,
}

static CURSOR_STATUS_CACHE: Mutex<Option<CursorStatusCache>> = Mutex::new(None);

pub(crate) fn read_cursor_status() -> CodexStatusSnapshot {
    let sampled_at_ms = crate::timestamp_ms();
    if let Some(cached) = cached_cursor_status(sampled_at_ms) {
        return cached;
    }

    let latest_identity = find_latest_transcript_identity();
    let latest = latest_identity.as_ref().and_then(|(path, updated_at_ms)| {
        let composer_id = path.parent()?.file_name()?.to_string_lossy().into_owned();
        parse_transcript(path, &composer_id, *updated_at_ms)
    });
    let snapshot = build_cursor_status(sampled_at_ms, latest);
    if let Ok(mut cache) = CURSOR_STATUS_CACHE.lock() {
        if let Some((path, mtime)) = latest_identity {
            *cache = Some(CursorStatusCache {
                sampled_at_ms,
                transcript_path: path,
                transcript_mtime_ms: mtime,
                snapshot: snapshot.clone(),
            });
        } else {
            *cache = None;
        }
    }
    snapshot
}

fn cached_cursor_status(sampled_at_ms: u128) -> Option<CodexStatusSnapshot> {
    let cache = CURSOR_STATUS_CACHE.lock().ok()?;
    let cached = cache.as_ref()?;
    if sampled_at_ms.saturating_sub(cached.sampled_at_ms) > CURSOR_STATUS_CACHE_TTL_MS {
        return None;
    }

    let current_mtime = file_modified_ms(&cached.transcript_path)?;
    if current_mtime != cached.transcript_mtime_ms {
        return None;
    }

    Some(CodexStatusSnapshot {
        sampled_at_ms,
        ..cached.snapshot.clone()
    })
}

fn find_latest_transcript_identity() -> Option<(PathBuf, u128)> {
    let projects_root = cursor_projects_root()?;
    if !projects_root.is_dir() {
        return None;
    }

    let mut best_path: Option<PathBuf> = None;
    let mut best_mtime = 0_u128;

    for project_entry in fs::read_dir(&projects_root).ok()?.flatten() {
        let transcripts_dir = project_entry.path().join("agent-transcripts");
        if !transcripts_dir.is_dir() {
            continue;
        }
        for composer_entry in fs::read_dir(&transcripts_dir).ok()?.flatten() {
            let composer_dir = composer_entry.path();
            if !composer_dir.is_dir() {
                continue;
            }
            let composer_id = composer_dir.file_name()?.to_string_lossy();
            let transcript_path = composer_dir.join(format!("{composer_id}.jsonl"));
            if !transcript_path.is_file() {
                continue;
            }
            let updated_at_ms = file_modified_ms(&transcript_path)?;
            if updated_at_ms > best_mtime {
                best_mtime = updated_at_ms;
                best_path = Some(transcript_path);
            }
        }
    }

    best_path.map(|path| (path, best_mtime))
}

fn build_cursor_status(
    sampled_at_ms: u128,
    latest: Option<CursorTranscript>,
) -> CodexStatusSnapshot {
    let (
        available,
        logged_in,
        login_label,
        state,
        is_working,
        latest_thread_id,
        latest_model,
        tokens_used,
        thread_updated_at_ms,
        active_age_seconds,
    ) = match latest {
        Some(transcript) => {
            let active_age_seconds = sampled_at_ms
                .saturating_sub(transcript.updated_at_ms)
                .checked_div(1000)
                .and_then(|seconds| u64::try_from(seconds).ok());
            let state = resolve_cursor_state(transcript.tail_signal, active_age_seconds);
            let is_working = state == AgentStatus::Working;

            (
                true,
                true,
                "已检测到 Cursor Composer 会话".to_string(),
                state,
                is_working,
                Some(transcript.composer_id),
                transcript.model,
                Some(transcript.tokens_used),
                Some(transcript.updated_at_ms),
                active_age_seconds,
            )
        }
        None => (
            false,
            false,
            "未检测到 Cursor Composer 会话".to_string(),
            AgentStatus::Attention,
            false,
            None,
            None,
            None,
            None,
            None,
        ),
    };

    CodexStatusSnapshot {
        available,
        logged_in,
        login_label,
        quota_label: if available {
            "估算值".to_string()
        } else {
            "未登录".to_string()
        },
        quota_detail:
            "Cursor 本地 transcript 未提供官方 token 字段，当前按 assistant 文本长度 / 4 估算"
                .to_string(),
        state,
        is_working,
        latest_thread_id,
        latest_model,
        latest_source: Some("cursor_composer".to_string()),
        latest_cwd: None,
        tokens_used,
        thread_updated_at_ms,
        active_age_seconds,
        sampled_at_ms,
    }
}

fn cursor_projects_root() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AGENT_LIGHT_CURSOR_HOME") {
        let path = PathBuf::from(custom);
        return if path.ends_with("projects") {
            Some(path)
        } else {
            Some(path.join("projects"))
        };
    }

    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE")?;
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME")?;

    Some(PathBuf::from(home).join(".cursor").join("projects"))
}

fn file_modified_ms(path: &Path) -> Option<u128> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn parse_transcript(path: &Path, composer_id: &str, updated_at_ms: u128) -> Option<CursorTranscript> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let file_len = reader.seek(SeekFrom::End(0)).ok()?;
    let tail_start = file_len.saturating_sub(256 * 1024);
    reader.seek(SeekFrom::Start(tail_start)).ok()?;

    let mut lines = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        }
    }

    if lines.is_empty() && tail_start > 0 {
        let reader = BufReader::new(fs::File::open(path).ok()?);
        for line in reader.lines().map_while(Result::ok) {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                lines.push(trimmed.to_string());
            }
        }
    }

    let (tail_signal, tokens_used, model) = analyze_transcript_lines(&lines);
    Some(CursorTranscript {
        composer_id: composer_id.to_string(),
        updated_at_ms,
        tail_signal,
        tokens_used,
        model,
    })
}

fn analyze_transcript_lines(lines: &[String]) -> (CursorTailSignal, u64, Option<String>) {
    let mut tokens_used = 0u64;
    let mut model = None;

    for line in lines {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if value.get("role").and_then(Value::as_str) == Some("assistant") {
            tokens_used = tokens_used.saturating_add(estimate_tokens_from_message(&value));
            if let Some(model_name) = value.get("model").and_then(Value::as_str) {
                model = Some(model_name.to_string());
            }
        }
    }

    (classify_cursor_tail(lines), tokens_used, model)
}

fn classify_cursor_tail(lines: &[String]) -> CursorTailSignal {
    for line in lines.iter().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if value.get("type").and_then(Value::as_str) == Some("turn_ended") {
            return CursorTailSignal::AssistantTextOnly;
        }

        match value.get("role").and_then(Value::as_str) {
            Some("assistant") => {
                if message_has_tool_use(&value) {
                    return CursorTailSignal::ToolUseActive;
                }
                if assistant_has_content(&value) {
                    return CursorTailSignal::AssistantTextOnly;
                }
            }
            Some("user") => return CursorTailSignal::UserWaiting,
            _ => {}
        }
    }

    CursorTailSignal::None
}

fn assistant_has_content(value: &Value) -> bool {
    value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("text")
                    && item
                        .get("text")
                        .and_then(Value::as_str)
                        .is_some_and(|text| !text.is_empty())
            })
        })
}

fn message_has_tool_use(value: &Value) -> bool {
    value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .is_some_and(|items| {
            items.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("tool_use")
                    || item.get("type").and_then(Value::as_str) == Some("tool_call")
            })
        })
}

fn estimate_tokens_from_message(value: &Value) -> u64 {
    let mut chars = 0u64;
    if let Some(content) = value
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
    {
        for item in content {
            if item.get("type").and_then(Value::as_str) == Some("text") {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    chars = chars.saturating_add(text.chars().count() as u64);
                }
            }
        }
    }
    (chars / 4).max(if chars > 0 { 1 } else { 0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_active_transcript_when_last_assistant_uses_tools() {
        let lines = vec![
            r#"{"role":"user","message":{"content":[{"type":"text","text":"hi"}]}}"#.to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"working"}]}}"#
                .to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}"#
                .to_string(),
        ];
        let (tail, tokens, _) = analyze_transcript_lines(&lines);
        assert_eq!(tail, CursorTailSignal::ToolUseActive);
        assert_eq!(tokens, 1);
    }

    #[test]
    fn classifies_completed_transcript_when_final_assistant_is_text_only() {
        let lines = vec![
            r#"{"role":"user","message":{"content":[{"type":"text","text":"hi"}]}}"#.to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}"#
                .to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"done"}]}}"#
                .to_string(),
        ];
        let (tail, tokens, _) = analyze_transcript_lines(&lines);
        assert_eq!(tail, CursorTailSignal::AssistantTextOnly);
        assert_eq!(tokens, 1);
    }

    #[test]
    fn classifies_user_waiting_when_last_line_is_user() {
        let lines = vec![
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"done"}]}}"#
                .to_string(),
            r#"{"role":"user","message":{"content":[{"type":"text","text":"next"}]}}"#.to_string(),
        ];
        let (tail, _, _) = analyze_transcript_lines(&lines);
        assert_eq!(tail, CursorTailSignal::UserWaiting);
    }

    #[test]
    fn resolves_completed_after_stale_final_assistant_reply() {
        assert_eq!(
            resolve_cursor_state(CursorTailSignal::AssistantTextOnly, Some(3)),
            AgentStatus::Completed
        );
    }

    #[test]
    fn resolves_working_while_final_assistant_reply_is_still_streaming() {
        assert_eq!(
            resolve_cursor_state(CursorTailSignal::AssistantTextOnly, Some(1)),
            AgentStatus::Working
        );
    }

    #[test]
    fn resolves_standby_after_completed_window() {
        assert_eq!(
            resolve_cursor_state(CursorTailSignal::AssistantTextOnly, Some(400)),
            AgentStatus::Standby
        );
    }

    #[test]
    fn classifies_realistic_cursor_turn_with_text_then_tools_then_final_text() {
        let lines = vec![
            r#"{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\n怎么退出  状态测试\n</user_query>"}]}}"#
                .to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"thinking"},{"type":"tool_use","name":"Grep"}]}}"#
                .to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"**结论**：退出状态测试..."}]}}"#
                .to_string(),
        ];
        let (tail, _, _) = analyze_transcript_lines(&lines);
        assert_eq!(tail, CursorTailSignal::AssistantTextOnly);
        assert_eq!(
            resolve_cursor_state(tail, Some(3)),
            AgentStatus::Completed
        );
    }

    #[test]
    fn classifies_active_session_when_user_just_sent_follow_up() {
        let lines = vec![
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"previous answer"}]}}"#
                .to_string(),
            r#"{"role":"user","message":{"content":[{"type":"text","text":"<user_query>\n检查一下对吗？\n</user_query>"}]}}"#
                .to_string(),
        ];
        let (tail, _, _) = analyze_transcript_lines(&lines);
        assert_eq!(tail, CursorTailSignal::UserWaiting);
        assert_eq!(
            resolve_cursor_state(tail, Some(5)),
            AgentStatus::Working
        );
        assert_eq!(
            resolve_cursor_state(tail, Some(200)),
            AgentStatus::Standby
        );
    }

    #[test]
    fn classifies_mid_turn_assistant_line_with_text_and_tools_as_active() {
        let lines = vec![
            r#"{"role":"user","message":{"content":[{"type":"text","text":"go"}]}}"#.to_string(),
            r#"{"role":"assistant","message":{"content":[{"type":"text","text":"checking"},{"type":"tool_use","name":"Read"}]}}"#
                .to_string(),
        ];
        let (tail, _, _) = analyze_transcript_lines(&lines);
        assert_eq!(tail, CursorTailSignal::ToolUseActive);
    }
}
