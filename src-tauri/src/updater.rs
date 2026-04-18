use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

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
    let dest = std::env::temp_dir().join(filename);

    let client = reqwest::Client::builder()
        .user_agent(concat!("Zenith/", env!("CARGO_PKG_VERSION")))
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

    let mut file = tokio::fs::File::create(&dest).await?;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| UpdateError::Download(e.to_string()))?;
        file.write_all(&bytes).await?;
    }
    file.flush().await?;
    Ok(dest)
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
