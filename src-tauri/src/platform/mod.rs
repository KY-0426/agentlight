//! Platform adaptation layer for Agent Light desktop.
//!
//! 抽象 macOS / Windows 平台差异，定义四个 Provider trait：
//! - [`CodexStatusProvider`]：读取 Codex state_5.sqlite 状态
//! - [`SystemMetricsProvider`]：采集 CPU / 内存指标
//! - [`SerialPortProvider`]：发现并写入串口（ESP32 RGB）
//! - [`SecureCredentialStore`]：持久化云端会话凭据
//!
//! 通过 [`Platform::detect`] 在编译期选择当前平台的实现；[`current`] 返回进程内单例。

use std::sync::OnceLock;

#[cfg(target_os = "windows")]
pub(crate) mod windows;
#[cfg(not(target_os = "windows"))]
mod macos;

static PLATFORM: OnceLock<Platform> = OnceLock::new();

/// 返回当前平台的 Provider 单例（首次调用时初始化）。
pub fn current() -> &'static Platform {
    PLATFORM.get_or_init(Platform::detect)
}

/// 读取 Codex 本地状态（sqlite + login label）。
pub trait CodexStatusProvider: Send + Sync {
    fn read_status(&self) -> crate::CodexStatusSnapshot;
}

/// 读取 Cursor Composer 本地 transcript 状态。
pub trait CursorStatusProvider: Send + Sync {
    fn read_status(&self) -> crate::CodexStatusSnapshot;
}

/// 采集本机系统指标（CPU / 内存 / 运行时长）。
pub trait SystemMetricsProvider: Send + Sync {
    fn read_metrics(&self) -> crate::SystemMetrics;
}

/// 枚举本机串口（用于自动 PING 发现与 UI 展示）。
pub trait SerialPortProvider: Send + Sync {
    fn list_ports(&self) -> Vec<String>;
}

/// 安全凭据存储：持久化云端会话 + installation_id。
pub trait SecureCredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<crate::CloudSessionSnapshot>, crate::CommandError>;
    fn save(&self, session: crate::CloudSessionSnapshot) -> Result<crate::CloudSessionSnapshot, crate::CommandError>;
    fn clear(&self) -> Result<(), crate::CommandError>;
    fn installation_id(&self) -> Result<String, crate::CommandError>;
}

/// 平台实现集合，持有四个 Provider 的 trait 对象。
pub struct Platform {
    pub codex: Box<dyn CodexStatusProvider>,
    pub cursor: Box<dyn CursorStatusProvider>,
    pub metrics: Box<dyn SystemMetricsProvider>,
    pub serial: Box<dyn SerialPortProvider>,
    pub credentials: Box<dyn SecureCredentialStore>,
}

impl Platform {
    /// 编译期选择当前平台的 Provider 实现。
    pub fn detect() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                codex: Box::new(windows::WindowsCodexStatus),
                cursor: Box::new(windows::WindowsCursorStatus),
                metrics: Box::new(windows::WindowsSystemMetrics),
                serial: Box::new(windows::WindowsSerialPort),
                credentials: Box::new(windows::WindowsCredentialStore),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self {
                codex: Box::new(macos::MacosCodexStatus),
                cursor: Box::new(macos::MacosCursorStatus),
                metrics: Box::new(macos::MacosSystemMetrics),
                serial: Box::new(macos::MacosSerialPort),
                credentials: Box::new(macos::MacosCredentialStore),
            }
        }
    }
}
