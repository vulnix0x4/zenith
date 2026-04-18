use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use anyhow::{Context, Result};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FilePermissions, FileType};
use tokio::sync::Mutex;

use crate::sftp::errors::{file_exists_error, humanize_sftp_error};
use crate::sftp::types::{FileEntry, FileKind};
use crate::ssh::SharedSshHandle;

/// Manages SFTP sessions, one per SSH connection.
pub struct SftpManager {
    sessions: Arc<Mutex<HashMap<String, SftpSession>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Open an SFTP subsystem on an existing SSH connection.
    /// This opens a new channel on the SSH handle, requests the "sftp" subsystem,
    /// and creates a high-level SftpSession.
    pub async fn open(&self, session_id: &str, handle: SharedSshHandle) -> Result<()> {
        let channel = handle
            .channel_open_session()
            .await
            .context("Failed to open SFTP channel")?;

        channel
            .request_subsystem(true, "sftp")
            .await
            .context("Failed to request sftp subsystem")?;

        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize SFTP session: {}", humanize_sftp_error(&e)))?;

        let mut sessions = self.sessions.lock().await;
        sessions.insert(session_id.to_string(), sftp);

        Ok(())
    }

    /// Close and remove an SFTP session.
    pub async fn close(&self, session_id: &str) -> Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(sftp) = sessions.remove(session_id) {
            let _ = sftp.close().await;
        }
        Ok(())
    }

    /// List directory contents at the given path.
    pub async fn list_dir(&self, session_id: &str, path: &str) -> Result<Vec<FileEntry>> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        let read_dir = sftp
            .read_dir(path)
            .await
            .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

        let base_path = if path.ends_with('/') {
            path.to_string()
        } else {
            format!("{path}/")
        };

        let entries: Vec<FileEntry> = read_dir
            .map(|entry| {
                let name = entry.file_name();
                let metadata = entry.metadata();
                let ftype = entry.file_type();
                let is_dir = ftype == FileType::Dir;
                let size = metadata.size.unwrap_or(0);

                let modified = metadata.mtime.map(|t| {
                    let dt = UNIX_EPOCH + Duration::from_secs(t as u64);
                    // Format as ISO 8601
                    chrono::DateTime::<chrono::Utc>::from(dt)
                        .format("%Y-%m-%d %H:%M:%S")
                        .to_string()
                });

                let permissions = metadata.permissions.map(|p| {
                    let perms: FilePermissions = p.into();
                    format!("{perms}")
                });

                let full_path = format!("{base_path}{name}");

                // Map russh-sftp's FileType to our serializable FileKind. We
                // keep `is_dir` for callers that only need the coarse split,
                // but file_type is the source of truth for the UI.
                let file_type = match ftype {
                    FileType::Dir => FileKind::Directory,
                    FileType::File => FileKind::File,
                    FileType::Symlink => FileKind::Symlink,
                    FileType::Other => FileKind::Other,
                };

                FileEntry {
                    name,
                    path: full_path,
                    is_dir,
                    size,
                    modified,
                    permissions,
                    file_type,
                }
            })
            .collect();

        Ok(entries)
    }

    /// Download a remote file to a local path.
    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
    ) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        let data = sftp
            .read(remote_path)
            .await
            .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

        tokio::fs::write(local_path, &data)
            .await
            .context("Failed to write local file")?;

        Ok(())
    }

    /// Upload a local file to a remote path.
    ///
    /// If `overwrite` is false and the remote path already exists, returns
    /// a `FILE_EXISTS` error the frontend can detect to prompt the user.
    pub async fn upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        overwrite: bool,
    ) -> Result<()> {
        let data = tokio::fs::read(local_path)
            .await
            .context("Failed to read local file")?;

        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        if !overwrite {
            // Best-effort existence check. `try_exists` returns false for
            // NoSuchFile and propagates other errors (e.g. permission) -- we
            // let those fall through to the `write` call which will surface
            // a clearer humanized error.
            match sftp.try_exists(remote_path).await {
                Ok(true) => return Err(file_exists_error(remote_path)),
                Ok(false) => {}
                Err(_) => {
                    // Couldn't determine existence -- fall through and let
                    // the write attempt produce the error.
                }
            }
        }

        sftp.write(remote_path, &data)
            .await
            .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

        Ok(())
    }

    /// Delete a remote file or empty directory.
    pub async fn delete(&self, session_id: &str, path: &str) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        let metadata = sftp
            .metadata(path)
            .await
            .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

        if metadata.is_dir() {
            sftp.remove_dir(path)
                .await
                .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;
        } else {
            sftp.remove_file(path)
                .await
                .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;
        }

        Ok(())
    }

    /// Rename a remote file or directory.
    pub async fn rename(&self, session_id: &str, old_path: &str, new_path: &str) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        sftp.rename(old_path, new_path)
            .await
            .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

        Ok(())
    }

    /// Create a remote directory.
    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        sftp.create_dir(path)
            .await
            .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

        Ok(())
    }
}
