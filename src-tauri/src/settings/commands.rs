use std::fs;

use crate::sessions::storage::data_dir;
use crate::settings::types::AppSettings;
use crate::storage_util::atomic_write;

fn settings_file() -> std::path::PathBuf {
    data_dir().join("settings.json")
}

fn load_settings() -> AppSettings {
    let path = settings_file();
    if !path.exists() {
        return AppSettings::default();
    }
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            log::warn!("settings.json read failed ({e}), using defaults");
            return AppSettings::default();
        }
    };
    let mut settings = match serde_json::from_slice::<AppSettings>(&bytes) {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "settings.json parse failed ({e}), backing up and resetting to defaults"
            );
            let backup = path.with_extension(format!(
                "corrupted-{}",
                chrono::Utc::now().timestamp()
            ));
            if let Err(rename_err) = fs::rename(&path, &backup) {
                log::warn!(
                    "failed to rename corrupt settings.json to backup: {rename_err}"
                );
            }
            AppSettings::default()
        }
    };
    settings.clamp_into_range();
    settings
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let json =
        serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize: {e}"))?;
    atomic_write(&settings_file(), json.as_bytes())
        .map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    Ok(load_settings())
}

#[tauri::command]
pub fn save_settings(mut settings: AppSettings) -> Result<AppSettings, String> {
    settings.clamp_into_range();
    persist_settings(&settings)?;
    Ok(settings)
}
