//! Claude Code 本地会话 token 读取。
//!
//! 数据来源：`~/.claude/projects/**/<session>.jsonl`
//! Token 口径：优先读取 JSONL 中的 `usage` 字段，否则按 assistant 文本长度 / 4 估算。

use crate::{classify_codex_thread_activity, AgentStatus, CodexStatusSnapshot, CodexThreadActivity};
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const CLAUDE_ACTIVE_WINDOW_SECONDS: u64 = 12;
const CLAUDE_COMPLETED_WINDOW_SECONDS: u64 = 5 * 60;

#[derive(Debug, Clone)]
struct ClaudeSession {
    session_id: String,
    updated_at_ms: u128,
    activity: CodexThreadActivity,
    tokens_used: u64,
    model: Option<String>,
}

pub(crate) fn read_claude_code_status() -> CodexStatusSnapshot {
    let sampled_at_ms = crate::timestamp_ms();
    let latest = find_latest_session();

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
        Some(session) => {
            let active_age_seconds = sampled_at_ms
                .saturating_sub(session.updated_at_ms)
                .checked_div(1000)
                .and_then(|seconds| u64::try_from(seconds).ok());
            let is_recent =
                active_age_seconds.is_some_and(|seconds| seconds <= CLAUDE_ACTIVE_WINDOW_SECONDS);
            let is_recent_completed = active_age_seconds
                .is_some_and(|seconds| seconds <= CLAUDE_COMPLETED_WINDOW_SECONDS);
            let state = if session.activity == CodexThreadActivity::Active
                && active_age_seconds.is_some_and(|seconds| seconds <= 15 * 60)
            {
                AgentStatus::Working
            } else if session.activity == CodexThreadActivity::Completed && is_recent_completed {
                AgentStatus::Completed
            } else if is_recent {
                AgentStatus::Working
            } else {
                AgentStatus::Standby
            };

            let is_working = state == AgentStatus::Working;

            (
                true,
                true,
                "已检测到 Claude Code 会话".to_string(),
                state,
                is_working,
                Some(session.session_id),
                session.model,
                Some(session.tokens_used),
                Some(session.updated_at_ms),
                active_age_seconds,
            )
        }
        None => {
            let installed = claude_home().is_some_and(|home| home.is_dir());
            (
                installed,
                installed,
                if installed {
                    "已安装 Claude Code，暂无最近会话".to_string()
                } else {
                    "未检测到 Claude Code".to_string()
                },
                AgentStatus::Attention,
                false,
                None,
                None,
                None,
                None,
                None,
            )
        }
    };

    CodexStatusSnapshot {
        available,
        logged_in,
        login_label,
        quota_label: if tokens_used.is_some() {
            "估算/本地".to_string()
        } else if available {
            "暂无会话".to_string()
        } else {
            "未安装".to_string()
        },
        quota_detail:
            "Claude Code 本地 JSONL 优先读取 usage 字段，否则按 assistant 文本长度 / 4 估算"
                .to_string(),
        state,
        is_working,
        latest_thread_id,
        latest_model,
        latest_source: Some("claude_code".to_string()),
        latest_cwd: None,
        tokens_used,
        thread_updated_at_ms,
        active_age_seconds,
        sampled_at_ms,
    }
}

fn find_latest_session() -> Option<ClaudeSession> {
    let projects_root = claude_projects_root()?;
    if !projects_root.is_dir() {
        return None;
    }

    let mut best: Option<(PathBuf, String, u128)> = None;
    collect_jsonl_files(&projects_root, &mut best);
    let (path, session_id, updated_at_ms) = best?;
    parse_session(&path, &session_id, updated_at_ms)
}

fn collect_jsonl_files(dir: &Path, best: &mut Option<(PathBuf, String, u128)>) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, best);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let session_id = path
            .file_stem()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "session".to_string());
        let Some(updated_at_ms) = file_modified_ms(&path) else {
            continue;
        };
        if best
            .as_ref()
            .map(|(_, _, current)| updated_at_ms > *current)
            .unwrap_or(true)
        {
            *best = Some((path, session_id, updated_at_ms));
        }
    }
}

fn claude_home() -> Option<PathBuf> {
    if let Ok(custom) = std::env::var("AGENT_LIGHT_CLAUDE_HOME") {
        return Some(PathBuf::from(custom));
    }

    #[cfg(target_os = "windows")]
    let home = std::env::var_os("USERPROFILE")?;
    #[cfg(not(target_os = "windows"))]
    let home = std::env::var_os("HOME")?;

    Some(PathBuf::from(home).join(".claude"))
}

fn claude_projects_root() -> Option<PathBuf> {
    claude_home().map(|home| home.join("projects"))
}

fn file_modified_ms(path: &Path) -> Option<u128> {
    let modified = fs::metadata(path).ok()?.modified().ok()?;
    modified
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis())
}

fn parse_session(path: &Path, session_id: &str, updated_at_ms: u128) -> Option<ClaudeSession> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);
    let mut lines = Vec::new();
    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        }
    }

    let (activity, tokens_used, model) = analyze_session_lines(&lines);
    Some(ClaudeSession {
        session_id: session_id.to_string(),
        updated_at_ms,
        activity,
        tokens_used,
        model,
    })
}

fn analyze_session_lines(lines: &[String]) -> (CodexThreadActivity, u64, Option<String>) {
    let mut tokens_used = 0u64;
    let mut model = None;
    let mut saw_tool_use = false;
    let mut saw_turn_ended = false;

    for line in lines {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };

        if value.get("type").and_then(Value::as_str) == Some("turn_ended") {
            saw_turn_ended = true;
        }

        if let Some(usage) = value.get("usage") {
            tokens_used = tokens_used.saturating_add(read_usage_tokens(usage));
        }

        let role = value
            .get("role")
            .and_then(Value::as_str)
            .or_else(|| value.get("message").and_then(|msg| msg.get("role")).and_then(Value::as_str));
        if role == Some("assistant") {
            if tokens_used == 0 {
                tokens_used = tokens_used.saturating_add(estimate_tokens_from_message(&value));
            }
            if message_has_tool_use(&value) {
                saw_tool_use = true;
            }
            if let Some(model_name) = value.get("model").and_then(Value::as_str) {
                model = Some(model_name.to_string());
            }
        }

        if value.get("type").and_then(Value::as_str) == Some("assistant") {
            if let Some(usage) = value.get("usage") {
                tokens_used = tokens_used.saturating_add(read_usage_tokens(usage));
            }
        }
    }

    let tail = lines.last().map(String::as_str).unwrap_or("");
    let tail_activity = if !tail.is_empty() {
        classify_codex_thread_activity(tail)
    } else {
        CodexThreadActivity::Unknown
    };

    let activity = if saw_tool_use && !saw_turn_ended {
        CodexThreadActivity::Active
    } else if saw_turn_ended {
        CodexThreadActivity::Completed
    } else if tail_activity != CodexThreadActivity::Unknown {
        tail_activity
    } else if tokens_used > 0 {
        CodexThreadActivity::Unknown
    } else {
        CodexThreadActivity::Unknown
    };

    (activity, tokens_used, model)
}

fn read_usage_tokens(usage: &Value) -> u64 {
    let input = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output = usage
        .get("output_tokens")
        .or_else(|| usage.get("completion_tokens"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    input.saturating_add(output)
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
    fn reads_usage_fields_from_claude_jsonl() {
        let lines = vec![
            r#"{"role":"assistant","usage":{"input_tokens":120,"output_tokens":30}}"#.to_string(),
        ];
        let (_, tokens, _) = analyze_session_lines(&lines);
        assert_eq!(tokens, 150);
    }
}
