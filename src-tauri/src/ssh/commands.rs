use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;

use crate::ssh::manager::SshManager;
use crate::ssh::types::{SshConnectRequest, SshEvent};

/// Connect to an SSH server. Events (data, disconnect, errors) are streamed
/// back to the frontend through the `on_event` IPC channel.
#[tauri::command]
pub async fn ssh_connect(
    request: SshConnectRequest,
    on_event: Channel<SshEvent>,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<SshEvent>();

    // Spawn a task that bridges the mpsc channel to the Tauri IPC channel
    let channel = on_event;
    tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let _ = channel.send(event);
        }
    });

    // Send Connected event first, then establish the connection
    let _ = event_tx.send(SshEvent::Connected);

    manager
        .connect(request, event_tx)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Send data (user keystrokes) to an active SSH session.
#[tauri::command]
pub async fn ssh_write(
    session_id: String,
    data: Vec<u8>,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    manager
        .write(&session_id, data)
        .await
        .map_err(|e| e.to_string())
}

/// Resize the PTY of an active SSH session.
#[tauri::command]
pub async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    manager
        .resize(&session_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

/// Disconnect an active SSH session.
#[tauri::command]
pub async fn ssh_disconnect(
    session_id: String,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    manager
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}
