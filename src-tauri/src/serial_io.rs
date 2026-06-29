//! USB serial I/O for ESP32 RGB hardware: mutual exclusion, baud configuration, and PING discovery.

use std::io::Write;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime};

use crate::{parse_hardware_serial_reply, HardwareSerialReply, HARDWARE_PROTOCOL};

const SERIAL_LOCK_POISONED: &str = "serial port lock poisoned";
const PROBE_COMMAND: &str = "PING\n";
const SERIAL_IO_TIMEOUT: Duration = Duration::from_millis(250);
const PROBE_SETTLE_DELAY: Duration = Duration::from_millis(80);

static SERIAL_ACCESS: Mutex<()> = Mutex::new(());

pub(crate) fn write_serial_command(
    port: &str,
    baud: u32,
    command: &str,
) -> Result<HardwareSerialReply, String> {
    with_serial_lock(|| {
        let reply = transact_raw(port, baud, command)?;
        Ok(parse_hardware_serial_reply(&reply))
    })
}

pub(crate) fn discover_agent_light_port(baud: u32, ports: &[String]) -> Option<String> {
    for port in ports {
        if probe_agent_light_port(port, baud) {
            return Some(port.clone());
        }
    }
    None
}

pub(crate) fn probe_agent_light_port(port: &str, baud: u32) -> bool {
    with_serial_lock(|| {
        let reply = transact_raw(port, baud, PROBE_COMMAND)?;
        Ok(is_agent_light_probe_reply(&reply))
    })
    .unwrap_or(false)
}

pub(crate) fn is_agent_light_probe_reply(reply: &str) -> bool {
    reply.contains("PONG")
        && reply
            .contains(&format!("protocol_version={HARDWARE_PROTOCOL}"))
}

fn with_serial_lock<T>(operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = SERIAL_ACCESS
        .lock()
        .map_err(|_| SERIAL_LOCK_POISONED.to_string())?;
    operation()
}

fn transact_raw(port: &str, baud: u32, command: &str) -> Result<String, String> {
    let port_name = normalize_port_name(port);
    let mut serial = serialport::new(&port_name, baud)
        .timeout(SERIAL_IO_TIMEOUT)
        .dtr_on_open(false)
        .open()
        .map_err(|error| format!("Could not open ESP32 serial port {port_name}: {error}"))?;

    thread::sleep(PROBE_SETTLE_DELAY);

    serial
        .write_all(command.as_bytes())
        .and_then(|_| serial.flush())
        .map_err(|error| format!("Could not write ESP32 RGB command: {error}"))?;

    read_line_response(serial.as_mut())
}

fn read_line_response(serial: &mut dyn serialport::SerialPort) -> Result<String, String> {
    let deadline = SystemTime::now()
        .checked_add(SERIAL_IO_TIMEOUT)
        .unwrap_or_else(SystemTime::now);
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 128];

    while SystemTime::now() < deadline {
        match std::io::Read::read(serial, &mut chunk) {
            Ok(0) => std::thread::sleep(Duration::from_millis(10)),
            Ok(count) => {
                buffer.extend_from_slice(&chunk[..count]);
                if buffer.contains(&b'\n') {
                    break;
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::TimedOut
                    || error.kind() == std::io::ErrorKind::WouldBlock =>
            {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(error) => {
                return Err(format!("Could not read ESP32 serial reply: {error}"));
            }
        }
    }

    if buffer.is_empty() {
        return Err("ESP32 serial port did not reply".to_string());
    }

    Ok(String::from_utf8_lossy(&buffer).into_owned())
}

fn normalize_port_name(port: &str) -> String {
    port.trim_start_matches(r"\\.\").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_pong_reply_with_protocol_version() {
        let reply = concat!(
            "PONG firmware_version=0.3.0 ",
            "protocol_version=agent-light-rgb-v1 ",
            "hardware_revision=esp32-mini-rgb-dev\n"
        );
        assert!(is_agent_light_probe_reply(reply));
    }

    #[test]
    fn rejects_unrelated_serial_device_reply() {
        assert!(!is_agent_light_probe_reply("OK\r\n"));
        assert!(!is_agent_light_probe_reply("PONG protocol=other\n"));
    }

    #[test]
    fn normalizes_windows_com_path() {
        assert_eq!(normalize_port_name(r"\\.\COM7"), "COM7");
        assert_eq!(normalize_port_name("COM7"), "COM7");
    }
}
