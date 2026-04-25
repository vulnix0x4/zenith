use tauri::State;

use crate::sftp::manager::{SftpManager, UploadDirReport};
use crate::sftp::types::FileEntry;
use crate::ssh::manager::SshManager;

/// Open an SFTP session on an existing SSH connection.
#[tauri::command]
pub async fn sftp_open(
    session_id: String,
    manager: State<'_, SshManager>,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    let handle = manager
        .get_handle(&session_id)
        .await
        .map_err(|e| e.to_string())?;

    sftp_manager
        .open(&session_id, handle)
        .await
        .map_err(|e| e.to_string())
}

/// List directory contents via SFTP.
#[tauri::command]
pub async fn sftp_list_dir(
    session_id: String,
    path: String,
    sftp_manager: State<'_, SftpManager>,
) -> Result<Vec<FileEntry>, String> {
    sftp_manager
        .list_dir(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

/// Download a remote file to a local path.
#[tauri::command]
pub async fn sftp_download(
    session_id: String,
    remote_path: String,
    local_path: String,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .download(&session_id, &remote_path, &local_path)
        .await
        .map_err(|e| e.to_string())
}

/// Upload a local file to a remote path.
///
/// If `overwrite` is omitted or false and the remote path already exists,
/// returns a `FILE_EXISTS`-tagged error the frontend detects and uses to
/// prompt the user to confirm before retrying with `overwrite: true`.
#[tauri::command]
pub async fn sftp_upload(
    session_id: String,
    local_path: String,
    remote_path: String,
    overwrite: Option<bool>,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .upload(
            &session_id,
            &local_path,
            &remote_path,
            overwrite.unwrap_or(false),
        )
        .await
        .map_err(|e| e.to_string())
}

/// Delete a remote file or empty directory.
#[tauri::command]
pub async fn sftp_delete(
    session_id: String,
    path: String,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .delete(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

/// Rename a remote file or directory.
#[tauri::command]
pub async fn sftp_rename(
    session_id: String,
    old_path: String,
    new_path: String,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .rename(&session_id, &old_path, &new_path)
        .await
        .map_err(|e| e.to_string())
}

/// Create a remote directory.
#[tauri::command]
pub async fn sftp_mkdir(
    session_id: String,
    path: String,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .mkdir(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

/// Upload an in-memory byte buffer to a remote path. Used by the
/// drag-and-drop path -- the browser hands us a `File` blob with no OS path,
/// so we ship the bytes through IPC instead of asking Rust to read them.
#[tauri::command]
pub async fn sftp_upload_data(
    session_id: String,
    remote_path: String,
    data: Vec<u8>,
    overwrite: Option<bool>,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .upload_data(
            &session_id,
            &remote_path,
            &data,
            overwrite.unwrap_or(false),
        )
        .await
        .map_err(|e| e.to_string())
}

/// Idempotent mkdir. Used by the drop traversal to materialize each level
/// of a dropped folder tree without erroring on directories that already
/// exist on the remote.
#[tauri::command]
pub async fn sftp_ensure_dir(
    session_id: String,
    path: String,
    sftp_manager: State<'_, SftpManager>,
) -> Result<(), String> {
    sftp_manager
        .ensure_dir(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

/// Recursively upload a local directory under `remote_parent_dir`. The
/// folder's own name becomes the top-level remote child, mirroring `scp -r`.
#[tauri::command]
pub async fn sftp_upload_dir(
    session_id: String,
    local_dir: String,
    remote_parent_dir: String,
    overwrite: Option<bool>,
    sftp_manager: State<'_, SftpManager>,
) -> Result<UploadDirReport, String> {
    sftp_manager
        .upload_dir(
            &session_id,
            &local_dir,
            &remote_parent_dir,
            overwrite.unwrap_or(false),
        )
        .await
        .map_err(|e| e.to_string())
}
