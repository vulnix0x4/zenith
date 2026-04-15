use crate::sessions::storage;
use crate::sessions::types::SessionsData;
use crate::sessions::types::{Folder, Session};

#[tauri::command]
pub fn get_sessions() -> Result<SessionsData, String> {
    Ok(storage::load_sessions())
}

#[tauri::command]
pub fn save_session(session: Session) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions();
    if let Some(existing) = data.sessions.iter_mut().find(|s| s.id == session.id) {
        *existing = session;
    } else {
        data.sessions.push(session);
    }
    storage::save_sessions(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_session(session_id: String) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions();
    data.sessions.retain(|s| s.id != session_id);
    storage::save_sessions(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn save_folder(folder: Folder) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions();
    if let Some(existing) = data.folders.iter_mut().find(|f| f.id == folder.id) {
        *existing = folder;
    } else {
        data.folders.push(folder);
    }
    storage::save_sessions(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn delete_folder(folder_id: String) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions();
    // Move sessions from the deleted folder to root (no folder)
    for session in data.sessions.iter_mut() {
        if session.folder_id.as_deref() == Some(&folder_id) {
            session.folder_id = None;
        }
    }
    data.folders.retain(|f| f.id != folder_id);
    storage::save_sessions(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn move_session_to_folder(
    session_id: String,
    folder_id: Option<String>,
) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions();
    if let Some(session) = data.sessions.iter_mut().find(|s| s.id == session_id) {
        session.folder_id = folder_id;
    } else {
        return Err(format!("Session not found: {session_id}"));
    }
    storage::save_sessions(&data)?;
    Ok(data)
}

#[tauri::command]
pub fn export_sessions_file(path: String) -> Result<(), String> {
    let data = storage::load_sessions();
    storage::export_sessions(&data, &path)
}

#[tauri::command]
pub fn import_sessions_file(path: String) -> Result<SessionsData, String> {
    let imported = storage::import_sessions(&path)?;
    let mut data = storage::load_sessions();

    // Merge imported data: add sessions/folders that don't already exist by id
    let existing_session_ids: std::collections::HashSet<String> =
        data.sessions.iter().map(|s| s.id.clone()).collect();
    let existing_folder_ids: std::collections::HashSet<String> =
        data.folders.iter().map(|f| f.id.clone()).collect();

    for session in imported.sessions {
        if !existing_session_ids.contains(&session.id) {
            data.sessions.push(session);
        }
    }
    for folder in imported.folders {
        if !existing_folder_ids.contains(&folder.id) {
            data.folders.push(folder);
        }
    }

    storage::save_sessions(&data)?;
    Ok(data)
}
