use std::fs;
use std::path::PathBuf;

use crate::sessions::types::SessionsData;
use crate::storage_util::atomic_write;

/// Returns the Zenith config directory: ~/.config/zenith/
pub fn data_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("zenith")
}

fn sessions_file() -> PathBuf {
    data_dir().join("sessions.json")
}

/// Load sessions from the JSON file. Returns empty data if the file doesn't exist.
/// If the file is present but malformed, it is renamed with a `.corrupted-<ts>`
/// extension so the user can recover, and empty data is returned.
pub fn load_sessions() -> SessionsData {
    let path = sessions_file();
    if !path.exists() {
        return SessionsData::default();
    }
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("sessions.json read failed ({e}), returning empty sessions");
            return SessionsData::default();
        }
    };
    match serde_json::from_slice::<SessionsData>(&bytes) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "sessions.json parse failed ({e}), backing up and returning empty sessions"
            );
            let backup = path.with_extension(format!(
                "corrupted-{}",
                chrono::Utc::now().timestamp()
            ));
            if let Err(rename_err) = fs::rename(&path, &backup) {
                log::warn!(
                    "failed to rename corrupt sessions.json to backup: {rename_err}"
                );
            }
            SessionsData::default()
        }
    }
}

/// Save sessions to the JSON file as pretty-printed JSON, atomically.
pub fn save_sessions(data: &SessionsData) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write(&sessions_file(), json.as_bytes())
        .map_err(|e| format!("Failed to write sessions: {e}"))?;
    Ok(())
}

/// Export shape wraps `SessionsData` with a schema version marker so future
/// migrations have something to pivot on. No credential material ever lives
/// in the session struct (passwords are in the OS keyring, keyed by session
/// id), so exporting the struct as-is is safe.
#[derive(serde::Serialize, serde::Deserialize)]
struct ExportEnvelope {
    format_version: u32,
    #[serde(flatten)]
    data: SessionsData,
}

/// Export sessions to a custom file path. Does NOT include credentials: the
/// `Session` struct stores no passwords, and we deliberately do not touch
/// the OS keyring here. Reimport on another machine will simply prompt.
pub fn export_sessions(data: &SessionsData, path: &str) -> Result<(), String> {
    let envelope = ExportEnvelope {
        format_version: 1,
        data: data.clone(),
    };
    let json = serde_json::to_string_pretty(&envelope)
        .map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write(std::path::Path::new(path), json.as_bytes())
        .map_err(|e| format!("Failed to export sessions: {e}"))?;
    Ok(())
}

/// Import sessions from a custom file path. Accepts both the new envelope
/// form (`{format_version, sessions, folders}`) and the legacy form
/// (`{sessions, folders}`) for backward compatibility with older exports.
pub fn import_sessions(path: &str) -> Result<SessionsData, String> {
    let contents =
        fs::read_to_string(path).map_err(|e| format!("Failed to read import file: {e}"))?;
    if let Ok(envelope) = serde_json::from_str::<ExportEnvelope>(&contents) {
        return Ok(envelope.data);
    }
    serde_json::from_str::<SessionsData>(&contents)
        .map_err(|e| format!("Failed to parse import file: {e}"))
}
