use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

fn validate_filename(filename: &str) -> Result<(), UpdateError> {
    let bad = filename.is_empty()
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains("..")
        || filename.contains(':')
        || filename.contains('\0')
        || std::path::Path::new(filename).is_absolute();
    if bad {
        return Err(UpdateError::Download(format!("invalid filename: {filename}")));
    }
    Ok(())
}

fn is_allowed_host(host: Option<&str>) -> bool {
    match host {
        Some("github.com") => true,
        // All GitHub release-asset CDN hosts are subdomains of
        // githubusercontent.com (e.g. objects.githubusercontent.com,
        // release-assets.githubusercontent.com, raw.githubusercontent.com).
        // Matching the whole suffix keeps the allowlist robust against
        // GitHub rotating the specific CDN hostname.
        Some(h) => h == "githubusercontent.com" || h.ends_with(".githubusercontent.com"),
        None => false,
    }
}

#[derive(thiserror::Error, Debug)]
pub enum UpdateError {
    #[error("download failed: {0}")]
    Download(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("install spawn failed: {0}")]
    Spawn(String),
}

impl serde::Serialize for UpdateError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

async fn download_to_temp(url: &str, filename: &str) -> Result<PathBuf, UpdateError> {
    validate_filename(filename)?;
    let dest = std::env::temp_dir().join(filename);
    let tmp = std::env::temp_dir().join(format!("{filename}.partial"));

    let parsed = reqwest::Url::parse(url)
        .map_err(|e| UpdateError::Download(format!("invalid url: {e}")))?;
    if parsed.scheme() != "https" {
        return Err(UpdateError::Download("only https urls allowed".into()));
    }
    if !is_allowed_host(parsed.host_str()) {
        return Err(UpdateError::Download(format!(
            "host not allowlisted: {:?}",
            parsed.host_str()
        )));
    }

    let result: Result<(), UpdateError> = async {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Zenith/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if is_allowed_host(attempt.url().host_str()) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|e| UpdateError::Download(e.to_string()))?;

        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| UpdateError::Download(e.to_string()))?;

        if !response.status().is_success() {
            return Err(UpdateError::Download(format!(
                "HTTP {}",
                response.status()
            )));
        }

        let mut file = tokio::fs::File::create(&tmp).await?;
        let mut stream = response.bytes_stream();

        use futures_util::StreamExt;
        const MAX_BYTES: u64 = 200 * 1024 * 1024;
        let mut total: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| UpdateError::Download(e.to_string()))?;
            total = total.saturating_add(bytes.len() as u64);
            if total > MAX_BYTES {
                return Err(UpdateError::Download(format!(
                    "download exceeds {MAX_BYTES} bytes"
                )));
            }
            file.write_all(&bytes).await?;
        }
        file.sync_all().await?;
        Ok(())
    }
    .await;

    match result {
        Ok(()) => {
            tokio::fs::rename(&tmp, &dest).await?;
            Ok(dest)
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&tmp).await;
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    url: String,
    filename: String,
) -> Result<(), UpdateError> {
    let path = download_to_temp(&url, &filename).await?;
    spawn_installer(&path).await?;
    Ok(())
}

#[cfg(target_os = "windows")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    // Detached spawn; the app will exit immediately after this returns so the
    // installer can replace the locked binary. Tauri's NSIS template tries to
    // terminate the running instance, but has known race bugs — exiting the app
    // ourselves sidesteps that path.
    //
    // DETACHED_PROCESS + CREATE_NEW_PROCESS_GROUP so the installer survives
    // our exit. We do NOT add CREATE_NO_WINDOW — the NSIS installer needs its
    // own UI window.
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    std::process::Command::new(path)
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| UpdateError::Spawn(e.to_string()))?;
    Ok(())
}
#[cfg(target_os = "macos")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    // `open` mounts the DMG in Finder; user drags to /Applications. Not fully
    // automatic — see design doc for rationale.
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| UpdateError::Spawn(e.to_string()))?;
    Ok(())
}
#[cfg(target_os = "linux")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    // Self-replace is only safe for AppImage builds. For .deb, .rpm, flatpak,
    // dev builds, etc., we must NOT silently overwrite current_exe — that
    // could corrupt the user's system package or a developer's build tree.
    let appimage_path = std::env::var("APPIMAGE").map_err(|_| {
        UpdateError::Spawn(
            "Linux auto-install requires an AppImage build. \
             Download the new version manually from GitHub."
                .into(),
        )
    })?;
    let appimage_path = std::path::PathBuf::from(appimage_path);

    tokio::fs::copy(path, &appimage_path).await?;

    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&appimage_path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&appimage_path, perms)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_host, validate_filename};

    #[test]
    fn is_allowed_host_accepts_github_and_usercontent_subdomains() {
        assert!(is_allowed_host(Some("github.com")));
        assert!(is_allowed_host(Some("objects.githubusercontent.com")));
        assert!(is_allowed_host(Some("release-assets.githubusercontent.com")));
        assert!(is_allowed_host(Some("raw.githubusercontent.com")));
        assert!(is_allowed_host(Some("githubusercontent.com")));
    }

    #[test]
    fn is_allowed_host_rejects_everything_else() {
        assert!(!is_allowed_host(None));
        assert!(!is_allowed_host(Some("")));
        assert!(!is_allowed_host(Some("evil.com")));
        assert!(!is_allowed_host(Some("github.com.evil.com")));
        // Suffix match must be anchored at a dot so that e.g. "evilgithubusercontent.com"
        // does NOT match.
        assert!(!is_allowed_host(Some("evilgithubusercontent.com")));
        assert!(!is_allowed_host(Some("s3.amazonaws.com")));
    }

    #[test]
    fn validate_filename_accepts_real_names() {
        assert!(validate_filename("Zenith_0.2.0_x64-setup.exe").is_ok());
        assert!(validate_filename("Zenith_0.2.0_aarch64.dmg").is_ok());
        assert!(validate_filename("Zenith_0.2.0_amd64.AppImage").is_ok());
    }

    #[test]
    fn validate_filename_rejects_empty() {
        assert!(validate_filename("").is_err());
    }

    #[test]
    fn validate_filename_rejects_path_separators() {
        assert!(validate_filename("foo/bar.exe").is_err());
        assert!(validate_filename("foo\\bar.exe").is_err());
    }

    #[test]
    fn validate_filename_rejects_parent_dir() {
        assert!(validate_filename("../evil.exe").is_err());
        assert!(validate_filename("..").is_err());
        assert!(validate_filename("foo..bar").is_err()); // conservative
    }

    #[test]
    fn validate_filename_rejects_colon_and_null() {
        assert!(validate_filename("C:\\evil.exe").is_err());
        assert!(validate_filename("foo:stream").is_err());
        assert!(validate_filename("foo\0bar").is_err());
    }

    #[test]
    fn validate_filename_rejects_absolute() {
        assert!(validate_filename("/etc/passwd").is_err());
        // On Windows, "C:\\..." is absolute AND contains ':' — either rejection is fine
    }
}
