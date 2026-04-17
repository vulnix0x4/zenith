use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::ipc::Channel;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::monitoring::collector::{collect_sample, compute_metrics, RawSample};
use crate::monitoring::types::MonitorData;
use crate::ssh::SharedSshHandle;

/// Interval between metric samples. Determines how snappy the live monitor
/// feels. ~1s gives near-real-time updates while keeping SSH overhead modest.
const SAMPLE_INTERVAL: Duration = Duration::from_millis(1000);

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
///
/// Uses a sliding window: take one sample per tick and diff against the
/// previous sample to derive CPU% and network rates. This gives ~1s updates
/// instead of the ~4s cycle a two-samples-per-tick approach would impose.
async fn monitoring_loop(
    session_id: &str,
    handle: &SharedSshHandle,
    on_event: &Channel<MonitorData>,
) {
    let mut consecutive_errors: u32 = 0;
    const MAX_ERRORS: u32 = 5;

    // Prime the window with an initial sample so the very first emission
    // already has a delta to compare against.
    let mut prev: Option<(RawSample, Instant)> = match collect_sample(handle).await {
        Ok(s) => Some((s, Instant::now())),
        Err(e) => {
            log::warn!(
                "Initial monitoring sample failed for session {}: {}",
                session_id,
                e
            );
            None
        }
    };

    loop {
        tokio::time::sleep(SAMPLE_INTERVAL).await;

        match collect_sample(handle).await {
            Ok(curr) => {
                consecutive_errors = 0;
                let now = Instant::now();

                if let Some((p, t)) = &prev {
                    let elapsed = now.duration_since(*t).as_secs_f64();
                    let data = compute_metrics(p, &curr, elapsed);
                    if on_event.send(data).is_err() {
                        log::debug!(
                            "Monitoring channel closed for session {}, stopping",
                            session_id
                        );
                        break;
                    }
                }
                prev = Some((curr, now));
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
    }
}
