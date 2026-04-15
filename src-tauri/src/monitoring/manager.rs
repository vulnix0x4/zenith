use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tauri::ipc::Channel;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::monitoring::collector::collect_metrics;
use crate::monitoring::types::MonitorData;
use crate::ssh::SharedSshHandle;

/// Manages background monitoring tasks, one per SSH session.
pub struct MonitorManager {
    tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl MonitorManager {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Start monitoring for a session. Spawns a background task that polls
    /// metrics every ~3 seconds and sends them via the Tauri channel.
    /// If monitoring is already active for this session, the old task is stopped first.
    pub async fn start(
        &self,
        session_id: String,
        handle: SharedSshHandle,
        on_event: Channel<MonitorData>,
    ) {
        // Stop any existing monitoring for this session
        self.stop(&session_id).await;

        let sid = session_id.clone();
        let task = tokio::spawn(async move {
            monitoring_loop(&sid, &handle, &on_event).await;
        });

        let mut tasks = self.tasks.lock().await;
        tasks.insert(session_id, task);
    }

    /// Stop monitoring for a session by aborting its background task.
    pub async fn stop(&self, session_id: &str) {
        let mut tasks = self.tasks.lock().await;
        if let Some(handle) = tasks.remove(session_id) {
            handle.abort();
        }
    }

    /// Stop all monitoring tasks. Called during shutdown.
    #[allow(dead_code)]
    pub async fn stop_all(&self) {
        let mut tasks = self.tasks.lock().await;
        for (_, handle) in tasks.drain() {
            handle.abort();
        }
    }
}

/// The main polling loop. Runs until the task is aborted or the SSH connection drops.
async fn monitoring_loop(
    session_id: &str,
    handle: &SharedSshHandle,
    on_event: &Channel<MonitorData>,
) {
    let mut consecutive_errors: u32 = 0;
    const MAX_ERRORS: u32 = 5;

    loop {
        match collect_metrics(handle).await {
            Ok(data) => {
                consecutive_errors = 0;
                if on_event.send(data).is_err() {
                    // Channel closed, frontend no longer listening
                    log::debug!(
                        "Monitoring channel closed for session {}, stopping",
                        session_id
                    );
                    break;
                }
            }
            Err(e) => {
                consecutive_errors += 1;
                log::warn!(
                    "Monitoring error for session {} ({}/{}): {}",
                    session_id,
                    consecutive_errors,
                    MAX_ERRORS,
                    e
                );

                if consecutive_errors >= MAX_ERRORS {
                    log::error!(
                        "Too many consecutive monitoring errors for session {}, stopping",
                        session_id
                    );
                    break;
                }
            }
        }

        // Wait before next poll. The collect itself takes ~1s (two samples),
        // so the effective interval is ~3-4 seconds.
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}
