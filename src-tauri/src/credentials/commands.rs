use keyring::Entry;

const SERVICE_NAME: &str = "zenith-ssh";

fn get_entry(session_id: &str) -> Result<Entry, String> {
    Entry::new(SERVICE_NAME, session_id).map_err(|e| format!("Keyring error: {e}"))
}

#[tauri::command]
pub async fn save_credential(session_id: String, password: String) -> Result<(), String> {
    let entry = get_entry(&session_id)?;
    entry
        .set_password(&password)
        .map_err(|e| format!("Failed to save credential: {e}"))
}

#[tauri::command]
pub async fn get_credential(session_id: String) -> Result<Option<String>, String> {
    let entry = get_entry(&session_id)?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get credential: {e}")),
    }
}

#[tauri::command]
pub async fn delete_credential(session_id: String) -> Result<(), String> {
    let entry = get_entry(&session_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to delete credential: {e}")),
    }
}
