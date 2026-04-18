use tauri::ipc::Channel;
use tauri::State;

use crate::monitoring::manager::MonitorManager;
use crate::monitoring::types::MonitorData;
use crate::ssh::manager::SshManager;

/// Start monitoring system metrics for an active SSH session.
/// Metrics are streamed back via the `on_event` IPC channel.
#[tauri::command]
pub async fn start_monitoring(
    session_id: String,
    on_event: Channel<MonitorData>,
    ssh_manager: State<'_, SshManager>,
    monitor_manager: State<'_, MonitorManager>,
) -> Result<(), String> {
    let handle = ssh_manager
        .get_handle(&session_id)
        .await
        .map_err(|e| format!("Cannot start monitoring: {}", e))?;
    let active_ids = ssh_manager.active_ids();

    monitor_manager
        .start(session_id, handle, active_ids, on_event)
        .await;

    Ok(())
}

/// Stop monitoring for a session.
#[tauri::command]
pub async fn stop_monitoring(
    session_id: String,
    monitor_manager: State<'_, MonitorManager>,
) -> Result<(), String> {
    monitor_manager.stop(&session_id).await;
    Ok(())
}
