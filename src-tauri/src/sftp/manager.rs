use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use anyhow::{Context, Result};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::{FilePermissions, FileType, OpenFlags};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::sftp::errors::{file_exists_error, humanize_sftp_error};
use crate::sftp::types::{FileEntry, FileKind};
use crate::ssh::SharedSshHandle;

/// Summary of a recursive directory upload, returned to the UI so it can
/// display "uploaded N files" (and surface a partial-failure count if any
/// files were skipped due to per-file errors).
#[derive(Debug, serde::Serialize)]
pub struct UploadDirReport {
    pub uploaded: u32,
    pub skipped: u32,
}

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

        write_remote_file(sftp, remote_path, &data, overwrite).await
    }

    /// Upload an in-memory byte buffer to a remote path. Used by the
    /// drag-and-drop path where the browser only hands us a `File` blob,
    /// not a filesystem path the Rust side could `tokio::fs::read`.
    pub async fn upload_data(
        &self,
        session_id: &str,
        remote_path: &str,
        data: &[u8],
        overwrite: bool,
    ) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        write_remote_file(sftp, remote_path, data, overwrite).await
    }

    /// Idempotent mkdir: succeed if the directory exists or can be created.
    /// Used while replicating a dropped folder tree onto the remote -- we
    /// don't want every existing intermediate directory to throw.
    pub async fn ensure_dir(&self, session_id: &str, path: &str) -> Result<()> {
        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;
        ensure_remote_dir(sftp, path).await
    }

    /// Recursively upload a local directory under `remote_parent_dir`. The
    /// folder's own name becomes the top-level remote child, mirroring how
    /// `scp -r src/ dst/` produces `dst/src`.
    ///
    /// Returns a summary so the UI can report how many files actually went
    /// through. Per-file failures are counted in `skipped` rather than
    /// aborting -- a single permission error shouldn't abandon the rest of
    /// the tree.
    pub async fn upload_dir(
        &self,
        session_id: &str,
        local_dir: &str,
        remote_parent_dir: &str,
        overwrite: bool,
    ) -> Result<UploadDirReport> {
        let local_path = Path::new(local_dir);
        if !local_path.is_dir() {
            anyhow::bail!("Local path is not a directory: {local_dir}");
        }
        let dir_name = local_path
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("Could not derive folder name from path"))?
            .to_string_lossy()
            .to_string();
        let remote_root = join_remote(remote_parent_dir, &dir_name);

        let sessions = self.sessions.lock().await;
        let sftp = sessions
            .get(session_id)
            .context("SFTP session not found")?;

        let mut report = UploadDirReport {
            uploaded: 0,
            skipped: 0,
        };
        upload_dir_recursive(sftp, local_path, &remote_root, overwrite, &mut report).await?;
        Ok(report)
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

/// Open a remote path with the right flags for an upload and write `data`.
///
/// `russh_sftp::SftpSession::write` is a footgun -- it opens with
/// `OpenFlags::WRITE` only, which (a) errors with NoSuchFile on a path that
/// doesn't yet exist and (b) silently leaves trailing bytes when overwriting
/// a smaller file. We always want CREATE+TRUNCATE.
async fn write_remote_file(
    sftp: &SftpSession,
    remote_path: &str,
    data: &[u8],
    overwrite: bool,
) -> Result<()> {
    if !overwrite {
        match sftp.try_exists(remote_path).await {
            Ok(true) => return Err(file_exists_error(remote_path)),
            Ok(false) => {}
            // Couldn't determine existence (e.g. permission error on
            // metadata) -- proceed and let the open call surface a clearer
            // humanized error.
            Err(_) => {}
        }
    }

    let mut file = sftp
        .open_with_flags(
            remote_path,
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
        )
        .await
        .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;

    file.write_all(data)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to write to remote file: {e}"))?;
    file.shutdown()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to close remote file: {e}"))?;
    Ok(())
}

/// Idempotent mkdir: succeeds if the directory already exists.
/// Stat first, then create on miss. The SFTP "already exists" errors aren't
/// uniform across servers, so checking up-front avoids having to
/// allowlist particular `StatusCode`s as "harmless".
async fn ensure_remote_dir(sftp: &SftpSession, path: &str) -> Result<()> {
    if let Ok(meta) = sftp.metadata(path).await {
        if meta.is_dir() {
            return Ok(());
        }
        anyhow::bail!("Path exists but is not a directory: {path}");
    }
    sftp.create_dir(path)
        .await
        .map_err(|e| anyhow::anyhow!("{}", humanize_sftp_error(&e)))?;
    Ok(())
}

/// Join a parent SFTP directory and a child name, normalising the slash
/// regardless of whether `parent` came in with or without a trailing one.
fn join_remote(parent: &str, child: &str) -> String {
    if parent.ends_with('/') {
        format!("{parent}{child}")
    } else {
        format!("{parent}/{child}")
    }
}

/// Recursive helper -- boxed because async fns can't directly recurse.
fn upload_dir_recursive<'a>(
    sftp: &'a SftpSession,
    local_path: &'a Path,
    remote_path: &'a str,
    overwrite: bool,
    report: &'a mut UploadDirReport,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
    Box::pin(async move {
        ensure_remote_dir(sftp, remote_path).await?;

        let mut entries = tokio::fs::read_dir(local_path)
            .await
            .with_context(|| format!("Failed to read local dir {}", local_path.display()))?;

        while let Some(entry) = entries.next_entry().await? {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let remote_child = join_remote(remote_path, &name);
            let file_type = entry.file_type().await?;

            if file_type.is_dir() {
                upload_dir_recursive(sftp, &entry_path, &remote_child, overwrite, report).await?;
            } else if file_type.is_file() {
                match tokio::fs::read(&entry_path).await {
                    Ok(data) => match write_remote_file(sftp, &remote_child, &data, overwrite).await {
                        Ok(()) => report.uploaded += 1,
                        Err(_) => report.skipped += 1,
                    },
                    Err(_) => report.skipped += 1,
                }
            }
            // Symlinks / devices / fifos are skipped silently -- replicating
            // them onto an SFTP server reliably is server-specific and well
            // beyond what a desktop file browser should attempt.
        }
        Ok(())
    })
}
