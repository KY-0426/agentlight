//! AI 工具接入：检测本机安装状态、写入 Cursor hooks / 集成标记。

use crate::{
    config_dir_path, find_codex_binary, codex_state_db_path, process_util, read_codex_status,
    AgentStatus, CodexStatusSnapshot, CommandError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const CURSOR_HOOK_SCRIPT: &str = r#"const http = require("http");

const API_PORT = Number(process.env.AGENT_LIGHT_API_PORT || 18765);

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
  });
}

function postState(state, message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ state, message });
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: API_PORT,
        path: "/api/state",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        resolve();
      },
    );
    request.on("error", () => resolve());
    request.setTimeout(1500, () => {
      request.destroy();
      resolve();
    });
    request.write(body);
    request.end();
  });
}

function resolveHookName(input) {
  try {
    const payload = JSON.parse(input || "{}");
    return payload.hook_event_name || payload.event || "unknown";
  } catch {
    return "unknown";
  }
}

function resolveAgentState(hookName) {
  if (hookName === "stop") {
    return { state: "completed", message: "Cursor 任务完成" };
  }
  if (hookName === "postToolUseFailure") {
    return { state: "attention", message: "Cursor 工具执行失败" };
  }
  if (hookName === "sessionEnd") {
    return { state: "standby", message: "Cursor 待命中" };
  }
  if (hookName === "sessionStart") {
    return { state: "standby", message: "Cursor 会话就绪" };
  }
  return { state: "working", message: "Cursor 工作中" };
}

async function main() {
  const input = await readStdin();
  const hookName = resolveHookName(input);
  const { state, message } = resolveAgentState(hookName);
  await postState(state, message);
}

main()
  .catch(() => {})
  .finally(() => {
    process.exit(0);
  });
"#;

const CURSOR_HOOK_EVENTS: &[&str] = &[
    "sessionStart",
    "beforeSubmitPrompt",
    "preToolUse",
    "postToolUse",
    "stop",
    "sessionEnd",
    "postToolUseFailure",
];

const CURSOR_HOOK_SCRIPT_NAME: &str = "cursor-hook.cjs";
const CURSOR_HOOK_MARKER: &str = "cursor-hook";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiToolStatus {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub configured: bool,
    pub installable: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AiToolInstallResult {
    pub id: String,
    pub configured: bool,
    pub message: String,
}

struct ToolDefinition {
    id: &'static str,
    name: &'static str,
    installable: bool,
}

const TOOL_DEFINITIONS: &[ToolDefinition] = &[
    ToolDefinition {
        id: "claude_code",
        name: "Claude Code",
        installable: true,
    },
    ToolDefinition {
        id: "codex",
        name: "Codex",
        installable: true,
    },
    ToolDefinition {
        id: "cursor",
        name: "Cursor",
        installable: true,
    },
    ToolDefinition {
        id: "github_copilot",
        name: "GitHub Copilot",
        installable: false,
    },
    ToolDefinition {
        id: "qoder",
        name: "Qoder",
        installable: false,
    },
    ToolDefinition {
        id: "codebuddy",
        name: "CodeBuddy",
        installable: false,
    },
    ToolDefinition {
        id: "antigravity",
        name: "Antigravity",
        installable: false,
    },
];

pub fn list_ai_tools() -> Result<Vec<AiToolStatus>, CommandError> {
    Ok(TOOL_DEFINITIONS
        .iter()
        .map(|tool| build_tool_status(tool))
        .collect())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct AiToolTokenUsage {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub configured: bool,
    pub installable: bool,
    pub available: bool,
    pub state: String,
    pub state_label: String,
    pub tokens_used: Option<u64>,
    pub token_kind: String,
    pub activity_detail: String,
    pub detail: String,
}

pub fn list_ai_tool_token_usages() -> Result<Vec<AiToolTokenUsage>, CommandError> {
    Ok(TOOL_DEFINITIONS
        .iter()
        .map(|tool| build_tool_token_usage(tool))
        .collect())
}

fn build_tool_token_usage(tool: &ToolDefinition) -> AiToolTokenUsage {
    let base = build_tool_status(tool);
    match tool.id {
        "codex" => usage_from_snapshot(&base, read_codex_status(), "official"),
        "cursor" => usage_from_snapshot(&base, crate::cursor::read_cursor_status(), "estimated"),
        "claude_code" => usage_from_snapshot(
            &base,
            crate::claude_code::read_claude_code_status(),
            "estimated",
        ),
        _ => AiToolTokenUsage {
            id: base.id,
            name: base.name,
            installed: base.installed,
            configured: base.configured,
            installable: base.installable,
            available: base.installed,
            state: if base.installed {
                "standby".to_string()
            } else {
                "attention".to_string()
            },
            state_label: if base.installed {
                "已安装".to_string()
            } else {
                "未安装".to_string()
            },
            tokens_used: None,
            token_kind: "pending".to_string(),
            activity_detail: base.detail.clone(),
            detail: "Token 读取即将支持".to_string(),
        },
    }
}

fn usage_from_snapshot(
    base: &AiToolStatus,
    snapshot: CodexStatusSnapshot,
    token_kind: &str,
) -> AiToolTokenUsage {
    let agent_state = snapshot.state;
    let state = agent_status_name(&agent_state);
    let state_label = agent_status_label(agent_state);
    let activity_detail = if snapshot.is_working {
        format_activity_age(snapshot.active_age_seconds)
    } else {
        snapshot.login_label.clone()
    };

    AiToolTokenUsage {
        id: base.id.clone(),
        name: base.name.clone(),
        installed: base.installed,
        configured: base.configured,
        installable: base.installable,
        available: snapshot.available,
        state: state.to_string(),
        state_label,
        tokens_used: snapshot.tokens_used,
        token_kind: if snapshot.tokens_used.is_some() {
            token_kind.to_string()
        } else {
            "none".to_string()
        },
        activity_detail,
        detail: snapshot.quota_detail,
    }
}

fn agent_status_name(state: &AgentStatus) -> &'static str {
    match state {
        AgentStatus::Standby => "standby",
        AgentStatus::Working => "working",
        AgentStatus::Completed => "completed",
        AgentStatus::Attention => "attention",
    }
}

fn agent_status_label(state: AgentStatus) -> String {
    match state {
        AgentStatus::Standby => "待命中".to_string(),
        AgentStatus::Working => "工作中".to_string(),
        AgentStatus::Completed => "已完成".to_string(),
        AgentStatus::Attention => "需处理".to_string(),
    }
}

fn format_activity_age(active_age_seconds: Option<u64>) -> String {
    match active_age_seconds {
        Some(seconds) if seconds < 60 => format!("{seconds} 秒前活跃"),
        Some(seconds) => format!("{} 分钟前活跃", seconds / 60),
        None => "暂无活跃记录".to_string(),
    }
}

pub fn install_ai_tool(tool_id: &str) -> Result<AiToolInstallResult, CommandError> {
    let tool = TOOL_DEFINITIONS
        .iter()
        .find(|candidate| candidate.id == tool_id)
        .ok_or(CommandError {
            code: "ai_tool_unknown",
            message: format!("未知 AI 工具：{tool_id}"),
        })?;

    if !tool.installable {
        return Err(CommandError {
            code: "ai_tool_unsupported",
            message: format!("{} 接入即将开放", tool.name),
        });
    }

    let message = match tool.id {
        "codex" => install_codex()?,
        "cursor" => install_cursor()?,
        "claude_code" => install_claude_code()?,
        _ => unreachable!(),
    };

    Ok(AiToolInstallResult {
        id: tool.id.to_string(),
        configured: true,
        message,
    })
}

fn build_tool_status(tool: &ToolDefinition) -> AiToolStatus {
    let installed = detect_tool_installed(tool.id);
    let configured = match tool.id {
        "cursor" => is_cursor_integration_configured(),
        _ => integration_marker_path(tool.id)
            .map(|path| path.is_file())
            .unwrap_or(false),
    };
    let detail = describe_tool_status(tool.id, installed, configured);

    AiToolStatus {
        id: tool.id.to_string(),
        name: tool.name.to_string(),
        installed,
        configured,
        installable: tool.installable,
        detail,
    }
}

fn describe_tool_status(tool_id: &str, installed: bool, configured: bool) -> String {
    match (installed, configured) {
        (true, true) => "已安装 · 已接入 Agent Light".to_string(),
        (true, false) => "已检测到本机安装，尚未接入".to_string(),
        (false, true) => "已保留接入配置，等待工具安装".to_string(),
        (false, false) => match tool_id {
            "codex" => "未检测到 Codex CLI 或 ~/.codex 数据".to_string(),
            "cursor" => "未检测到 Cursor 或 ~/.cursor/projects".to_string(),
            "claude_code" => "未检测到 Claude Code CLI 或 ~/.claude".to_string(),
            _ => "尚未安装".to_string(),
        },
    }
}

fn detect_tool_installed(tool_id: &str) -> bool {
    match tool_id {
        "codex" => find_codex_binary().is_some() || codex_state_db_path().is_some_and(|path| path.is_file()),
        "cursor" => cursor_home_dir().is_some_and(|home| home.join("projects").is_dir())
            || cursor_executable().is_some(),
        "claude_code" => find_claude_binary().is_some() || user_home().is_some_and(|home| home.join(".claude").is_dir()),
        "github_copilot" => false,
        _ => false,
    }
}

fn install_codex() -> Result<String, CommandError> {
    if !detect_tool_installed("codex") {
        return Err(CommandError {
            code: "ai_tool_missing",
            message: "未检测到 Codex；请先安装 Codex CLI 并登录".to_string(),
        });
    }

    write_integration_marker(
        "codex",
        json!({
            "mode": "sqlite_poll",
            "state_db": codex_state_db_path().and_then(|path| path.to_str().map(str::to_string)),
        }),
    )?;

    Ok("Codex 已接入；Agent Light 将继续读取本地 state_5.sqlite".to_string())
}

fn install_cursor() -> Result<String, CommandError> {
    let node = find_node_binary().ok_or(CommandError {
        code: "node_missing",
        message: "未找到 node；Cursor hooks 需要 Node.js".to_string(),
    })?;
    let hook_script = write_cursor_hook_script()?;
    install_cursor_hooks(&node, &hook_script)?;
    write_integration_marker(
        "cursor",
        json!({
            "mode": "hooks",
            "hook_script": hook_script.to_string_lossy(),
        }),
    )?;

    Ok(
        "Cursor hooks 已写入 ~/.cursor/hooks.json；请新开一个 Cursor 对话使 hooks 生效"
            .to_string(),
    )
}

fn install_claude_code() -> Result<String, CommandError> {
    if !detect_tool_installed("claude_code") {
        return Err(CommandError {
            code: "ai_tool_missing",
            message: "未检测到 Claude Code；请先安装 claude CLI".to_string(),
        });
    }

    write_integration_marker(
        "claude_code",
        json!({
            "mode": "pending_hooks",
            "note": "Claude Code hook 模板将在后续版本自动写入",
        }),
    )?;

    Ok("Claude Code 已标记接入；当前版本先保留配置标记".to_string())
}

fn integrations_dir() -> Result<PathBuf, CommandError> {
    Ok(config_dir_path()?.join("integrations"))
}

fn integration_marker_path(tool_id: &str) -> Result<PathBuf, CommandError> {
    Ok(integrations_dir()?.join(format!("{tool_id}.json")))
}

fn write_integration_marker(tool_id: &str, payload: Value) -> Result<(), CommandError> {
    let path = integration_marker_path(tool_id)?;
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|error| CommandError {
            code: "integration_write_failed",
            message: format!("无法创建 integrations 目录：{error}"),
        })?;
    }

    let json = serde_json::to_string_pretty(&payload).map_err(|error| CommandError {
        code: "integration_write_failed",
        message: format!("无法序列化集成配置：{error}"),
    })?;

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| CommandError {
            code: "integration_write_failed",
            message: format!("无法写入集成配置：{error}"),
        })?;
    file.write_all(json.as_bytes()).map_err(|error| CommandError {
        code: "integration_write_failed",
        message: format!("无法写入集成配置：{error}"),
    })?;
    file.flush().map_err(|error| CommandError {
        code: "integration_write_failed",
        message: format!("无法 flush 集成配置：{error}"),
    })?;
    Ok(())
}

fn write_cursor_hook_script() -> Result<PathBuf, CommandError> {
    let dir = integrations_dir()?;
    create_dir_all(&dir).map_err(|error| CommandError {
        code: "integration_write_failed",
        message: format!("无法创建 integrations 目录：{error}"),
    })?;
    let path = dir.join(CURSOR_HOOK_SCRIPT_NAME);
    let mut file = File::create(&path).map_err(|error| CommandError {
        code: "integration_write_failed",
        message: format!("无法写入 Cursor hook 脚本：{error}"),
    })?;
    file.write_all(CURSOR_HOOK_SCRIPT.as_bytes())
        .map_err(|error| CommandError {
            code: "integration_write_failed",
            message: format!("无法写入 Cursor hook 脚本：{error}"),
        })?;
    Ok(path)
}

fn install_cursor_hooks(node: &Path, hook_script: &Path) -> Result<(), CommandError> {
    let home = user_home().ok_or(CommandError {
        code: "home_unavailable",
        message: "无法定位用户主目录".to_string(),
    })?;
    let cursor_dir = home.join(".cursor");
    create_dir_all(&cursor_dir).map_err(|error| CommandError {
        code: "cursor_hooks_failed",
        message: format!("无法创建 ~/.cursor：{error}"),
    })?;

    let hooks_path = cursor_dir.join("hooks.json");
    let mut root = read_json_file(&hooks_path).unwrap_or_else(|| json!({ "version": 1, "hooks": {} }));
    if !root.get("hooks").is_some() {
        root["hooks"] = json!({});
    }

    let command = format!(
        "{} \"{}\"",
        shell_escape_path(node),
        shell_escape_path(hook_script)
    );
    for hook_name in CURSOR_HOOK_EVENTS {
        upsert_hook_command(&mut root, hook_name, &command);
    }

    write_json_file(&hooks_path, &root)?;
    Ok(())
}

fn is_cursor_integration_configured() -> bool {
    let marker_ok = integration_marker_path("cursor")
        .ok()
        .is_some_and(|path| path.is_file());
    let hooks_ok = cursor_hooks_path()
        .ok()
        .and_then(|path| read_json_file(&path))
        .is_some_and(|root| hooks_contain_agent_light_command(&root));
    marker_ok && hooks_ok
}

fn cursor_hooks_path() -> Result<PathBuf, CommandError> {
    let home = user_home().ok_or(CommandError {
        code: "home_unavailable",
        message: "无法定位用户主目录".to_string(),
    })?;
    Ok(home.join(".cursor").join("hooks.json"))
}

fn hooks_contain_agent_light_command(root: &Value) -> bool {
    let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
        return false;
    };

    hooks.values().any(|entries| {
        entries.as_array().is_some_and(|items| {
            items.iter().any(|entry| {
                entry
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(is_agent_light_hook_command)
            })
        })
    })
}

fn is_agent_light_hook_command(command: &str) -> bool {
    command.contains(CURSOR_HOOK_MARKER)
}

fn upsert_hook_command(root: &mut Value, hook_name: &str, command: &str) {
    let hooks = root
        .as_object_mut()
        .and_then(|object| object.get_mut("hooks"))
        .and_then(|value| value.as_object_mut());
    let Some(hooks) = hooks else {
        return;
    };

    let entries = hooks
        .entry(hook_name.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(items) = entries.as_array_mut() else {
        *entries = Value::Array(vec![json!({ "command": command })]);
        return;
    };

    items.retain(|entry| {
        entry
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| !is_agent_light_hook_command(value))
            .unwrap_or(true)
    });
    items.push(json!({ "command": command }));
}

fn read_json_file(path: &Path) -> Option<Value> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_json_file(path: &Path, value: &Value) -> Result<(), CommandError> {
    let json = serde_json::to_string_pretty(value).map_err(|error| CommandError {
        code: "json_write_failed",
        message: format!("无法序列化 JSON：{error}"),
    })?;
    let mut file = File::create(path).map_err(|error| CommandError {
        code: "json_write_failed",
        message: format!("无法写入 {}：{error}", path.display()),
    })?;
    file.write_all(json.as_bytes()).map_err(|error| CommandError {
        code: "json_write_failed",
        message: format!("无法写入 {}：{error}", path.display()),
    })?;
    Ok(())
}

fn user_home() -> Option<PathBuf> {
    if let Ok(home) = std::env::var("USERPROFILE") {
        if !home.trim().is_empty() {
            return Some(PathBuf::from(home));
        }
    }
    std::env::var_os("HOME").map(PathBuf::from)
}

fn cursor_home_dir() -> Option<PathBuf> {
    user_home().map(|home| home.join(".cursor"))
}

fn cursor_executable() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local_app_data = std::env::var_os("LOCALAPPDATA")?;
        let candidate = PathBuf::from(local_app_data)
            .join("Programs")
            .join("cursor")
            .join("Cursor.exe");
        return candidate.is_file().then_some(candidate);
    }

    #[cfg(not(target_os = "windows"))]
    {
        ["/Applications/Cursor.app/Contents/MacOS/Cursor"]
            .iter()
            .map(PathBuf::from)
            .find(|path| path.is_file())
    }
}

fn find_claude_binary() -> Option<PathBuf> {
    find_in_path("claude")
}

fn find_node_binary() -> Option<PathBuf> {
    find_in_path("node")
}

fn find_in_path(program: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let checker = "where";
    #[cfg(not(target_os = "windows"))]
    let checker = "which";

    let output = process_util::hidden_command(checker).arg(program).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.exists())
}

fn shell_escape_path(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('"', "\\\"");
    format!("\"{normalized}\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_replaces_existing_agent_light_hook() {
        let mut root = json!({
            "version": 1,
            "hooks": {
                "postToolUse": [
                    { "command": "node \"C:\\\\Agent Light\\\\integrations\\\\cursor-hook.cjs\"" },
                    { "command": "echo keep-me" }
                ]
            }
        });
        upsert_hook_command(
            &mut root,
            "postToolUse",
            "node \"C:\\\\Agent Light\\\\integrations\\\\cursor-hook.cjs\"",
        );
        let items = root["hooks"]["postToolUse"].as_array().unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["command"], "echo keep-me");
    }

    #[test]
    fn detects_agent_light_hook_commands() {
        assert!(is_agent_light_hook_command(
            "node \"D:\\\\Agent Light\\\\integrations\\\\cursor-hook.cjs\""
        ));
        assert!(!is_agent_light_hook_command("echo keep-me"));
    }

    #[test]
    fn detects_configured_cursor_hooks() {
        let root = json!({
            "version": 1,
            "hooks": {
                "stop": [
                    { "command": "node \"C:\\\\Agent Light\\\\integrations\\\\cursor-hook.cjs\"" }
                ]
            }
        });
        assert!(hooks_contain_agent_light_command(&root));
    }

    #[test]
    fn cursor_hook_script_uses_commonjs_entry() {
        assert!(CURSOR_HOOK_SCRIPT.contains("require(\"http\")"));
        assert!(CURSOR_HOOK_SCRIPT.contains("completed"));
        assert!(!CURSOR_HOOK_SCRIPT.contains("cursor-hook.mjs"));
    }
}
