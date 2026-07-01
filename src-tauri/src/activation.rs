use serde::{Deserialize, Serialize};
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;

use crate::{config_dir_path, read_or_create_installation_id, CommandError};

const ACTIVATION_FILE_NAME: &str = "activation.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ActivationRecord {
    pub activation_id: String,
    pub installation_id: String,
    pub activated_at: String,
    pub receipt: String,
    pub server_url: String,
}

#[derive(Debug, Deserialize)]
struct ActivateClientResponse {
    activation_id: String,
    installation_id: String,
    activated_at: String,
    receipt: String,
}

#[derive(Debug, Serialize)]
struct ActivateClientRequest<'a> {
    activation_code: &'a str,
    installation_id: &'a str,
    platform: &'a str,
    app_version: &'a str,
}

#[derive(Debug, Deserialize)]
struct ApiSuccessEnvelope<T> {
    #[allow(dead_code)]
    ok: bool,
    data: T,
}

#[derive(Debug, Deserialize)]
struct ApiErrorEnvelope {
    error: ApiErrorBody,
}

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    #[allow(dead_code)]
    code: String,
    message: String,
}

pub fn should_skip_activation() -> bool {
    if cfg!(debug_assertions) {
        return std::env::var("AGENT_LIGHT_SKIP_ACTIVATION")
            .ok()
            .as_deref()
            == Some("1");
    }
    false
}

pub fn is_client_activated() -> Result<bool, CommandError> {
    if should_skip_activation() {
        return Ok(true);
    }

    match read_activation_record()? {
        Some(record) => {
            let installation_id = read_or_create_installation_id()?;
            Ok(record.installation_id == installation_id && !record.receipt.is_empty())
        }
        None => Ok(false),
    }
}

pub fn activation_path() -> Result<PathBuf, CommandError> {
    Ok(config_dir_path()?.join(ACTIVATION_FILE_NAME))
}

pub fn detect_desktop_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        return "macos";
    }
    #[cfg(target_os = "windows")]
    {
        return "windows";
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "macos"
    }
}

pub fn resolve_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn activate_client(server_url: String, activation_code: String) -> Result<ActivationRecord, CommandError> {
    let installation_id = read_or_create_installation_id()?;
    let normalized_url = normalize_server_url(&server_url)?;
    let request_url = format!("{normalized_url}/api/activation/activate");
    let trimmed_code = activation_code.trim();
    if trimmed_code.len() < 6 {
        return Err(CommandError {
            code: "validation_failed",
            message: "Activation code is too short".to_string(),
        });
    }

    let body = ActivateClientRequest {
        activation_code: trimmed_code,
        installation_id: &installation_id,
        platform: detect_desktop_platform(),
        app_version: &resolve_app_version(),
    };

    let response = ureq::post(&request_url)
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(map_request_error)?;

    let status = response.status();
    if status >= 400 {
        return Err(parse_api_error(response));
    }

    let envelope: ApiSuccessEnvelope<ActivateClientResponse> = response.into_json().map_err(|error| CommandError {
        code: "activation_response_invalid",
        message: format!("Activation response is invalid: {error}"),
    })?;

    if envelope.data.installation_id != installation_id {
        return Err(CommandError {
            code: "activation_response_invalid",
            message: "Activation response installation id mismatch".to_string(),
        });
    }

    let record = ActivationRecord {
        activation_id: envelope.data.activation_id,
        installation_id: envelope.data.installation_id,
        activated_at: envelope.data.activated_at,
        receipt: envelope.data.receipt,
        server_url: normalized_url,
    };

    write_activation_record(&record)?;
    Ok(record)
}

pub fn load_activation_record() -> Result<Option<ActivationRecord>, CommandError> {
    read_activation_record()
}

fn read_activation_record() -> Result<Option<ActivationRecord>, CommandError> {
    let path = activation_path()?;
    if !path.is_file() {
        return Ok(None);
    }

    let mut file = File::open(&path).map_err(|error| CommandError {
        code: "activation_read_failed",
        message: format!("Could not read activation file: {error}"),
    })?;
    let mut contents = String::new();
    file.read_to_string(&mut contents).map_err(|error| CommandError {
        code: "activation_read_failed",
        message: format!("Could not read activation file: {error}"),
    })?;

    let record = serde_json::from_str::<ActivationRecord>(&contents).map_err(|error| CommandError {
        code: "activation_read_failed",
        message: format!("Activation file is invalid: {error}"),
    })?;

    Ok(Some(record))
}

fn write_activation_record(record: &ActivationRecord) -> Result<(), CommandError> {
    let path = activation_path()?;
    if let Some(parent) = path.parent() {
        create_dir_all(parent).map_err(|error| CommandError {
            code: "activation_write_failed",
            message: format!("Could not create config directory: {error}"),
        })?;
    }

    let serialized = serde_json::to_string_pretty(record).map_err(|error| CommandError {
        code: "activation_write_failed",
        message: format!("Could not serialize activation file: {error}"),
    })?;

    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|error| CommandError {
            code: "activation_write_failed",
            message: format!("Could not write activation file: {error}"),
        })?;

    file.write_all(serialized.as_bytes()).map_err(|error| CommandError {
        code: "activation_write_failed",
        message: format!("Could not write activation file: {error}"),
    })?;

    Ok(())
}

fn normalize_server_url(server_url: &str) -> Result<String, CommandError> {
    let trimmed = server_url.trim();
    if trimmed.is_empty() {
        return Err(CommandError {
            code: "validation_failed",
            message: "Server URL is required".to_string(),
        });
    }

    let normalized = trimmed.trim_end_matches('/');
    if !(normalized.starts_with("http://") || normalized.starts_with("https://")) {
        return Err(CommandError {
            code: "validation_failed",
            message: "Server URL must start with http:// or https://".to_string(),
        });
    }

    Ok(normalized.to_string())
}

fn map_request_error(error: ureq::Error) -> CommandError {
    CommandError {
        code: "activation_request_failed",
        message: format!("Could not reach activation server: {error}"),
    }
}

fn parse_api_error(response: ureq::Response) -> CommandError {
    let status = response.status();
    match response.into_json::<ApiErrorEnvelope>() {
        Ok(envelope) => CommandError {
            code: "activation_failed",
            message: envelope.error.message,
        },
        Err(_) => CommandError {
            code: "activation_failed",
            message: format!("Activation failed with status {status}"),
        },
    }
}

#[tauri::command]
pub fn get_activation_status() -> Result<bool, CommandError> {
    is_client_activated()
}

#[tauri::command]
pub fn get_activation_record() -> Result<Option<ActivationRecord>, CommandError> {
    load_activation_record()
}
