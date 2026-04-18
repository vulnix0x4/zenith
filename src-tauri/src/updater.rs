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
    matches!(host, Some("github.com") | Some("objects.githubusercontent.com"))
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
                match attempt.url().host_str() {
                    Some("github.com") | Some("objects.githubusercontent.com") => attempt.follow(),
                    _ => attempt.stop(),
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

// Platform-specific installer spawn — implemented in the next task.
#[cfg(target_os = "windows")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    let _ = path;
    unimplemented!("filled in next task")
}
#[cfg(target_os = "macos")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    let _ = path;
    unimplemented!("filled in next task")
}
#[cfg(target_os = "linux")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    let _ = path;
    unimplemented!("filled in next task")
}
