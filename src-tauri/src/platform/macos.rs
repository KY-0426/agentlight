//! macOS 平台 Provider 实现。

use super::*;
use crate::{
    clear_cloud_session_impl, load_cloud_session_impl, read_codex_status,
    read_or_create_installation_id, save_cloud_session_impl, timestamp_ms,
    CloudSessionSnapshot, CodexStatusSnapshot, CommandError, SystemMetrics,
};
use std::fs::read_dir;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const SERIAL_PORT_PATTERNS: &[(&str, u8)] = &[
    ("/dev/cu.usbmodem", 0),
    ("/dev/cu.usbserial", 1),
    ("/dev/tty.usbmodem", 2),
    ("/dev/tty.usbserial", 3),
];

fn select_serial_port<I>(candidates: I) -> Option<String>
where
    I: IntoIterator<Item = String>,
{
    let mut matches = candidates
        .into_iter()
        .filter_map(|path| serial_port_priority(&path).map(|priority| (priority, path)))
        .collect::<Vec<_>>();
    matches.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    matches.into_iter().map(|(_, path)| path).next()
}

fn serial_port_priority(path: &str) -> Option<u8> {
    SERIAL_PORT_PATTERNS
        .iter()
        .find_map(|(prefix, priority)| path.starts_with(prefix).then_some(*priority))
}

fn list_macos_serial_port_candidates() -> Vec<String> {
    read_dir("/dev")
        .ok()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().into_string().ok()?;
            Some(format!("/dev/{name}"))
        })
        .filter(|path| {
            SERIAL_PORT_PATTERNS
                .iter()
                .any(|(prefix, _)| path.starts_with(prefix))
        })
        .collect()
}

fn read_system_metrics() -> SystemMetrics {
    let logical_cpus = read_sysctl_u32("hw.logicalcpu");
    let memory_total_bytes = read_sysctl_u64("hw.memsize");
    let memory_used_bytes = read_memory_used_bytes();
    let memory_used_percent = match (memory_used_bytes, memory_total_bytes) {
        (Some(used), Some(total)) if total > 0 => {
            Some(round_one((used as f64 / total as f64) * 100.0))
        }
        _ => None,
    };

    SystemMetrics {
        cpu_usage_percent: read_cpu_usage_percent(logical_cpus),
        logical_cpus,
        memory_used_bytes,
        memory_total_bytes,
        memory_used_percent,
        uptime_seconds: read_uptime_seconds(),
        sampled_at_ms: timestamp_ms(),
    }
}

fn read_cpu_usage_percent(logical_cpus: Option<u32>) -> Option<f64> {
    let output = run_fixed_command("/bin/ps", &["-A", "-o", "%cpu="])?;
    let total_cpu = output
        .lines()
        .filter_map(|line| line.trim().parse::<f64>().ok())
        .sum::<f64>();
    let cores = logical_cpus.unwrap_or(1).max(1) as f64;
    Some(round_one((total_cpu / cores).clamp(0.0, 100.0)))
}

fn read_memory_used_bytes() -> Option<u64> {
    let output = run_fixed_command("/usr/bin/vm_stat", &[])?;
    let mut page_size = 4096u64;
    let mut free_pages = 0u64;

    for line in output.lines() {
        if let Some(size) = line
            .split("page size of")
            .nth(1)
            .and_then(|part| part.split_whitespace().next())
            .and_then(|raw| raw.parse::<u64>().ok())
        {
            page_size = size;
        }

        if line.starts_with("Pages free:") || line.starts_with("Pages speculative:") {
            if let Some(value) = line
                .split(':')
                .nth(1)
                .map(|raw| raw.trim().trim_end_matches('.').replace('.', ""))
                .and_then(|raw| raw.parse::<u64>().ok())
            {
                free_pages = free_pages.saturating_add(value);
            }
        }
    }

    let total = read_sysctl_u64("hw.memsize")?;
    let free_bytes = free_pages.saturating_mul(page_size);
    Some(total.saturating_sub(free_bytes))
}

fn read_uptime_seconds() -> Option<u64> {
    let output = run_fixed_command("/usr/sbin/sysctl", &["-n", "kern.boottime"])?;
    let boot_seconds = output
        .split("sec =")
        .nth(1)
        .and_then(|part| part.split(',').next())
        .and_then(|raw| raw.trim().parse::<u64>().ok())?;
    let now_seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some(now_seconds.saturating_sub(boot_seconds))
}

fn read_sysctl_u32(name: &str) -> Option<u32> {
    read_sysctl_u64(name).and_then(|value| u32::try_from(value).ok())
}

fn read_sysctl_u64(name: &str) -> Option<u64> {
    run_fixed_command("/usr/sbin/sysctl", &["-n", name])?
        .trim()
        .parse::<u64>()
        .ok()
}

fn run_fixed_command(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

fn round_one(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

pub struct MacosCodexStatus;
impl CodexStatusProvider for MacosCodexStatus {
    fn read_status(&self) -> CodexStatusSnapshot {
        read_codex_status()
    }
}

pub struct MacosCursorStatus;
impl CursorStatusProvider for MacosCursorStatus {
    fn read_status(&self) -> CodexStatusSnapshot {
        crate::cursor::read_cursor_status()
    }
}

pub struct MacosSystemMetrics;
impl SystemMetricsProvider for MacosSystemMetrics {
    fn read_metrics(&self) -> SystemMetrics {
        read_system_metrics()
    }
}

pub struct MacosSerialPort;
impl SerialPortProvider for MacosSerialPort {
    fn list_ports(&self) -> Vec<String> {
        let candidates = list_macos_serial_port_candidates();
        let preferred = select_serial_port(candidates.clone());
        let mut ports = Vec::new();
        if let Some(port) = preferred {
            ports.push(port);
        }
        for port in candidates {
            if !ports.iter().any(|existing| existing == &port) {
                ports.push(port);
            }
        }
        ports
    }
}

pub struct MacosCredentialStore;
impl SecureCredentialStore for MacosCredentialStore {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_preferred_auto_discovered_serial_port() {
        let port = select_serial_port(vec![
            "/dev/tty.usbserial2101".to_string(),
            "/dev/cu.Bluetooth-Incoming-Port".to_string(),
            "/dev/cu.usbmodem1101".to_string(),
            "/dev/cu.usbserial2101".to_string(),
            "/dev/tty.usbmodem1101".to_string(),
        ]);

        assert_eq!(port.as_deref(), Some("/dev/cu.usbmodem1101"));
    }

    #[test]
    fn ignores_non_usb_serial_candidates() {
        let port = select_serial_port(vec![
            "/dev/cu.Bluetooth-Incoming-Port".to_string(),
            "/dev/cu.debug-console".to_string(),
            "/dev/tty.debug-console".to_string(),
        ]);

        assert_eq!(port, None);
    }
}
