use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::ipc::Channel;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{interval, MissedTickBehavior};

use crate::monitoring::collector::{collect_sample, compute_metrics, RawSample};
use crate::monitoring::types::MonitorData;
use crate::ssh::manager::ActiveSessionIds;
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
    /// metrics every [`SAMPLE_INTERVAL`] and sends them via the Tauri channel.
    /// If monitoring is already active for this session, the old task is stopped first.
    ///
    /// `active_ids` is a shared handle into the SSH manager so this task can
    /// cheaply observe whether the session is still connected and pause
    /// polling after a disconnect (without hammering a dead channel).
    pub async fn start(
        &self,
        session_id: String,
        handle: SharedSshHandle,
        active_ids: ActiveSessionIds,
        on_event: Channel<MonitorData>,
    ) {
        // Stop any existing monitoring for this session
        self.stop(&session_id).await;

        let sid = session_id.clone();
        let task = tokio::spawn(async move {
            monitoring_loop(&sid, &handle, &active_ids, &on_event).await;
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
///
/// Two safeguards keep the loop from hammering a slow or dead connection:
///   1. An [`AtomicBool`] "busy" flag: if a sample is somehow still in
///      flight when the next tick fires (e.g. a very slow SSH round-trip on
///      an interval that has been reconfigured to fire faster), the tick is
///      skipped rather than piled up.
///   2. A liveness probe against the shared `active_ids` set: if the session
///      has been disconnected we skip the tick entirely (and let the
///      consecutive-error budget eventually tear the loop down if the id
///      never reappears).
async fn monitoring_loop(
    session_id: &str,
    handle: &SharedSshHandle,
    active_ids: &ActiveSessionIds,
    on_event: &Channel<MonitorData>,
) {
    let mut consecutive_errors: u32 = 0;
    const MAX_ERRORS: u32 = 5;

    let busy = Arc::new(AtomicBool::new(false));

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

    // Use a fixed-cadence interval. `Skip` on missed ticks so that if a
    // sample runs long we don't try to "catch up" with a burst of polls --
    // we just wait for the next aligned tick.
    let mut ticker = interval(SAMPLE_INTERVAL);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    // The first `tick()` fires immediately; consume it so the priming sample
    // above and the first in-loop sample aren't spaced by 0ms.
    ticker.tick().await;

    loop {
        ticker.tick().await;

        // Liveness: don't poll a session that has been disconnected.
        // Re-arm happens on the next `start_monitoring` invocation.
        {
            let ids = active_ids.lock().await;
            if !ids.contains(session_id) {
                log::trace!(
                    "monitor: skipping tick for {}, session disconnected",
                    session_id
                );
                continue;
            }
        }

        // Belt-and-suspenders against overlapping polls. The loop is serial
        // by construction (single task, awaited sample), but future refactors
        // that spawn per-tick work would otherwise be able to stack polls on
        // a slow link. CAS false -> true; if it fails, a previous poll is
        // still in flight and we skip.
        if busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            log::trace!(
                "monitor: skipping tick for {}, previous still running",
                session_id
            );
            continue;
        }

        let sample_result = collect_sample(handle).await;
        busy.store(false, Ordering::Release);

        match sample_result {
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
