use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::mpsc;

use crate::ssh::connection::ConnectError;
use crate::ssh::known_hosts;
use crate::ssh::manager::SshManager;
use crate::ssh::types::{SshConnectError, SshConnectRequest, SshEvent};

/// Connect to an SSH server. Events (data, disconnect, errors) are streamed
/// back to the frontend through the `on_event` IPC channel.
///
/// Errors are returned as a serialized [`SshConnectError`] JSON string so the
/// frontend can pattern-match on `kind` -- specifically, a host-key mismatch
/// carries the old + new fingerprints and drives the "trust new key?" prompt
/// in `useSshConnection`.
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

    // Establish the connection first so the session is registered in the
    // manager. Only then signal Connected to the frontend, otherwise the UI
    // can race ahead and call into the backend (e.g. start_monitoring) before
    // the session entry exists.
    let hostname = request.hostname.clone();
    let port = request.port;
    match manager.connect(request, event_tx.clone()).await {
        Ok(()) => {
            let _ = event_tx.send(SshEvent::Connected);
            Ok(())
        }
        Err(ConnectError::HostKeyMismatch { expected, actual }) => {
            // Serialize the structured payload so the frontend can detect it
            // cleanly. `tauri::command` stringifies Result::Err, so JSON is
            // the friendliest carrier.
            let payload = SshConnectError::HostKeyMismatch {
                hostname,
                port,
                expected_fingerprint: expected,
                actual_fingerprint: actual,
            };
            Err(serde_json::to_string(&payload)
                .unwrap_or_else(|_| "{\"kind\":\"other\",\"message\":\"host key mismatch\"}".into()))
        }
        Err(ConnectError::Other(e)) => {
            let payload = SshConnectError::other(format!("{e:#}"));
            Err(serde_json::to_string(&payload).unwrap_or_else(|_| e.to_string()))
        }
    }
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

/// Drop a cached host-key entry so the next connect re-runs TOFU. Called by
/// the frontend when the user acknowledges a mismatch and wants to trust the
/// new key (e.g. after a deliberate server reinstall).
#[tauri::command]
pub async fn forget_host_key(hostname: String, port: u16) -> Result<(), String> {
    known_hosts::forget(&hostname, port).map_err(|e| e.to_string())
}
