#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{de, Deserialize, Deserializer, Serialize};
use std::fs::{create_dir_all, remove_file, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent,
};

mod activation;
mod ai_tools;
mod claude_code;
mod cursor;
mod platform;
mod process_util;
mod serial_io;
mod sync;

const API_ADDR: &str = "127.0.0.1:18765";
const TOP_DOCK_THRESHOLD: i32 = 36;
const TOP_SNAP_THRESHOLD: i32 = 96;
const CODEX_ACTIVE_WINDOW_SECONDS: u64 = 12;
const CODEX_STALE_ACTIVE_WINDOW_SECONDS: u64 = 15 * 60;
const CODEX_COMPLETED_WINDOW_SECONDS: u64 = 5 * 60;
const CODEX_PENDING_APPROVAL_SECONDS: u64 = 15;
const CODEX_SESSION_TAIL_BYTES: u64 = 64 * 1024;
const AGENT_STATUS_VARIANTS: &[&str] = &["standby", "working", "completed", "attention"];
const MAX_MESSAGE_LEN: usize = 180;
const MAX_BODY_LEN: usize = 4096;
pub(crate) const HARDWARE_BAUD_DEFAULT: u32 = 115_200;
const HARDWARE_PROTOCOL: &str = "agent-light-rgb-v1";
const HARDWARE_WATCHER_INTERVAL_MS: u64 = 4000;
const HARDWARE_WATCHER_RETRY_INTERVAL_MS: u64 = 3000;
const SETTINGS_WINDOW_GAP_PX: i32 = 16;
const HARDWARE_STATE_EVENT: &str = "hardware-state";
const AGENT_MONITOR_INTERVAL_MS: u64 = 1_000;
const MANUAL_STATUS_HOLD_MS: u128 = 60_000;
const CLOUD_SESSION_FILE_NAME: &str = "cloud-session.json";
const INSTALLATION_ID_FILE_NAME: &str = "installation-id";
const MAX_CLOUD_URL_LEN: usize = 2048;
const MAX_CLOUD_TOKEN_LEN: usize = 4096;
const SETTINGS_PAGE_EVENT: &str = "agent-settings-page";
static RUNTIME_SERVICES_STARTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AgentStatus {
    Standby,
    Working,
    Completed,
    Attention,
}

impl<'de> Deserialize<'de> for AgentStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "standby" | "idle" => Ok(Self::Standby),
            "working" | "running" => Ok(Self::Working),
            "completed" | "success" => Ok(Self::Completed),
            "attention" | "error" | "needs_action" => Ok(Self::Attention),
            _ => Err(de::Error::unknown_variant(&value, AGENT_STATUS_VARIANTS)),
        }
    }
}

impl AgentStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Standby => "standby",
            Self::Working => "working",
            Self::Completed => "completed",
            Self::Attention => "attention",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateRequest {
    state: AgentStatus,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StatusSnapshot {
    state: AgentStatus,
    message: Option<String>,
    source: String,
    sequence: u64,
    timestamp_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
struct WindowPlacement {
    x: i32,
    y: i32,
    near_top: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct SystemMetrics {
    pub(crate) cpu_usage_percent: Option<f64>,
    pub(crate) logical_cpus: Option<u32>,
    pub(crate) memory_used_bytes: Option<u64>,
    pub(crate) memory_total_bytes: Option<u64>,
    pub(crate) memory_used_percent: Option<f64>,
    pub(crate) uptime_seconds: Option<u64>,
    pub(crate) sampled_at_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CodexStatusSnapshot {
    pub(crate) available: bool,
    pub(crate) logged_in: bool,
    pub(crate) login_label: String,
    pub(crate) quota_label: String,
    pub(crate) quota_detail: String,
    pub(crate) state: AgentStatus,
    pub(crate) is_working: bool,
    pub(crate) latest_thread_id: Option<String>,
    pub(crate) latest_model: Option<String>,
    pub(crate) latest_source: Option<String>,
    pub(crate) latest_cwd: Option<String>,
    pub(crate) tokens_used: Option<u64>,
    pub(crate) thread_updated_at_ms: Option<u128>,
    pub(crate) active_age_seconds: Option<u64>,
    pub(crate) sampled_at_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CloudSessionSnapshot {
    pub(crate) server_url: String,
    pub(crate) access_token: String,
    pub(crate) refresh_token: String,
    pub(crate) expires_at_ms: u64,
    pub(crate) user_id: String,
    pub(crate) user_email: String,
    #[serde(default)]
    pub(crate) user_phone_number: Option<String>,
    pub(crate) display_name: String,
    pub(crate) workspace_id: String,
    pub(crate) device_id: Option<String>,
    pub(crate) installation_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct HardwareStatusSnapshot {
    enabled: bool,
    connected: bool,
    protocol: String,
    firmware_version: Option<String>,
    protocol_version: Option<String>,
    hardware_revision: Option<String>,
    port: Option<String>,
    baud: u32,
    available_ports: Vec<String>,
    last_state: Option<AgentStatus>,
    last_error: Option<String>,
    updated_at_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
struct LightSettingsRequest {
    standby: LightStateSettingsRequest,
    working: LightStateSettingsRequest,
    completed: LightStateSettingsRequest,
    attention: LightStateSettingsRequest,
}

#[derive(Debug, Clone, Deserialize)]
struct LightStateSettingsRequest {
    red: u16,
    green: u16,
    blue: u16,
    brightness: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LightSettings {
    standby: LightStateSettings,
    working: LightStateSettings,
    completed: LightStateSettings,
    attention: LightStateSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LightStateSettings {
    red: u8,
    green: u8,
    blue: u8,
    brightness: u8,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CodexThreadRow {
    id: String,
    source: Option<String>,
    model: Option<String>,
    cwd: Option<String>,
    rollout_path: String,
    updated_at_ms: Option<u128>,
    tokens_used: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexThreadActivity {
    Active,
    Completed,
    /// Codex issued a tool/command call but no output has been written yet.
    AwaitingFunctionOutput,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct CommandError {
    pub(crate) code: &'static str,
    pub(crate) message: String,
}

#[derive(Clone)]
struct AgentRuntime {
    current: Arc<Mutex<StatusSnapshot>>,
    sequence: Arc<AtomicU64>,
    hardware: HardwareRuntime,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    manual_hold_until_ms: Arc<AtomicU64>,
}

impl AgentRuntime {
    fn new() -> Self {
        Self {
            current: Arc::new(Mutex::new(StatusSnapshot {
                state: AgentStatus::Standby,
                message: Some("待命中".to_string()),
                source: "boot".to_string(),
                sequence: 0,
                timestamp_ms: timestamp_ms(),
            })),
            sequence: Arc::new(AtomicU64::new(0)),
            hardware: HardwareRuntime::from_env(),
            app_handle: Arc::new(Mutex::new(None)),
            manual_hold_until_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    fn set_app_handle(&self, app: AppHandle) -> Result<(), CommandError> {
        self.app_handle
            .lock()
            .map(|mut handle| {
                *handle = Some(app);
            })
            .map_err(|_| CommandError {
                code: "app_handle_lock_failed",
                message: "Could not store app handle".to_string(),
            })
    }

    fn snapshot(&self) -> Result<StatusSnapshot, CommandError> {
        self.current
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| CommandError {
                code: "state_lock_failed",
                message: "Could not read current agent state".to_string(),
            })
    }

    fn apply(
        &self,
        request: StateRequest,
        source: &str,
    ) -> Result<StatusSnapshot, CommandError> {
        let now_ms = timestamp_ms();
        if source == "codex_monitor" || source == "cursor_monitor" {
            let hold_until = self.manual_hold_until_ms.load(Ordering::SeqCst) as u128;
            if now_ms < hold_until {
                return self.snapshot();
            }
        }

        let sequence = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
        let snapshot = StatusSnapshot {
            state: request.state,
            message: sanitize_message(request.message),
            source: source.to_string(),
            sequence,
            timestamp_ms: now_ms,
        };

        {
            let mut current = self.current.lock().map_err(|_| CommandError {
                code: "state_lock_failed",
                message: "Could not update agent state".to_string(),
            })?;
            *current = snapshot.clone();
        }

        if is_manual_state_source(source) {
            let hold_until = now_ms.saturating_add(MANUAL_STATUS_HOLD_MS);
            self.manual_hold_until_ms
                .store(hold_until.min(u64::MAX as u128) as u64, Ordering::SeqCst);
        }

        self.emit_state(&snapshot);

        self.hardware.apply(&snapshot);

        Ok(snapshot)
    }

    fn hardware_snapshot(&self) -> Result<HardwareStatusSnapshot, CommandError> {
        self.hardware.snapshot()
    }

    fn set_light_settings(
        &self,
        request: LightSettingsRequest,
    ) -> Result<HardwareStatusSnapshot, CommandError> {
        let settings = LightSettings::try_from_request(request)?;
        self.hardware.set_light_settings(settings)?;
        let snapshot = self.snapshot()?;
        self.hardware.apply(&snapshot);
        self.hardware_snapshot()
    }

    fn emit_state(&self, snapshot: &StatusSnapshot) {
        let handle = match self.app_handle.lock() {
            Ok(handle) => handle,
            Err(_) => {
                eprintln!("agent-light: app handle lock failed");
                return;
            }
        };

        if let Some(app) = handle.as_ref() {
            if let Err(error) = app.emit("agent-state", snapshot) {
                eprintln!("agent-light: failed to emit state event: {error}");
            }
        }
    }

    fn start_hardware_watcher(&self) {
        let runtime = self.clone();
        thread::spawn(move || loop {
            let wait_ms = {
                match runtime.hardware.snapshot() {
                    Ok(snapshot) if snapshot.connected => HARDWARE_WATCHER_INTERVAL_MS,
                    Ok(snapshot)
                        if snapshot.available_ports.is_empty() && snapshot.port.is_none() =>
                    {
                        12_000
                    }
                    _ => HARDWARE_WATCHER_RETRY_INTERVAL_MS,
                }
            };
            thread::sleep(Duration::from_millis(wait_ms));

            let snapshot = match runtime.snapshot() {
                Ok(snapshot) => snapshot,
                Err(_) => continue,
            };

            let changed = runtime.hardware.probe_and_sync(&snapshot);
            if let Some(hardware_snapshot) = changed {
                let handle = runtime.app_handle.lock();
                if let Ok(handle) = handle {
                    if let Some(app) = handle.as_ref() {
                        if let Err(error) = app.emit(HARDWARE_STATE_EVENT, &hardware_snapshot) {
                            eprintln!("agent-light: failed to emit hardware state event: {error}");
                        }
                    }
                }
            }
        });
    }

    fn start_agent_monitor_watcher(&self) {
        let runtime = self.clone();
        thread::spawn(move || loop {
            sync_primary_agent_monitor(&runtime);
            thread::sleep(Duration::from_millis(AGENT_MONITOR_INTERVAL_MS));
        });
    }

    fn probe_hardware(&self) -> Result<HardwareStatusSnapshot, CommandError> {
        let snapshot = self.snapshot()?;
        self.hardware.probe_now(&snapshot)
    }
}

fn is_manual_state_source(source: &str) -> bool {
    matches!(source, "ui" | "local_api")
}

impl Default for LightSettings {
    fn default() -> Self {
        Self {
            standby: LightStateSettings {
                red: 0,
                green: 0,
                blue: 255,
                brightness: 100,
            },
            working: LightStateSettings {
                red: 255,
                green: 191,
                blue: 0,
                brightness: 100,
            },
            completed: LightStateSettings {
                red: 0,
                green: 255,
                blue: 0,
                brightness: 100,
            },
            attention: LightStateSettings {
                red: 255,
                green: 0,
                blue: 0,
                brightness: 100,
            },
        }
    }
}

impl LightSettings {
    fn try_from_request(request: LightSettingsRequest) -> Result<Self, CommandError> {
        Ok(Self {
            standby: validate_light_state(request.standby, "standby")?,
            working: validate_light_state(request.working, "working")?,
            completed: validate_light_state(request.completed, "completed")?,
            attention: validate_light_state(request.attention, "attention")?,
        })
    }

    fn frame_for_status(&self, status: &AgentStatus) -> HardwareFrame {
        let settings = match status {
            AgentStatus::Standby => self.standby,
            AgentStatus::Working => self.working,
            AgentStatus::Completed => self.completed,
            AgentStatus::Attention => self.attention,
        };
        let mode = match status {
            AgentStatus::Standby => "breathe",
            AgentStatus::Working => "steady",
            AgentStatus::Completed => "repeat_pulse",
            AgentStatus::Attention => "pulse",
        };
        HardwareFrame {
            red: scale_light_channel(settings.red, settings.brightness),
            green: scale_light_channel(settings.green, settings.brightness),
            blue: scale_light_channel(settings.blue, settings.brightness),
            mode,
        }
    }
}

fn validate_light_state(
    request: LightStateSettingsRequest,
    state: &'static str,
) -> Result<LightStateSettings, CommandError> {
    if request.red > 255 || request.green > 255 || request.blue > 255 || request.brightness > 100 {
        return Err(CommandError {
            code: "light_settings_invalid",
            message: format!("{state} light settings are outside the supported range"),
        });
    }
    Ok(LightStateSettings {
        red: request.red as u8,
        green: request.green as u8,
        blue: request.blue as u8,
        brightness: request.brightness as u8,
    })
}

fn scale_light_channel(value: u8, brightness: u8) -> u8 {
    ((u16::from(value) * u16::from(brightness)) / 100) as u8
}

#[derive(Clone)]
struct HardwareRuntime {
    inner: Arc<Mutex<HardwareRuntimeInner>>,
}

struct HardwareRuntimeInner {
    enabled: bool,
    explicit_port: Option<String>,
    baud: u32,
    light_settings: LightSettings,
    port: Option<String>,
    connected: bool,
    firmware_version: Option<String>,
    protocol_version: Option<String>,
    hardware_revision: Option<String>,
    last_state: Option<AgentStatus>,
    last_error: Option<String>,
    updated_at_ms: u128,
}

#[derive(Debug)]
struct HardwareWritePlan {
    port: String,
    command: String,
    state: AgentStatus,
}

#[derive(Debug)]
enum TickOutcome {
    NoChange,
    Write(HardwareWritePlan),
}

#[derive(Debug, Default)]
pub(crate) struct HardwareSerialReply {
    pub(crate) firmware_version: Option<String>,
    pub(crate) protocol_version: Option<String>,
    pub(crate) hardware_revision: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HardwareFrame {
    red: u8,
    green: u8,
    blue: u8,
    mode: &'static str,
}

impl HardwareRuntime {
    fn from_env() -> Self {
        let enabled = std::env::var("AGENT_LIGHT_HARDWARE")
            .map(|value| !matches!(value.to_ascii_lowercase().as_str(), "0" | "false" | "off"))
            .unwrap_or(true);
        let explicit_port = std::env::var("AGENT_LIGHT_SERIAL_PORT")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let baud = std::env::var("AGENT_LIGHT_SERIAL_BAUD")
            .ok()
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(HARDWARE_BAUD_DEFAULT);

        Self {
            inner: Arc::new(Mutex::new(HardwareRuntimeInner {
                enabled,
                explicit_port,
                baud,
                light_settings: LightSettings::default(),
                port: None,
                connected: false,
                firmware_version: None,
                protocol_version: None,
                hardware_revision: None,
                last_state: None,
                last_error: None,
                updated_at_ms: timestamp_ms(),
            })),
        }
    }

    fn apply(&self, snapshot: &StatusSnapshot) {
        let runtime = self.clone();
        let snapshot = snapshot.clone();
        thread::spawn(move || runtime.apply_blocking(&snapshot));
    }

    fn apply_blocking(&self, snapshot: &StatusSnapshot) {
        let (plan, baud) = {
            let mut inner = match self.inner.lock() {
                Ok(inner) => inner,
                Err(_) => {
                    eprintln!("agent-light: hardware state lock failed");
                    return;
                }
            };

            let baud = inner.baud;
            let plan = match inner.prepare_write(snapshot) {
                Ok(plan) => plan,
                Err(error) => {
                    inner.mark_error(error);
                    return;
                }
            };
            (plan, baud)
        };

        let Some(plan) = plan else {
            return;
        };

        let result = serial_io::write_serial_command(&plan.port, baud, &plan.command);
        match self.inner.lock() {
            Ok(mut inner) => inner.record_write_result(&plan.state, result),
            Err(_) => eprintln!("agent-light: hardware state lock failed"),
        }
    }

    fn set_light_settings(&self, settings: LightSettings) -> Result<(), CommandError> {
        self.inner
            .lock()
            .map(|mut inner| {
                inner.light_settings = settings;
                inner.updated_at_ms = timestamp_ms();
            })
            .map_err(|_| CommandError {
                code: "hardware_lock_failed",
                message: "Could not update hardware light settings".to_string(),
            })
    }

    fn snapshot(&self) -> Result<HardwareStatusSnapshot, CommandError> {
        self.inner
            .lock()
            .map(|inner| inner.snapshot())
            .map_err(|_| CommandError {
                code: "hardware_lock_failed",
                message: "Could not read hardware state".to_string(),
            })
    }

    fn probe_and_sync(&self, snapshot: &StatusSnapshot) -> Option<HardwareStatusSnapshot> {
        let (outcome, baud) = {
            let mut inner = self.inner.lock().ok()?;
            let baud = inner.baud;
            let outcome = inner.tick_plan(snapshot);
            (outcome, baud)
        };

        match outcome {
            TickOutcome::NoChange => None,
            TickOutcome::Write(plan) => {
                let result = serial_io::write_serial_command(&plan.port, baud, &plan.command);
                match self.inner.lock() {
                    Ok(mut inner) => {
                        inner.record_write_result(&plan.state, result);
                        Some(inner.snapshot())
                    }
                    Err(_) => None,
                }
            }
        }
    }

    fn probe_now(&self, snapshot: &StatusSnapshot) -> Result<HardwareStatusSnapshot, CommandError> {
        {
            let mut inner = self.inner.lock().map_err(|_| CommandError {
                code: "hardware_lock_failed",
                message: "Could not reset hardware state".to_string(),
            })?;
            inner.port = None;
            inner.connected = false;
            inner.last_error = None;
            inner.updated_at_ms = timestamp_ms();
        }
        self.apply_blocking(snapshot);
        self.snapshot()
    }
}

impl HardwareRuntimeInner {
    fn snapshot(&self) -> HardwareStatusSnapshot {
        let available_ports = list_available_serial_ports();
        HardwareStatusSnapshot {
            enabled: self.enabled,
            connected: self.enabled && self.connected && self.last_error.is_none(),
            protocol: HARDWARE_PROTOCOL.to_string(),
            firmware_version: self.firmware_version.clone(),
            protocol_version: self.protocol_version.clone(),
            hardware_revision: self.hardware_revision.clone(),
            port: self.port.clone().or_else(|| self.explicit_port.clone()),
            baud: self.baud,
            available_ports,
            last_state: self.last_state.clone(),
            last_error: self.last_error.clone(),
            updated_at_ms: self.updated_at_ms,
        }
    }

    fn prepare_write(
        &mut self,
        snapshot: &StatusSnapshot,
    ) -> Result<Option<HardwareWritePlan>, String> {
        if !self.enabled {
            self.connected = false;
            self.last_error = None;
            self.updated_at_ms = timestamp_ms();
            return Ok(None);
        }

        if self.connected
            && self.last_error.is_none()
            && self.last_state.as_ref() == Some(&snapshot.state)
        {
            return Ok(None);
        }

        let port = self.resolve_port()?;
        self.port = Some(port.clone());

        let frame = self.light_settings.frame_for_status(&snapshot.state);
        let command = format!(
            "AGENT_LIGHT protocol={} state={} r={} g={} b={} mode={} seq={}\n",
            HARDWARE_PROTOCOL,
            snapshot.state.as_str(),
            frame.red,
            frame.green,
            frame.blue,
            frame.mode,
            snapshot.sequence
        );

        Ok(Some(HardwareWritePlan {
            port,
            command,
            state: snapshot.state.clone(),
        }))
    }

    fn record_write_result(
        &mut self,
        state: &AgentStatus,
        result: Result<HardwareSerialReply, String>,
    ) {
        match result {
            Ok(reply) => {
                self.connected = true;
                self.record_serial_reply(reply);
                self.last_state = Some(state.clone());
                self.last_error = None;
                self.updated_at_ms = timestamp_ms();
            }
            Err(error) => {
                self.connected = false;
                self.port = None;
                let available_ports = list_available_serial_ports();
                self.mark_error(enrich_serial_error(
                    error,
                    &available_ports,
                    self.explicit_port.as_deref(),
                ));
            }
        }
    }

    fn record_serial_reply(&mut self, reply: HardwareSerialReply) {
        if let Some(firmware_version) = reply.firmware_version {
            self.firmware_version = Some(firmware_version);
        }
        if let Some(protocol_version) = reply.protocol_version {
            self.protocol_version = Some(protocol_version);
        }
        if let Some(hardware_revision) = reply.hardware_revision {
            self.hardware_revision = Some(hardware_revision);
        }
    }

    fn resolve_port(&mut self) -> Result<String, String> {
        let available_ports = list_available_serial_ports();
        if let Ok(port) = choose_serial_port(
            self.explicit_port.as_deref(),
            self.port.as_deref(),
            None,
            serial_port_is_present,
            &available_ports,
        ) {
            return Ok(port);
        }

        if let Some(port) = discover_serial_port(self.baud, &available_ports) {
            return Ok(port);
        }

        Err(serial_port_not_found_message(
            &available_ports,
            self.explicit_port.as_deref(),
        ))
    }

    fn mark_error(&mut self, error: String) {
        self.last_error = Some(error);
        self.updated_at_ms = timestamp_ms();
    }

    fn tick_plan(&mut self, snapshot: &StatusSnapshot) -> TickOutcome {
        if !self.enabled {
            return TickOutcome::NoChange;
        }

        if self.connected {
            let port_present = self
                .port
                .as_ref()
                .map(|port| serial_port_is_present(port))
                .unwrap_or(false);
            if port_present {
                return TickOutcome::NoChange;
            }
            self.connected = false;
            self.port = None;
            self.last_error = Some("ESP32 串口已断开，正在重新发现...".to_string());
            self.last_state = None;
            self.updated_at_ms = timestamp_ms();
        }

        match self.prepare_write(snapshot) {
            Ok(Some(plan)) => TickOutcome::Write(plan),
            Ok(None) => TickOutcome::NoChange,
            Err(error) => {
                self.mark_error(error);
                TickOutcome::NoChange
            }
        }
    }
}

fn serial_port_not_found_message(
    available_ports: &[String],
    explicit_port: Option<&str>,
) -> String {
    #[cfg(windows)]
    let env_hint = r#"$env:AGENT_LIGHT_SERIAL_PORT="COM5""#;
    #[cfg(not(windows))]
    let env_hint = "export AGENT_LIGHT_SERIAL_PORT=/dev/cu.usbmodem1101";

    if available_ports.is_empty() {
        #[cfg(windows)]
        {
            return format!(
                "系统未发现串口。请检查：① ESP32 USB 是否插好 ② 设备管理器「端口(COM 和 LPT)」是否出现新设备 ③ 安装 CP210x 或 CH340 驱动后重插。指定端口：PowerShell 执行 {env_hint} 后重启应用"
            );
        }
        #[cfg(not(windows))]
        {
            return format!(
                "系统未发现串口。请检查 USB 连接，并在终端执行 {env_hint} 后重启应用"
            );
        }
    }

    let ports_line = available_ports.join("、");
    if let Some(explicit) = explicit_port.filter(|port| {
        !available_ports
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(port))
    }) {
        return format!(
            "指定的 {explicit} 当前不可用。系统可见串口：{ports_line}。请用正确端口设置 {env_hint} 后重启，或拔掉其它 USB 串口设备。"
        );
    }

    format!(
        "未能连接 ESP32。系统可见串口：{ports_line}。应用会依次发送 PING 自动识别 Agent Light 固件；若仍失败，请设置 {env_hint} 后重启应用。"
    )
}

fn enrich_serial_error(
    error: String,
    available_ports: &[String],
    explicit_port: Option<&str>,
) -> String {
    if available_ports.is_empty() {
        return error;
    }
    if error.contains("系统可见串口") || error.contains("系统未发现串口") {
        return error;
    }
    let ports_line = available_ports.join("、");
    if let Some(explicit) = explicit_port {
        format!("{error}（已指定 {explicit}，系统可见串口：{ports_line}）")
    } else {
        format!("{error}（系统可见串口：{ports_line}）")
    }
}

fn choose_serial_port(
    explicit_port: Option<&str>,
    cached_port: Option<&str>,
    discovered_port: Option<String>,
    port_present: impl Fn(&str) -> bool,
    available_ports: &[String],
) -> Result<String, String> {
    if let Some(port) = explicit_port.filter(|port| port_present(port)) {
        return Ok(port.to_string());
    }
    if let Some(port) = cached_port.filter(|port| port_present(port)) {
        return Ok(port.to_string());
    }
    if let Some(port) = discovered_port {
        return Ok(port);
    }
    if let Some(port) = explicit_port {
        return Ok(port.to_string());
    }
    Err(serial_port_not_found_message(
        available_ports,
        explicit_port,
    ))
}

pub(crate) fn list_available_serial_ports() -> Vec<String> {
    platform::current().serial.list_ports()
}

pub(crate) fn discover_serial_port(baud: u32, ports: &[String]) -> Option<String> {
    serial_io::discover_agent_light_port(baud, ports)
}

fn serial_port_is_present(port: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        platform::windows::serial_port_present(port)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Path::new(port).exists()
    }
}

pub(crate) fn parse_hardware_serial_reply(reply: &str) -> HardwareSerialReply {
    HardwareSerialReply {
        firmware_version: value_for_serial_key(reply, "firmware_version="),
        protocol_version: value_for_serial_key(reply, "protocol_version="),
        hardware_revision: value_for_serial_key(reply, "hardware_revision="),
    }
}

fn value_for_serial_key(reply: &str, key: &str) -> Option<String> {
    let start = reply.find(key)? + key.len();
    let rest = &reply[start..];
    let end = rest
        .find(|character: char| character.is_ascii_whitespace())
        .unwrap_or(rest.len());
    let value = rest[..end].trim();

    (!value.is_empty()).then(|| value.to_string())
}

#[tauri::command]
fn get_status(runtime: State<'_, AgentRuntime>) -> Result<StatusSnapshot, CommandError> {
    runtime.snapshot()
}

#[tauri::command]
fn set_agent_state(
    runtime: State<'_, AgentRuntime>,
    request: StateRequest,
) -> Result<StatusSnapshot, CommandError> {
    runtime.apply(request, "ui")
}

#[tauri::command]
fn sync_codex_agent_state(
    runtime: State<'_, AgentRuntime>,
    request: StateRequest,
) -> Result<StatusSnapshot, CommandError> {
    runtime.apply(request, "codex_monitor")
}

#[tauri::command]
fn sync_cursor_agent_state(
    runtime: State<'_, AgentRuntime>,
    request: StateRequest,
) -> Result<StatusSnapshot, CommandError> {
    runtime.apply(request, "cursor_monitor")
}

fn position_settings_window(app: &AppHandle) -> Result<(), CommandError> {
    let main_window = get_main_window(app)?;
    let settings_window = app.get_webview_window("settings").ok_or(CommandError {
        code: "settings_window_missing",
        message: "Settings window is not configured".to_string(),
    })?;

    let main_position = main_window.outer_position().map_err(|error| CommandError {
        code: "window_position_failed",
        message: format!("Could not read main window position: {error}"),
    })?;
    let main_size = main_window.outer_size().map_err(|error| CommandError {
        code: "window_size_failed",
        message: format!("Could not read main window size: {error}"),
    })?;
    let settings_size = settings_window.outer_size().unwrap_or(tauri::PhysicalSize::new(780, 620));

    let mut target_x = main_position.x + main_size.width as i32 + SETTINGS_WINDOW_GAP_PX;
    let mut target_y = main_position.y;

    if let Some(monitor) = main_window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| main_window.primary_monitor().ok().flatten())
    {
        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();
        let monitor_right = monitor_pos.x + monitor_size.width as i32;
        let monitor_bottom = monitor_pos.y + monitor_size.height as i32;
        let settings_width = settings_size.width as i32;
        let settings_height = settings_size.height as i32;

        if target_x + settings_width > monitor_right {
            target_x = main_position.x;
            target_y = main_position.y + main_size.height as i32 + SETTINGS_WINDOW_GAP_PX;
        }

        if target_x + settings_width > monitor_right {
            target_x = monitor_right - settings_width - SETTINGS_WINDOW_GAP_PX;
        }
        if target_y + settings_height > monitor_bottom {
            target_y = monitor_bottom - settings_height - SETTINGS_WINDOW_GAP_PX;
        }

        target_x = target_x.clamp(monitor_pos.x, monitor_right - settings_width);
        target_y = target_y.clamp(monitor_pos.y, monitor_bottom - settings_height);
    }

    settings_window
        .set_position(PhysicalPosition::new(target_x, target_y))
        .map_err(|error| CommandError {
            code: "settings_window_position_failed",
            message: format!("Could not position settings window: {error}"),
        })?;

    Ok(())
}

fn show_settings_window(app: &AppHandle, focus: bool) -> Result<(), CommandError> {
    let window = app.get_webview_window("settings").ok_or(CommandError {
        code: "settings_window_missing",
        message: "Settings window is not configured".to_string(),
    })?;

    position_settings_window(app)?;

    let _ = window.unminimize();
    window.show().map_err(|error| CommandError {
        code: "settings_window_show_failed",
        message: format!("Could not show settings window: {error}"),
    })?;

    if focus {
        window.set_focus().map_err(|error| CommandError {
            code: "settings_window_focus_failed",
            message: format!("Could not focus settings window: {error}"),
        })?;
    } else if let Ok(main_window) = get_main_window(app) {
        let _ = main_window.set_focus();
    }

    window
        .emit(SETTINGS_PAGE_EVENT, "overview")
        .map_err(|error| CommandError {
            code: "settings_window_emit_failed",
            message: format!("Could not select settings page: {error}"),
        })?;

    Ok(())
}

#[tauri::command]
fn open_settings_window(app: AppHandle) -> Result<(), CommandError> {
    show_settings_window(&app, true)
}

#[tauri::command]
fn set_main_window_always_on_top(app: AppHandle, enabled: bool) -> Result<(), CommandError> {
    let window = get_main_window(&app)?;
    window.set_always_on_top(enabled).map_err(|error| CommandError {
        code: "window_always_on_top_failed",
        message: format!("Could not update main window always-on-top: {error}"),
    })
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

fn setup_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_settings =
        MenuItem::with_id(app, "open_settings", "打开桌宠", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Agent Light", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_settings, &quit])?;
    let icon = app
        .default_window_icon()
        .ok_or("default window icon is missing")?
        .clone();

    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("Agent Light")
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_settings" => {
                if let Err(error) = show_settings_window(app, true) {
                    eprintln!(
                        "agent-light: tray open settings failed: {} ({})",
                        error.message, error.code
                    );
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
fn hide_settings_window(app: AppHandle) -> Result<(), CommandError> {
    let window = app.get_webview_window("settings").ok_or(CommandError {
        code: "settings_window_missing",
        message: "Settings window is not configured".to_string(),
    })?;

    window.hide().map_err(|error| CommandError {
        code: "settings_window_hide_failed",
        message: format!("Could not hide settings window: {error}"),
    })?;

    if let Ok(main_window) = get_main_window(&app) {
        let _ = main_window.set_focus();
    }

    Ok(())
}

#[tauri::command]
fn get_main_window_placement(app: AppHandle) -> Result<WindowPlacement, CommandError> {
    let window = get_main_window(&app)?;
    read_window_placement(&window)
}

#[tauri::command]
fn move_main_window(app: AppHandle, x: i32, y: i32) -> Result<WindowPlacement, CommandError> {
    let window = get_main_window(&app)?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|error| CommandError {
            code: "window_move_failed",
            message: format!("Could not move main window: {error}"),
        })?;
    read_window_placement(&window)
}

#[tauri::command]
fn snap_main_window_to_top(app: AppHandle) -> Result<WindowPlacement, CommandError> {
    let window = get_main_window(&app)?;
    let position = window.outer_position().map_err(|error| CommandError {
        code: "window_position_failed",
        message: format!("Could not read main window position: {error}"),
    })?;
    let monitor_top = monitor_top_for_window(&window);

    if position.y <= monitor_top + TOP_SNAP_THRESHOLD {
        window
            .set_position(PhysicalPosition::new(position.x, monitor_top))
            .map_err(|error| CommandError {
                code: "window_snap_failed",
                message: format!("Could not snap main window to top: {error}"),
            })?;
    }

    read_window_placement(&window)
}

#[tauri::command]
fn get_system_metrics() -> SystemMetrics {
    platform::current().metrics.read_metrics()
}

#[tauri::command]
fn get_codex_status() -> CodexStatusSnapshot {
    platform::current().codex.read_status()
}

#[tauri::command]
fn get_cursor_status() -> CodexStatusSnapshot {
    platform::current().cursor.read_status()
}

#[tauri::command]
fn get_hardware_status(
    runtime: State<'_, AgentRuntime>,
) -> Result<HardwareStatusSnapshot, CommandError> {
    runtime.hardware_snapshot()
}

#[tauri::command]
fn probe_hardware(runtime: State<'_, AgentRuntime>) -> Result<HardwareStatusSnapshot, CommandError> {
    runtime.probe_hardware()
}

#[tauri::command]
fn set_light_settings(
    runtime: State<'_, AgentRuntime>,
    request: LightSettingsRequest,
) -> Result<HardwareStatusSnapshot, CommandError> {
    runtime.set_light_settings(request)
}

#[tauri::command]
fn get_installation_id() -> Result<String, CommandError> {
    platform::current().credentials.installation_id()
}

#[tauri::command]
fn load_cloud_session() -> Result<Option<CloudSessionSnapshot>, CommandError> {
    platform::current().credentials.load()
}

pub(crate) fn load_cloud_session_impl() -> Result<Option<CloudSessionSnapshot>, CommandError> {
    let path = cloud_session_path()?;
    if !path.exists() {
        return Ok(None);
    }

    let mut raw = String::new();
    File::open(&path)
        .and_then(|mut file| file.read_to_string(&mut raw))
        .map_err(|error| CommandError {
            code: "cloud_session_read_failed",
            message: format!("Could not read cloud session: {error}"),
        })?;

    let session = serde_json::from_str::<CloudSessionSnapshot>(&raw).map_err(|_| CommandError {
        code: "cloud_session_invalid",
        message: "Cloud session is not valid JSON".to_string(),
    })?;
    validate_cloud_session(&session)?;
    Ok(Some(session))
}

#[tauri::command]
fn save_cloud_session(request: CloudSessionSnapshot) -> Result<CloudSessionSnapshot, CommandError> {
    platform::current().credentials.save(request)
}

pub(crate) fn save_cloud_session_impl(request: CloudSessionSnapshot) -> Result<CloudSessionSnapshot, CommandError> {
    validate_cloud_session(&request)?;
    let path = cloud_session_path()?;
    let dir = path.parent().ok_or(CommandError {
        code: "cloud_session_path_failed",
        message: "Could not resolve cloud session directory".to_string(),
    })?;
    create_dir_all(dir).map_err(|error| CommandError {
        code: "cloud_session_write_failed",
        message: format!("Could not create cloud session directory: {error}"),
    })?;

    let json = serde_json::to_string_pretty(&request).map_err(|_| CommandError {
        code: "cloud_session_write_failed",
        message: "Could not serialize cloud session".to_string(),
    })?;
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| CommandError {
            code: "cloud_session_write_failed",
            message: format!("Could not open cloud session file: {error}"),
        })?;
    file.write_all(json.as_bytes()).map_err(|error| CommandError {
        code: "cloud_session_write_failed",
        message: format!("Could not write cloud session: {error}"),
    })?;
    file.flush().map_err(|error| CommandError {
        code: "cloud_session_write_failed",
        message: format!("Could not flush cloud session: {error}"),
    })?;
    restrict_file_to_user(&path)?;

    Ok(request)
}

#[tauri::command]
fn clear_cloud_session() -> Result<(), CommandError> {
    platform::current().credentials.clear()
}

pub(crate) fn clear_cloud_session_impl() -> Result<(), CommandError> {
    let path = cloud_session_path()?;
    match remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError {
            code: "cloud_session_clear_failed",
            message: format!("Could not clear cloud session: {error}"),
        }),
    }
}

#[tauri::command]
fn list_ai_tools() -> Result<Vec<ai_tools::AiToolStatus>, CommandError> {
    ai_tools::list_ai_tools()
}

#[tauri::command]
fn install_ai_tool(tool_id: String) -> Result<ai_tools::AiToolInstallResult, CommandError> {
    ai_tools::install_ai_tool(&tool_id)
}

#[tauri::command]
fn list_ai_tool_token_usages() -> Result<Vec<ai_tools::AiToolTokenUsage>, CommandError> {
    ai_tools::list_ai_tool_token_usages()
}

fn reveal_main_app(app: &AppHandle) -> Result<(), CommandError> {
    if let Some(activation_window) = app.get_webview_window("activation") {
        activation_window.hide().map_err(|error| CommandError {
            code: "activation_window_hide_failed",
            message: format!("Could not hide activation window: {error}"),
        })?;
    }

    let main_window = get_main_window(app)?;
    main_window.show().map_err(|error| CommandError {
        code: "main_window_show_failed",
        message: format!("Could not show main window: {error}"),
    })?;
    main_window.set_focus().map_err(|error| CommandError {
        code: "main_window_focus_failed",
        message: format!("Could not focus main window: {error}"),
    })?;

    Ok(())
}

fn sync_activation_windows(app: &AppHandle) {
    let activated = activation::is_client_activated().unwrap_or(false);

    if let Some(main_window) = app.get_webview_window("main") {
        if activated {
            let _ = main_window.show();
        } else {
            let _ = main_window.hide();
        }
    }

    if let Some(activation_window) = app.get_webview_window("activation") {
        if activated {
            let _ = activation_window.hide();
        } else {
            let _ = activation_window.show();
            let _ = activation_window.set_focus();
        }
    }
}

#[tauri::command]
fn activate_client(
    app: AppHandle,
    runtime: State<AgentRuntime>,
    server_url: String,
    activation_code: String,
) -> Result<activation::ActivationRecord, CommandError> {
    let record = activation::activate_client(server_url, activation_code)?;
    ensure_runtime_services(&runtime, &app);
    reveal_main_app(&app)?;
    Ok(record)
}

fn ensure_runtime_services(runtime: &AgentRuntime, app: &AppHandle) {
    if RUNTIME_SERVICES_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    start_local_api(runtime.clone());
    if let Ok(snapshot) = runtime.snapshot() {
        runtime.hardware.apply(&snapshot);
    }
    runtime.start_hardware_watcher();
    runtime.start_agent_monitor_watcher();
    sync::start_sync_worker();
    if let Err(error) = setup_system_tray(app) {
        eprintln!("agent-light: failed to create system tray: {error}");
    }
}

fn main() {
    let runtime = AgentRuntime::new();
    let managed_runtime = runtime.clone();

    let app = tauri::Builder::default()
        .manage(managed_runtime)
        .invoke_handler(tauri::generate_handler![
            get_status,
            set_agent_state,
            open_settings_window,
            set_main_window_always_on_top,
            hide_settings_window,
            exit_app,
            get_main_window_placement,
            move_main_window,
            snap_main_window_to_top,
            get_system_metrics,
            get_codex_status,
            get_cursor_status,
            get_hardware_status,
            probe_hardware,
            set_light_settings,
            sync_codex_agent_state,
            sync_cursor_agent_state,
            get_installation_id,
            load_cloud_session,
            save_cloud_session,
            clear_cloud_session,
            list_ai_tools,
            install_ai_tool,
            list_ai_tool_token_usages,
            activation::get_activation_status,
            activate_client,
        ])
        .setup(move |app| {
            eprintln!("agent-light: setup started");
            if let Err(error) = runtime.set_app_handle(app.handle().clone()) {
                eprintln!("agent-light: failed to store app handle: {}", error.message);
            }
            if activation::is_client_activated().unwrap_or(false) {
                ensure_runtime_services(&runtime, app.handle());
            }
            sync_activation_windows(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "activation" {
                if let WindowEvent::CloseRequested { .. } = event {
                    if !activation::is_client_activated().unwrap_or(false) {
                        window.app_handle().exit(0);
                    }
                }
            }

            if window.label() != "settings" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    eprintln!("agent-light: failed to hide settings window: {error}");
                }
            }
        })
        .run(tauri::generate_context!());

    if let Err(error) = app {
        eprintln!("agent-light: application error: {error}");
        std::process::exit(1);
    }
}

fn get_main_window(app: &AppHandle) -> Result<WebviewWindow, CommandError> {
    app.get_webview_window("main").ok_or(CommandError {
        code: "main_window_missing",
        message: "Main window is not configured".to_string(),
    })
}

pub(crate) fn config_dir_path() -> Result<PathBuf, CommandError> {
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            return Ok(PathBuf::from(appdata).join("Agent Light"));
        }
    }

    let home = std::env::var_os("HOME").ok_or(CommandError {
        code: "config_dir_unavailable",
        message: "Could not resolve user home directory".to_string(),
    })?;
    Ok(PathBuf::from(home).join(".agent-light"))
}

pub(crate) fn cloud_session_path() -> Result<PathBuf, CommandError> {
    Ok(config_dir_path()?.join(CLOUD_SESSION_FILE_NAME))
}

fn installation_id_path() -> Result<PathBuf, CommandError> {
    Ok(config_dir_path()?.join(INSTALLATION_ID_FILE_NAME))
}

pub(crate) fn read_or_create_installation_id() -> Result<String, CommandError> {
    let path = installation_id_path()?;
    if path.exists() {
        let mut value = String::new();
        File::open(&path)
            .and_then(|mut file| file.read_to_string(&mut value))
            .map_err(|error| CommandError {
                code: "installation_id_read_failed",
                message: format!("Could not read installation id: {error}"),
            })?;
        let normalized = value.trim().to_string();
        if is_valid_identifier(&normalized, 12, 128) {
            return Ok(normalized);
        }
    }

    let dir = path.parent().ok_or(CommandError {
        code: "installation_id_path_failed",
        message: "Could not resolve installation id directory".to_string(),
    })?;
    create_dir_all(dir).map_err(|error| CommandError {
        code: "installation_id_write_failed",
        message: format!("Could not create installation id directory: {error}"),
    })?;
    let installation_id = generate_installation_id();
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| CommandError {
            code: "installation_id_write_failed",
            message: format!("Could not open installation id file: {error}"),
        })?;
    file.write_all(installation_id.as_bytes()).map_err(|error| CommandError {
        code: "installation_id_write_failed",
        message: format!("Could not write installation id: {error}"),
    })?;
    file.flush().map_err(|error| CommandError {
        code: "installation_id_write_failed",
        message: format!("Could not flush installation id: {error}"),
    })?;
    restrict_file_to_user(&path)?;
    Ok(installation_id)
}

fn validate_cloud_session(session: &CloudSessionSnapshot) -> Result<(), CommandError> {
    if !is_valid_server_url(&session.server_url) {
        return Err(CommandError {
            code: "cloud_session_invalid",
            message: "Cloud server URL must use http or https".to_string(),
        });
    }

    for (label, value, min, max) in [
        ("access token", session.access_token.as_str(), 32, MAX_CLOUD_TOKEN_LEN),
        ("refresh token", session.refresh_token.as_str(), 32, MAX_CLOUD_TOKEN_LEN),
        ("user id", session.user_id.as_str(), 1, 128),
        ("user email", session.user_email.as_str(), 3, 254),
        ("display name", session.display_name.as_str(), 1, 120),
        ("workspace id", session.workspace_id.as_str(), 1, 128),
        ("installation id", session.installation_id.as_str(), 12, 128),
    ] {
        if !is_valid_identifier(value, min, max) {
            return Err(CommandError {
                code: "cloud_session_invalid",
                message: format!("Cloud session {label} is invalid"),
            });
        }
    }

    if let Some(device_id) = session.device_id.as_ref() {
        if !is_valid_identifier(device_id, 1, 128) {
            return Err(CommandError {
                code: "cloud_session_invalid",
                message: "Cloud session device id is invalid".to_string(),
            });
        }
    }

    if let Some(phone_number) = session.user_phone_number.as_ref() {
        if !is_valid_identifier(phone_number, 8, 16) {
            return Err(CommandError {
                code: "cloud_session_invalid",
                message: "Cloud session phone number is invalid".to_string(),
            });
        }
    }

    Ok(())
}

fn is_valid_server_url(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_CLOUD_URL_LEN || trimmed.chars().any(char::is_whitespace) {
        return false;
    }
    trimmed.starts_with("http://") || trimmed.starts_with("https://")
}

fn is_valid_identifier(value: &str, min: usize, max: usize) -> bool {
    let trimmed = value.trim();
    trimmed.len() >= min && trimmed.len() <= max && !trimmed.chars().any(char::is_control)
}

fn restrict_file_to_user(_path: &Path) -> Result<(), CommandError> {
    #[cfg(unix)]
    {
        std::fs::set_permissions(_path, std::fs::Permissions::from_mode(0o600)).map_err(|error| {
            CommandError {
                code: "credential_permissions_failed",
                message: format!("Could not restrict credential file permissions: {error}"),
            }
        })?;
    }

    Ok(())
}

fn generate_installation_id() -> String {
    let mut bytes = [0u8; 16];
    if File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_ok()
    {
        return format!("agent-light-{}", bytes_to_hex(&bytes));
    }

    format!(
        "agent-light-{}-{}",
        timestamp_ms(),
        std::process::id()
    )
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push_str(&format!("{byte:02x}"));
    }
    value
}

pub(crate) fn read_codex_status() -> CodexStatusSnapshot {
    let sampled_at_ms = timestamp_ms();
    let latest_thread = read_latest_codex_thread();
    let raw_login_label = read_codex_login_label();
    let command_logged_in = raw_login_label
        .as_ref()
        .is_some_and(|label| label.to_ascii_lowercase().contains("logged in")
            || label.contains("已登录")
            || label.contains("ChatGPT"));
    let logged_in = command_logged_in || latest_thread.is_some();
    let login_label = raw_login_label.unwrap_or_else(|| {
        if latest_thread.is_some() {
            "已检测到本地 Codex 线程".to_string()
        } else {
            "未检测到 Codex CLI".to_string()
        }
    });

    let active_age_seconds = latest_thread
        .as_ref()
        .and_then(|thread| thread.updated_at_ms)
        .map(|updated_at_ms| sampled_at_ms.saturating_sub(updated_at_ms) / 1000)
        .and_then(|seconds| u64::try_from(seconds).ok());
    let thread_activity = latest_thread
        .as_ref()
        .map(|thread| read_codex_thread_activity(Path::new(&thread.rollout_path)))
        .unwrap_or(CodexThreadActivity::Unknown);
    let is_recent =
        active_age_seconds.is_some_and(|seconds| seconds <= CODEX_ACTIVE_WINDOW_SECONDS);
    let is_stale_active =
        active_age_seconds.is_some_and(|seconds| seconds <= CODEX_STALE_ACTIVE_WINDOW_SECONDS);
    let is_recent_completed =
        active_age_seconds.is_some_and(|seconds| seconds <= CODEX_COMPLETED_WINDOW_SECONDS);
    let state = if thread_activity == CodexThreadActivity::AwaitingFunctionOutput
        && active_age_seconds.is_some_and(|seconds| seconds >= CODEX_PENDING_APPROVAL_SECONDS)
    {
        AgentStatus::Attention
    } else if thread_activity == CodexThreadActivity::AwaitingFunctionOutput {
        AgentStatus::Working
    } else if thread_activity == CodexThreadActivity::Active && is_stale_active {
        AgentStatus::Working
    } else if thread_activity == CodexThreadActivity::Completed && is_recent_completed {
        AgentStatus::Completed
    } else if is_recent {
        AgentStatus::Working
    } else if !logged_in && latest_thread.is_none() {
        AgentStatus::Attention
    } else {
        AgentStatus::Standby
    };
    let is_working = state == AgentStatus::Working;

    CodexStatusSnapshot {
        available: logged_in || latest_thread.is_some(),
        logged_in,
        login_label,
        quota_label: if logged_in { "未开放".to_string() } else { "未登录".to_string() },
        quota_detail: "Codex 本地 CLI/schema 未提供剩余额度字段，先显示已用 token 和登录状态".to_string(),
        state,
        is_working,
        latest_thread_id: latest_thread.as_ref().map(|thread| thread.id.clone()),
        latest_model: latest_thread.as_ref().and_then(|thread| thread.model.clone()),
        latest_source: latest_thread.as_ref().and_then(|thread| thread.source.clone()),
        latest_cwd: latest_thread.as_ref().and_then(|thread| thread.cwd.clone()),
        tokens_used: latest_thread.as_ref().and_then(|thread| thread.tokens_used),
        thread_updated_at_ms: latest_thread.as_ref().and_then(|thread| thread.updated_at_ms),
        active_age_seconds,
        sampled_at_ms,
    }
}

fn read_codex_login_label() -> Option<String> {
    let codex = find_codex_binary()?;
    run_command_capture(&codex, &["login", "status"]).and_then(|output| {
        output
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with("WARNING:"))
            .map(ToString::to_string)
    })
}

fn read_latest_codex_thread() -> Option<CodexThreadRow> {
    let db_path = codex_state_db_path()?;
    if !db_path.exists() {
        return None;
    }

    let conn = rusqlite::Connection::open(&db_path).ok()?;
    let query = "select id, source, model, cwd, rollout_path, updated_at_ms, tokens_used \
        from threads \
        where archived=0 \
          and coalesce(thread_source, 'user') != 'subagent' \
          and coalesce(model, '') != 'codex-auto-review' \
          and source not like '%\"subagent\"%' \
        order by recency_at_ms desc, updated_at_ms desc limit 1";

    conn.query_row(query, [], |row| {
        let updated_at_ms: Option<i64> = row.get(5)?;
        let tokens_used: Option<i64> = row.get(6)?;
        Ok(CodexThreadRow {
            id: row.get(0)?,
            source: row.get(1)?,
            model: row.get(2)?,
            cwd: row.get(3)?,
            rollout_path: row.get(4)?,
            updated_at_ms: updated_at_ms.map(|value| value.max(0) as u128),
            tokens_used: tokens_used.map(|value| value.max(0) as u64),
        })
    })
    .ok()
}

fn read_codex_thread_activity(path: &Path) -> CodexThreadActivity {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return CodexThreadActivity::Unknown,
    };
    let file_len = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let start = file_len.saturating_sub(CODEX_SESSION_TAIL_BYTES);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return CodexThreadActivity::Unknown;
    }

    let mut tail = String::new();
    if file.read_to_string(&mut tail).is_err() {
        return CodexThreadActivity::Unknown;
    }

    classify_codex_thread_activity(&tail)
}

pub(crate) fn classify_codex_thread_activity(tail: &str) -> CodexThreadActivity {
    for line in tail.lines().rev().map(str::trim).filter(|line| !line.is_empty()) {
        let value = match serde_json::from_str::<serde_json::Value>(line) {
            Ok(value) => value,
            Err(_) => continue,
        };

        if value.get("type").and_then(|field| field.as_str()) == Some("turn_aborted") {
            return CodexThreadActivity::Unknown;
        }

        let Some(payload) = value.get("payload") else {
            continue;
        };

        match payload.get("type").and_then(|field| field.as_str()) {
            Some("function_call") => {
                return CodexThreadActivity::AwaitingFunctionOutput;
            }
            Some("function_call_output") | Some("reasoning") => {
                return CodexThreadActivity::Active;
            }
            Some("message") => {
                let role = payload.get("role").and_then(|field| field.as_str());
                if role == Some("assistant") {
                    let phase = payload.get("phase").and_then(|field| field.as_str());
                    return if phase == Some("commentary") {
                        CodexThreadActivity::Active
                    } else {
                        CodexThreadActivity::Completed
                    };
                }
                if role == Some("user") {
                    return CodexThreadActivity::Active;
                }
            }
            _ => {}
        }

        match value.get("type").and_then(|field| field.as_str()) {
            Some("response_item") => continue,
            Some("event_msg") => {
                let payload_type = payload.get("type").and_then(|field| field.as_str());
                if payload_type == Some("agent_message") {
                    return CodexThreadActivity::Active;
                }
            }
            _ => {}
        }
    }

    CodexThreadActivity::Unknown
}

pub(crate) fn codex_state_db_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var_os("USERPROFILE")?;
        Some(PathBuf::from(home).join(".codex").join("state_5.sqlite"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var_os("HOME")?;
        Some(PathBuf::from(home).join(".codex").join("state_5.sqlite"))
    }
}

pub(crate) fn find_codex_binary() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = process_util::hidden_command("where").arg("codex").output() {
            if output.status.success() {
                if let Ok(text) = String::from_utf8(output.stdout) {
                    if let Some(first) = text.lines().map(str::trim).find(|line| !line.is_empty()) {
                        let path = PathBuf::from(first);
                        if path.exists() {
                            return Some(path);
                        }
                    }
                }
            }
        }

        let mut candidates = Vec::new();
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(&local_app_data)
                    .join("Programs")
                    .join("codex")
                    .join("codex.exe"),
            );
        }
        if let Some(app_data) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(&app_data).join("npm").join("codex.cmd"));
            candidates.push(PathBuf::from(&app_data).join("npm").join("codex"));
        }
        return candidates.into_iter().find(|path| path.exists());
    }

    #[cfg(not(target_os = "windows"))]
    {
        [
            "/Applications/Codex.app/Contents/Resources/codex",
            "/opt/homebrew/bin/codex",
            "/usr/local/bin/codex",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
    }
}

fn run_command_capture(program: &Path, args: &[&str]) -> Option<String> {
    let output = process_util::hidden_command(program)
        .args(args)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(test)]
fn hardware_frame_for_status(status: &AgentStatus) -> HardwareFrame {
    LightSettings::default().frame_for_status(status)
}

fn read_window_placement(window: &WebviewWindow) -> Result<WindowPlacement, CommandError> {
    let position = window.outer_position().map_err(|error| CommandError {
        code: "window_position_failed",
        message: format!("Could not read main window position: {error}"),
    })?;
    let monitor_top = monitor_top_for_window(window);

    Ok(WindowPlacement {
        x: position.x,
        y: position.y,
        near_top: position.y <= monitor_top + TOP_DOCK_THRESHOLD,
    })
}

fn monitor_top_for_window(window: &WebviewWindow) -> i32 {
    window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .map(|monitor| monitor.position().y)
        .unwrap_or(0)
}

struct AgentMonitorPick {
    state: AgentStatus,
    message: String,
    source: &'static str,
}

fn agent_state_priority(state: &AgentStatus) -> u8 {
    match state {
        AgentStatus::Attention => 5,
        AgentStatus::Working => 4,
        AgentStatus::Completed => 2,
        AgentStatus::Standby => 1,
    }
}

fn monitor_state_label(state: &AgentStatus) -> &'static str {
    match state {
        AgentStatus::Working => "正在工作",
        AgentStatus::Completed => "本轮已完成",
        AgentStatus::Attention => "需处理",
        AgentStatus::Standby => "待命中",
    }
}

fn pick_primary_agent_monitor(
    cursor: &CodexStatusSnapshot,
    codex: &CodexStatusSnapshot,
) -> Option<AgentMonitorPick> {
    let mut candidates: Vec<(u8, bool, AgentMonitorPick)> = Vec::new();

    if cursor.available {
        candidates.push((
            agent_state_priority(&cursor.state),
            true,
            AgentMonitorPick {
                state: cursor.state.clone(),
                message: format!("Cursor {}", monitor_state_label(&cursor.state)),
                source: "cursor_monitor",
            },
        ));
    }
    if codex.available {
        candidates.push((
            agent_state_priority(&codex.state),
            false,
            AgentMonitorPick {
                state: codex.state.clone(),
                message: format!("Codex {}", monitor_state_label(&codex.state)),
                source: "codex_monitor",
            },
        ));
    }

    if candidates.is_empty() {
        return None;
    }

    candidates.sort_by(|left, right| {
        right.0.cmp(&left.0).then_with(|| {
            if left.1 && !right.1 {
                std::cmp::Ordering::Less
            } else if !left.1 && right.1 {
                std::cmp::Ordering::Greater
            } else {
                std::cmp::Ordering::Equal
            }
        })
    });

    Some(candidates.remove(0).2)
}

fn sync_primary_agent_monitor(runtime: &AgentRuntime) {
    let cursor = cursor::read_cursor_status();
    let codex = read_codex_status();

    let Some(pick) = pick_primary_agent_monitor(&cursor, &codex) else {
        let _ = runtime.apply(
            StateRequest {
                state: AgentStatus::Attention,
                message: Some("Cursor / Codex 均不可用".to_string()),
            },
            "cursor_monitor",
        );
        return;
    };

    let current = match runtime.snapshot() {
        Ok(snapshot) => snapshot,
        Err(_) => return,
    };

    if current.state == pick.state && current.message.as_deref() == Some(pick.message.as_str()) {
        return;
    }

    let _ = runtime.apply(
        StateRequest {
            state: pick.state,
            message: Some(pick.message),
        },
        pick.source,
    );
}

fn start_local_api(runtime: AgentRuntime) {
    thread::spawn(move || {
        eprintln!("agent-light: starting local API on http://{API_ADDR}");
        let listener = match TcpListener::bind(API_ADDR) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("agent-light: local API disabled, could not bind {API_ADDR}: {error}");
                return;
            }
        };

        eprintln!("agent-light: local API listening on http://{API_ADDR}");

        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let runtime = runtime.clone();
                    thread::spawn(move || handle_connection(stream, runtime));
                }
                Err(error) => eprintln!("agent-light: local API connection failed: {error}"),
            }
        }
    });
}

fn handle_connection(mut stream: TcpStream, runtime: AgentRuntime) {
    if let Err(error) = stream.set_read_timeout(Some(Duration::from_secs(2))) {
        eprintln!("agent-light: failed to set API read timeout: {error}");
    }

    if !activation::is_client_activated().unwrap_or(false) {
        write_error(
            &mut stream,
            403,
            "client_not_activated",
            "Client is not activated",
        );
        return;
    }

    let parsed = parse_http_request(&stream);
    match parsed {
        Ok(HttpRequest {
            method,
            path,
            body: _,
        }) if method == "OPTIONS" && path == "/api/state" => {
            write_response(&mut stream, 204, "");
        }
        Ok(HttpRequest {
            method,
            path,
            body,
        }) if method == "POST" && path == "/api/state" => {
            let result = serde_json::from_slice::<StateRequest>(&body)
                .map_err(|error| CommandError {
                    code: "invalid_json",
                    message: format!("Invalid JSON body: {error}"),
                })
                .and_then(|request| runtime.apply(request, "local_api"));

            match result {
                Ok(snapshot) => match serde_json::to_string(&snapshot) {
                    Ok(body) => write_response(&mut stream, 200, &body),
                    Err(error) => write_error(&mut stream, 500, "serialize_failed", &error.to_string()),
                },
                Err(error) => write_error(&mut stream, 400, error.code, &error.message),
            }
        }
        Ok(HttpRequest { method, path, .. }) if method == "GET" && path == "/api/state" => {
            match runtime.snapshot().and_then(|snapshot| {
                serde_json::to_string(&snapshot).map_err(|error| CommandError {
                    code: "serialize_failed",
                    message: error.to_string(),
                })
            }) {
                Ok(body) => write_response(&mut stream, 200, &body),
                Err(error) => write_error(&mut stream, 500, error.code, &error.message),
            }
        }
        Ok(HttpRequest { method, path, .. }) if method == "GET" && path == "/api/codex" => {
            match serde_json::to_string(&platform::current().codex.read_status()) {
                Ok(body) => write_response(&mut stream, 200, &body),
                Err(error) => write_error(&mut stream, 500, "serialize_failed", &error.to_string()),
            }
        }
        Ok(HttpRequest { method, path, .. }) if method == "GET" && path == "/api/cursor" => {
            match serde_json::to_string(&platform::current().cursor.read_status()) {
                Ok(body) => write_response(&mut stream, 200, &body),
                Err(error) => write_error(&mut stream, 500, "serialize_failed", &error.to_string()),
            }
        }
        Ok(HttpRequest { method, path, .. }) if method == "GET" && path == "/api/hardware" => {
            match runtime.hardware_snapshot().and_then(|snapshot| {
                serde_json::to_string(&snapshot).map_err(|error| CommandError {
                    code: "serialize_failed",
                    message: error.to_string(),
                })
            }) {
                Ok(body) => write_response(&mut stream, 200, &body),
                Err(error) => write_error(&mut stream, 500, error.code, &error.message),
            }
        }
        Ok(_) => write_error(&mut stream, 404, "not_found", "Use POST /api/state"),
        Err(error) => write_error(&mut stream, 400, error.code, &error.message),
    }
}

struct HttpRequest {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn parse_http_request(stream: &TcpStream) -> Result<HttpRequest, CommandError> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|error| CommandError {
        code: "stream_clone_failed",
        message: error.to_string(),
    })?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|error| CommandError {
        code: "request_read_failed",
        message: error.to_string(),
    })?;

    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    if method.is_empty() || path.is_empty() {
        return Err(CommandError {
            code: "invalid_request_line",
            message: "Request line is missing method or path".to_string(),
        });
    }

    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        let bytes = reader.read_line(&mut line).map_err(|error| CommandError {
            code: "header_read_failed",
            message: error.to_string(),
        })?;
        if bytes == 0 || line == "\r\n" || line == "\n" {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().map_err(|_| CommandError {
                    code: "invalid_content_length",
                    message: "Content-Length must be a number".to_string(),
                })?;
            }
        }
    }

    if content_length > MAX_BODY_LEN {
        return Err(CommandError {
            code: "body_too_large",
            message: format!("Request body must be <= {MAX_BODY_LEN} bytes"),
        });
    }

    let mut body = vec![0; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).map_err(|error| CommandError {
            code: "body_read_failed",
            message: error.to_string(),
        })?;
    }

    Ok(HttpRequest { method, path, body })
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str) {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    if let Err(error) = stream.write_all(response.as_bytes()) {
        eprintln!("agent-light: failed to write API response: {error}");
    }
}

fn write_error(stream: &mut TcpStream, status: u16, code: &str, message: &str) {
    let body = serde_json::json!({
        "code": code,
        "message": message,
    })
    .to_string();
    write_response(stream, status, &body);
}

fn sanitize_message(message: Option<String>) -> Option<String> {
    message.map(|raw| {
        let trimmed = raw.trim().replace(['\n', '\r', '\t'], " ");
        trimmed.chars().take(MAX_MESSAGE_LEN).collect()
    })
}

pub(crate) fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        classify_codex_thread_activity, choose_serial_port, hardware_frame_for_status,
        AgentStatus, parse_hardware_serial_reply, CodexThreadActivity, HardwareFrame,
        HardwareRuntimeInner, LightSettings, LightStateSettings, StatusSnapshot,
        HARDWARE_BAUD_DEFAULT, HARDWARE_PROTOCOL,
    };

    const NO_PORTS: &[String] = &[];

    #[test]
    fn classifies_pending_function_call_as_awaiting_output() {
        let tail = r#"{"type":"response_item","payload":{"type":"function_call","name":"shell_command"}}"#;
        assert_eq!(
            classify_codex_thread_activity(tail),
            CodexThreadActivity::AwaitingFunctionOutput
        );
    }

    #[test]
    fn classifies_function_call_output_as_active() {
        let tail = r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_1"}}"#;
        assert_eq!(
            classify_codex_thread_activity(tail),
            CodexThreadActivity::Active
        );
    }

    #[test]
    fn classifies_commentary_message_as_active() {
        let tail = r#"{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary"}}"#;
        assert_eq!(
            classify_codex_thread_activity(tail),
            CodexThreadActivity::Active
        );
    }

    #[test]
    fn classifies_final_assistant_message_as_completed() {
        let tail = r#"{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final"}}"#;
        assert_eq!(
            classify_codex_thread_activity(tail),
            CodexThreadActivity::Completed
        );
    }

    #[test]
    fn classifies_aborted_turn_as_unknown() {
        let tail = r#"{"type":"turn_aborted","payload":{"reason":"interrupted"}}"#;
        assert_eq!(
            classify_codex_thread_activity(tail),
            CodexThreadActivity::Unknown
        );
    }

    #[test]
    fn maps_agent_status_to_requested_hardware_light_frames() {
        assert_eq!(
            hardware_frame_for_status(&AgentStatus::Standby),
            HardwareFrame {
                red: 0,
                green: 0,
                blue: 255,
                mode: "breathe",
            }
        );
        assert_eq!(
            hardware_frame_for_status(&AgentStatus::Working),
            HardwareFrame {
                red: 255,
                green: 191,
                blue: 0,
                mode: "steady",
            }
        );
        assert_eq!(
            hardware_frame_for_status(&AgentStatus::Completed),
            HardwareFrame {
                red: 0,
                green: 255,
                blue: 0,
                mode: "repeat_pulse",
            }
        );
        assert_eq!(
            hardware_frame_for_status(&AgentStatus::Attention),
            HardwareFrame {
                red: 255,
                green: 0,
                blue: 0,
                mode: "pulse",
            }
        );
    }

    #[test]
    fn applies_custom_light_settings_to_hardware_frames() {
        let settings = LightSettings {
            standby: LightStateSettings {
                red: 10,
                green: 20,
                blue: 200,
                brightness: 50,
            },
            working: LightStateSettings {
                red: 200,
                green: 100,
                blue: 50,
                brightness: 40,
            },
            completed: LightStateSettings {
                red: 0,
                green: 255,
                blue: 0,
                brightness: 100,
            },
            attention: LightStateSettings {
                red: 255,
                green: 0,
                blue: 0,
                brightness: 100,
            },
        };

        assert_eq!(
            settings.frame_for_status(&AgentStatus::Working),
            HardwareFrame {
                red: 80,
                green: 40,
                blue: 20,
                mode: "steady",
            }
        );
        assert_eq!(
            settings.frame_for_status(&AgentStatus::Standby),
            HardwareFrame {
                red: 5,
                green: 10,
                blue: 100,
                mode: "breathe",
            }
        );
    }

    #[test]
    fn disabled_hardware_prepare_clears_connection_state() {
        let mut inner = HardwareRuntimeInner {
            enabled: false,
            explicit_port: Some("/dev/cu.fake".to_string()),
            baud: HARDWARE_BAUD_DEFAULT,
            light_settings: LightSettings::default(),
            port: Some("/dev/cu.fake".to_string()),
            connected: true,
            firmware_version: Some("old".to_string()),
            protocol_version: Some(HARDWARE_PROTOCOL.to_string()),
            hardware_revision: Some("dev".to_string()),
            last_state: Some(AgentStatus::Working),
            last_error: Some("old error".to_string()),
            updated_at_ms: 0,
        };
        let snapshot = StatusSnapshot {
            state: AgentStatus::Standby,
            message: None,
            source: "test".to_string(),
            sequence: 7,
            timestamp_ms: 0,
        };

        let plan = inner.prepare_write(&snapshot).expect("prepare write");

        assert!(plan.is_none());
        assert!(!inner.snapshot().connected);
        assert_eq!(inner.snapshot().last_error, None);
        assert_eq!(inner.snapshot().last_state, Some(AgentStatus::Working));
    }

    #[test]
    fn hardware_write_failure_marks_disconnected_without_panicking() {
        let mut inner = HardwareRuntimeInner {
            enabled: true,
            explicit_port: Some("/dev/cu.fake".to_string()),
            baud: HARDWARE_BAUD_DEFAULT,
            light_settings: LightSettings::default(),
            port: Some("/dev/cu.fake".to_string()),
            connected: true,
            firmware_version: None,
            protocol_version: None,
            hardware_revision: None,
            last_state: Some(AgentStatus::Completed),
            last_error: None,
            updated_at_ms: 0,
        };

        inner.record_write_result(&AgentStatus::Attention, Err("serial busy".to_string()));

        let snapshot = inner.snapshot();
        assert!(!snapshot.connected);
        assert_eq!(inner.port, None);
        assert_eq!(snapshot.last_error.as_deref().map(|error| error.starts_with("serial busy")), Some(true));
        assert_eq!(snapshot.last_state, Some(AgentStatus::Completed));
    }

    #[test]
    fn choose_serial_port_prefers_present_explicit_port() {
        let chosen = choose_serial_port(
            Some("COM5"),
            Some("COM3"),
            Some("COM7".to_string()),
            |port| port == "COM5" || port == "COM3",
            &["COM3".to_string(), "COM5".to_string(), "COM7".to_string()],
        )
        .expect("explicit port");

        assert_eq!(chosen, "COM5");
    }

    #[test]
    fn choose_serial_port_falls_back_to_discovered_when_cached_missing() {
        let chosen = choose_serial_port(
            None,
            Some("COM3"),
            Some("COM7".to_string()),
            |port| port == "COM7",
            &["COM7".to_string()],
        )
        .expect("discovered port");

        assert_eq!(chosen, "COM7");
    }

    #[test]
    fn choose_serial_port_falls_back_when_explicit_port_unplugged() {
        let chosen = choose_serial_port(
            Some("COM3"),
            Some("COM3"),
            Some("COM7".to_string()),
            |port| port == "COM7",
            &["COM7".to_string()],
        )
        .expect("new port after hot-plug");

        assert_eq!(chosen, "COM7");
    }

    #[test]
    fn choose_serial_port_returns_error_when_no_port_available() {
        let error = choose_serial_port(None, Some("COM3"), None, |_| false, NO_PORTS)
            .expect_err("missing port");

        assert!(error.contains("系统未发现串口"));
    }

    #[test]
    fn parses_hardware_serial_version_reply() {
        let reply = parse_hardware_serial_reply(concat!(
            "OK state=working firmware_version=0.2.0 ",
            "protocol_version=agent-light-rgb-v1 ",
            "hardware_revision=esp32-mini-rgb-dev\n"
        ));

        assert_eq!(reply.firmware_version.as_deref(), Some("0.2.0"));
        assert_eq!(reply.protocol_version.as_deref(), Some("agent-light-rgb-v1"));
        assert_eq!(reply.hardware_revision.as_deref(), Some("esp32-mini-rgb-dev"));
    }

    #[test]
    fn hardware_prepare_write_builds_protocol_frame_without_opening_port() {
        let mut inner = HardwareRuntimeInner {
            enabled: true,
            explicit_port: Some("/dev/cu.fake".to_string()),
            baud: HARDWARE_BAUD_DEFAULT,
            light_settings: LightSettings::default(),
            port: None,
            connected: false,
            firmware_version: None,
            protocol_version: None,
            hardware_revision: None,
            last_state: None,
            last_error: None,
            updated_at_ms: 0,
        };
        let snapshot = StatusSnapshot {
            state: AgentStatus::Attention,
            message: None,
            source: "test".to_string(),
            sequence: 42,
            timestamp_ms: 0,
        };

        let plan = inner
            .prepare_write(&snapshot)
            .expect("prepare write")
            .expect("write plan");

        assert_eq!(plan.port, "/dev/cu.fake");
        assert_eq!(plan.state, AgentStatus::Attention);
        assert!(plan.command.contains("protocol=agent-light-rgb-v1"));
        assert!(plan.command.contains("state=attention"));
        assert!(plan.command.contains("seq=42"));
    }

}
