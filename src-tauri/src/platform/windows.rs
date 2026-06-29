//! Windows 平台 Provider 实现。

use super::*;
use crate::{
    clear_cloud_session_impl, load_cloud_session_impl, process_util, read_codex_status,
    read_or_create_installation_id, save_cloud_session_impl, timestamp_ms,
    CloudSessionSnapshot, CodexStatusSnapshot, CommandError, SystemMetrics,
};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const COM_PORTS_CACHE_TTL: Duration = Duration::from_secs(20);
const METRICS_CACHE_TTL: Duration = Duration::from_secs(12);

static COM_PORTS_CACHE: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
static METRICS_CACHE: Mutex<Option<(Instant, SystemMetrics)>> = Mutex::new(None);

pub struct WindowsCodexStatus;
impl CodexStatusProvider for WindowsCodexStatus {
    fn read_status(&self) -> CodexStatusSnapshot {
        read_codex_status()
    }
}

pub struct WindowsCursorStatus;
impl CursorStatusProvider for WindowsCursorStatus {
    fn read_status(&self) -> CodexStatusSnapshot {
        crate::cursor::read_cursor_status()
    }
}

pub struct WindowsSystemMetrics;
impl SystemMetricsProvider for WindowsSystemMetrics {
    fn read_metrics(&self) -> SystemMetrics {
        if let Ok(guard) = METRICS_CACHE.lock() {
            if let Some((fetched_at, metrics)) = guard.as_ref() {
                if fetched_at.elapsed() < METRICS_CACHE_TTL {
                    return SystemMetrics {
                        sampled_at_ms: timestamp_ms(),
                        ..metrics.clone()
                    };
                }
            }
        }

        let logical_cpus = std::env::var("NUMBER_OF_PROCESSORS")
            .ok()
            .and_then(|value| value.parse::<u32>().ok());
        let (memory_total_bytes, memory_used_bytes) = read_windows_memory_bytes();
        let memory_used_percent = match (memory_used_bytes, memory_total_bytes) {
            (Some(used), Some(total)) if total > 0 => {
                Some(round_one((used as f64 / total as f64) * 100.0))
            }
            _ => None,
        };

        let metrics = SystemMetrics {
            cpu_usage_percent: read_windows_cpu_usage_percent(),
            logical_cpus,
            memory_used_bytes,
            memory_total_bytes,
            memory_used_percent,
            uptime_seconds: read_windows_uptime_seconds(),
            sampled_at_ms: timestamp_ms(),
        };

        if let Ok(mut guard) = METRICS_CACHE.lock() {
            *guard = Some((Instant::now(), metrics.clone()));
        }

        metrics
    }
}

pub struct WindowsSerialPort;
impl SerialPortProvider for WindowsSerialPort {
    fn list_ports(&self) -> Vec<String> {
        list_com_ports()
    }
}

pub struct WindowsCredentialStore;
impl SecureCredentialStore for WindowsCredentialStore {
    fn load(&self) -> Result<Option<CloudSessionSnapshot>, CommandError> {
        load_cloud_session_impl()
    }
    fn save(&self, session: CloudSessionSnapshot) -> Result<CloudSessionSnapshot, CommandError> {
        save_cloud_session_impl(session)
    }
    fn clear(&self) -> Result<(), CommandError> {
        clear_cloud_session_impl()
    }
    fn installation_id(&self) -> Result<String, CommandError> {
        read_or_create_installation_id()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ComPortEntry {
    device_path: String,
    port: String,
}

/// 通过注册表 + PowerShell + WMI 枚举 COM 口，USB 串口优先（ESP32 常见 CP210x/CH340 等）。
pub(crate) fn list_com_ports() -> Vec<String> {
    if let Ok(guard) = COM_PORTS_CACHE.lock() {
        if let Some((fetched_at, ports)) = guard.as_ref() {
            if fetched_at.elapsed() < COM_PORTS_CACHE_TTL {
                return ports.clone();
            }
        }
    }

    let ports = enumerate_com_ports_uncached();
    if let Ok(mut guard) = COM_PORTS_CACHE.lock() {
        *guard = Some((Instant::now(), ports.clone()));
    }
    ports
}

fn enumerate_com_ports_uncached() -> Vec<String> {
    let mut entries = enumerate_com_ports_from_registry();
    for port in enumerate_com_ports_from_powershell() {
        if !entries
            .iter()
            .any(|entry| entry.port.eq_ignore_ascii_case(&port))
        {
            entries.push(ComPortEntry {
                device_path: String::new(),
                port,
            });
        }
    }
    for port in enumerate_com_ports_from_wmi() {
        if !entries
            .iter()
            .any(|entry| entry.port.eq_ignore_ascii_case(&port))
        {
            entries.push(ComPortEntry {
                device_path: String::new(),
                port,
            });
        }
    }

    entries.sort_by(|left, right| {
        com_port_device_priority(&left.device_path)
            .cmp(&com_port_device_priority(&right.device_path))
            .then_with(|| com_port_sort_key(&left.port).cmp(&com_port_sort_key(&right.port)))
            .then_with(|| left.port.cmp(&right.port))
    });

    let mut ports: Vec<String> = Vec::new();
    for entry in entries {
        if !ports.iter().any(|existing| existing.eq_ignore_ascii_case(&entry.port)) {
            ports.push(entry.port);
        }
    }
    ports
}

fn enumerate_com_ports_from_registry() -> Vec<ComPortEntry> {
    let output = match process_util::hidden_command("reg")
        .args([
            "query",
            "HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM",
        ])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .filter_map(parse_registry_com_port_line)
        .collect()
}

fn parse_registry_com_port_line(line: &str) -> Option<ComPortEntry> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    match parts.as_slice() {
        [device_path, "REG_SZ", port] => Some(ComPortEntry {
            device_path: (*device_path).to_string(),
            port: (*port).to_string(),
        }),
        [.., "REG_SZ", port] if parts.len() >= 3 => {
            let device_path = parts[..parts.len() - 2].join(" ");
            Some(ComPortEntry {
                device_path,
                port: (*port).to_string(),
            })
        }
        _ => None,
    }
}

fn enumerate_com_ports_from_powershell() -> Vec<String> {
    let output = match process_util::hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "[System.IO.Ports.SerialPort]::getportnames() | Sort-Object { [int]($_ -replace '^COM','') }",
        ])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && line.starts_with("COM"))
        .map(str::to_string)
        .collect()
}

fn enumerate_com_ports_from_wmi() -> Vec<String> {
    let output = match process_util::hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)$' } | ForEach-Object { if ($_.Name -match '\\((COM\\d+)\\)$') { $matches[1] } }",
        ])
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && line.starts_with("COM"))
        .map(str::to_string)
        .collect()
}

fn com_port_device_priority(device_path: &str) -> u8 {
    let path = device_path.to_ascii_lowercase();
    if path.contains("usb")
        || path.contains("silabser")
        || path.contains("ch340")
        || path.contains("cp210")
        || path.contains("wch")
        || path.contains("usbser")
    {
        return 0;
    }
    if path.contains("bluetooth") || path.contains("bth") {
        return 2;
    }
    if device_path.is_empty() {
        return 1;
    }
    1
}

fn com_port_sort_key(port: &str) -> u32 {
    port.trim_start_matches("COM")
        .parse::<u32>()
        .unwrap_or(u32::MAX)
}

pub(crate) fn serial_port_present(port: &str) -> bool {
    let bare = port
        .trim_start_matches(r"\\.\")
        .trim()
        .to_ascii_uppercase();
    list_com_ports()
        .into_iter()
        .any(|candidate| candidate.to_ascii_uppercase() == bare)
}

fn read_windows_cpu_usage_percent() -> Option<f64> {
    let output = process_util::hidden_command("wmic")
        .args(["cpu", "get", "loadpercentage"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .next()
        .map(round_one)
}

fn read_windows_memory_bytes() -> (Option<u64>, Option<u64>) {
    let output = process_util::hidden_command("wmic")
        .args([
            "OS",
            "get",
            "FreePhysicalMemory,TotalVisibleMemorySize",
            "/Value",
        ])
        .output()
        .ok();
    let Some(output) = output else {
        return (None, None);
    };
    if !output.status.success() {
        return (None, None);
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut total_kb: Option<u64> = None;
    let mut free_kb: Option<u64> = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix("TotalVisibleMemorySize=") {
            total_kb = value.trim().parse::<u64>().ok();
        } else if let Some(value) = line.strip_prefix("FreePhysicalMemory=") {
            free_kb = value.trim().parse::<u64>().ok();
        }
    }
    let total_bytes = total_kb.map(|kb| kb.saturating_mul(1024));
    let used_bytes = match (total_kb, free_kb) {
        (Some(total), Some(free)) => Some(total.saturating_sub(free).saturating_mul(1024)),
        _ => None,
    };
    (total_bytes, used_bytes)
}

fn read_windows_uptime_seconds() -> Option<u64> {
    let output = process_util::hidden_command("wmic")
        .args(["os", "get", "lastbootuptime"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let boot_raw = text
        .lines()
        .find(|line| line.contains('.') && line.chars().all(|ch| ch.is_ascii_digit() || ch == '.'))?
        .trim();
    let boot_seconds = parse_wmic_datetime_seconds(boot_raw)?;
    let now_seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(now_seconds.saturating_sub(boot_seconds))
}

fn parse_wmic_datetime_seconds(raw: &str) -> Option<u64> {
    let digits: String = raw.chars().filter(|ch| ch.is_ascii_digit()).collect();
    if digits.len() < 14 {
        return None;
    }
    let year: i32 = digits[0..4].parse().ok()?;
    let month: u32 = digits[4..6].parse().ok()?;
    let day: u32 = digits[6..8].parse().ok()?;
    let hour: u32 = digits[8..10].parse().ok()?;
    let minute: u32 = digits[10..12].parse().ok()?;
    let second: u32 = digits[12..14].parse().ok()?;
    let days_since_epoch = days_from_civil(year, month, day)?;
    let seconds = days_since_epoch
        .saturating_mul(86_400)
        .saturating_add(u64::from(hour) * 3600 + u64::from(minute) * 60 + u64::from(second));
    Some(seconds)
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<u64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let year = year as i64;
    let month = month as i64;
    let day = day as i64;
    let adjusted_year = year - (month <= 2) as i64;
    let era = if adjusted_year >= 0 { adjusted_year / 400 } else { (adjusted_year - 399) / 400 };
    let yoe = adjusted_year - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some((era * 146097 + doe - 719468) as u64)
}

fn round_one(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_registry_com_port_line() {
        let entry = parse_registry_com_port_line(r"    \Device\Silabser    REG_SZ    COM7")
            .expect("registry line");

        assert_eq!(entry.device_path, r"\Device\Silabser");
        assert_eq!(entry.port, "COM7");
    }

    #[test]
    fn prefers_usb_serial_over_bluetooth() {
        let entries = vec![
            ComPortEntry {
                device_path: r"\Device\BthModem0".to_string(),
                port: "COM4".to_string(),
            },
            ComPortEntry {
                device_path: r"\Device\Silabser".to_string(),
                port: "COM7".to_string(),
            },
        ];
        let mut ports = entries;
        ports.sort_by(|left, right| {
            com_port_device_priority(&left.device_path)
                .cmp(&com_port_device_priority(&right.device_path))
                .then_with(|| com_port_sort_key(&left.port).cmp(&com_port_sort_key(&right.port)))
        });

        assert_eq!(ports[0].port, "COM7");
    }
}
