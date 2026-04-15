use std::fs;

use crate::sessions::storage::data_dir;
use crate::settings::types::AppSettings;

fn settings_file() -> std::path::PathBuf {
    data_dir().join("settings.json")
}

fn load_settings() -> AppSettings {
    let path = settings_file();
    if !path.exists() {
        return AppSettings::default();
    }
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create config dir: {e}"))?;
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {e}"))?;
    fs::write(settings_file(), json).map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    Ok(load_settings())
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<AppSettings, String> {
    persist_settings(&settings)?;
    Ok(settings)
}
