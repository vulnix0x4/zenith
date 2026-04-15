use std::fs;
use std::path::PathBuf;

use crate::sessions::types::SessionsData;

/// Returns the Zenith config directory: ~/.config/zenith/
pub fn data_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("zenith")
}

fn sessions_file() -> PathBuf {
    data_dir().join("sessions.json")
}

/// Load sessions from the JSON file. Returns empty data if the file doesn't exist.
pub fn load_sessions() -> SessionsData {
    let path = sessions_file();
    if !path.exists() {
        return SessionsData::default();
    }
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => SessionsData::default(),
    }
}

/// Save sessions to the JSON file as pretty-printed JSON.
pub fn save_sessions(data: &SessionsData) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;
    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(sessions_file(), json).map_err(|e| format!("Failed to write sessions: {e}"))?;
    Ok(())
}

/// Export sessions to a custom file path.
pub fn export_sessions(data: &SessionsData, path: &str) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(data).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(path, json).map_err(|e| format!("Failed to export sessions: {e}"))?;
    Ok(())
}

/// Import sessions from a custom file path.
pub fn import_sessions(path: &str) -> Result<SessionsData, String> {
    let contents =
        fs::read_to_string(path).map_err(|e| format!("Failed to read import file: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse import file: {e}"))
}
