use crate::sessions::storage;
use crate::sessions::types::SessionsData;
use crate::sessions::types::{Folder, Session};
use std::collections::HashSet;
use uuid::Uuid;

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

/// Summary returned to the frontend after a session import. Reports how
/// many sessions+folders were imported and how many had to be given a new
/// UUID because their id clashed with an existing entry.
#[derive(serde::Serialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub renamed: usize,
}

#[tauri::command]
pub fn import_sessions_file(path: String) -> Result<ImportSummary, String> {
    let imported = storage::import_sessions(&path)?;
    let mut data = storage::load_sessions();

    let mut existing_session_ids: HashSet<String> =
        data.sessions.iter().map(|s| s.id.clone()).collect();
    let mut existing_folder_ids: HashSet<String> =
        data.folders.iter().map(|f| f.id.clone()).collect();

    let mut imported_count = 0usize;
    let mut renamed_count = 0usize;

    // Track folder id remaps so imported sessions that referenced a renamed
    // folder keep pointing to the right folder.
    let mut folder_id_remap: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for mut folder in imported.folders {
        if existing_folder_ids.contains(&folder.id) {
            let old_id = folder.id.clone();
            let new_id = Uuid::new_v4().to_string();
            log::info!(
                "folder renamed on import due to ID conflict: {old_id} -> {new_id}"
            );
            folder.id = new_id.clone();
            folder_id_remap.insert(old_id, new_id);
            renamed_count += 1;
        }
        existing_folder_ids.insert(folder.id.clone());
        data.folders.push(folder);
        imported_count += 1;
    }

    for mut session in imported.sessions {
        if let Some(fid) = session.folder_id.as_ref() {
            if let Some(new_fid) = folder_id_remap.get(fid) {
                session.folder_id = Some(new_fid.clone());
            }
        }
        if existing_session_ids.contains(&session.id) {
            let old_id = session.id.clone();
            let new_id = Uuid::new_v4().to_string();
            log::info!(
                "session renamed on import due to ID conflict: {old_id} -> {new_id}"
            );
            session.id = new_id;
            renamed_count += 1;
        }
        existing_session_ids.insert(session.id.clone());
        data.sessions.push(session);
        imported_count += 1;
    }

    storage::save_sessions(&data)?;
    Ok(ImportSummary {
        imported: imported_count,
        renamed: renamed_count,
    })
}
