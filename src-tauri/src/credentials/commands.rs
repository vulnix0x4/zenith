use keyring::Entry;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

const SERVICE_NAME: &str = "zenith-ssh";

static KEYRING_AVAILABLE: AtomicBool = AtomicBool::new(true);
static WARNED: AtomicBool = AtomicBool::new(false);
static IN_MEMORY_STORE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn memory_store() -> &'static Mutex<HashMap<String, String>> {
    IN_MEMORY_STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn memory_key(session_id: &str) -> String {
    format!("{SERVICE_NAME}.{session_id}")
}

fn mark_keyring_unavailable(err: impl std::fmt::Display) {
    KEYRING_AVAILABLE.store(false, Ordering::Relaxed);
    if !WARNED.swap(true, Ordering::Relaxed) {
        log::warn!("keyring unavailable: {err}; using in-memory credential store");
    }
}

fn keyring_usable() -> bool {
    KEYRING_AVAILABLE.load(Ordering::Relaxed)
}

fn memory_save(session_id: &str, password: &str) {
    if let Ok(mut map) = memory_store().lock() {
        map.insert(memory_key(session_id), password.to_string());
    }
}

fn memory_get(session_id: &str) -> Option<String> {
    memory_store()
        .lock()
        .ok()
        .and_then(|m| m.get(&memory_key(session_id)).cloned())
}

fn memory_delete(session_id: &str) {
    if let Ok(mut map) = memory_store().lock() {
        map.remove(&memory_key(session_id));
    }
}

#[derive(serde::Serialize)]
pub struct StorageStatus {
    pub keyring_available: bool,
    pub in_memory_count: usize,
}

#[tauri::command]
pub async fn save_credential(session_id: String, password: String) -> Result<(), String> {
    if keyring_usable() {
        match Entry::new(SERVICE_NAME, &session_id) {
            Ok(entry) => match entry.set_password(&password) {
                Ok(()) => return Ok(()),
                Err(e) => mark_keyring_unavailable(&e),
            },
            Err(e) => mark_keyring_unavailable(&e),
        }
    }
    memory_save(&session_id, &password);
    Ok(())
}

#[tauri::command]
pub async fn get_credential(session_id: String) -> Result<Option<String>, String> {
    if keyring_usable() {
        match Entry::new(SERVICE_NAME, &session_id) {
            Ok(entry) => match entry.get_password() {
                Ok(pw) => return Ok(Some(pw)),
                Err(keyring::Error::NoEntry) => {
                    // Not in keyring — fall through to in-memory lookup in case we stored
                    // it there during a previous transient failure window.
                    return Ok(memory_get(&session_id));
                }
                Err(e) => mark_keyring_unavailable(&e),
            },
            Err(e) => mark_keyring_unavailable(&e),
        }
    }
    Ok(memory_get(&session_id))
}

#[tauri::command]
pub async fn delete_credential(session_id: String) -> Result<(), String> {
    if keyring_usable() {
        match Entry::new(SERVICE_NAME, &session_id) {
            Ok(entry) => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => {
                    // Also scrub any in-memory copy written during a prior fallback.
                    memory_delete(&session_id);
                    return Ok(());
                }
                Err(e) => mark_keyring_unavailable(&e),
            },
            Err(e) => mark_keyring_unavailable(&e),
        }
    }
    memory_delete(&session_id);
    Ok(())
}

#[tauri::command]
pub fn get_credential_storage_status() -> StorageStatus {
    StorageStatus {
        keyring_available: KEYRING_AVAILABLE.load(Ordering::Relaxed),
        in_memory_count: memory_store().lock().map(|m| m.len()).unwrap_or(0),
    }
}
