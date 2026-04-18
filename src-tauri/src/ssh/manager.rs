use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::{mpsc, Mutex};

use crate::ssh::connection::{ConnectError, SharedSshHandle, SshConnection};
use crate::ssh::types::{SshConnectRequest, SshEvent};

/// Entry for an active SSH session, holding the channel senders
/// that drive the connection's event loop and a shared SSH handle
/// for opening additional channels (SFTP, etc.).
struct ConnectionEntry {
    write_tx: mpsc::UnboundedSender<Vec<u8>>,
    resize_tx: mpsc::UnboundedSender<(u32, u32)>,
    handle: SharedSshHandle,
}

/// Shared, readable view of which sessions are currently connected.
/// Handed to subsystems (e.g. monitoring) that need to probe liveness
/// without reaching into the full connections map.
pub type ActiveSessionIds = Arc<Mutex<HashSet<String>>>;

/// Manages all active SSH sessions.
/// Thread-safe: the inner map is behind a tokio Mutex.
pub struct SshManager {
    connections: Arc<Mutex<HashMap<String, ConnectionEntry>>>,
    /// Mirror of `connections.keys()` exposed via [`Self::active_ids`] so
    /// subsystems can check "is this session still connected?" without
    /// needing access to the private `ConnectionEntry` type.
    active_ids: ActiveSessionIds,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            active_ids: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Return a shared handle to the set of currently connected session IDs.
    /// Consumers should acquire the lock briefly just to probe membership.
    pub fn active_ids(&self) -> ActiveSessionIds {
        Arc::clone(&self.active_ids)
    }

    /// Connect to a remote host and start the session event loop.
    ///
    /// The `event_tx` sender is used to push `SshEvent`s back to the caller
    /// (ultimately forwarded to the frontend via Tauri's IPC channel).
    ///
    /// Returns the underlying [`ConnectError`] on failure so the Tauri command
    /// layer can distinguish a host-key mismatch from any other failure mode
    /// without string-matching.
    pub async fn connect(
        &self,
        request: SshConnectRequest,
        event_tx: mpsc::UnboundedSender<SshEvent>,
    ) -> Result<(), ConnectError> {
        let session_id = request.session_id.clone();

        // Establish the SSH connection.
        // connect() returns both the connection and a shared handle.
        let (conn, shared_handle) = SshConnection::connect(&request).await?;

        // Create channels for write and resize commands
        let (write_tx, write_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let (resize_tx, resize_rx) = mpsc::unbounded_channel::<(u32, u32)>();

        // Store the connection entry with the shared handle
        {
            let mut conns = self.connections.lock().await;
            conns.insert(
                session_id.clone(),
                ConnectionEntry {
                    write_tx,
                    resize_tx,
                    handle: shared_handle,
                },
            );
        }
        // Mirror the id into the active set so external subsystems (monitoring)
        // can cheaply ask "is this session still connected?".
        {
            let mut ids = self.active_ids.lock().await;
            ids.insert(session_id.clone());
        }

        // Spawn the event loop on a background task.
        // When it exits (disconnect/error), we clean up the entry.
        let connections = Arc::clone(&self.connections);
        let active_ids = Arc::clone(&self.active_ids);
        tokio::spawn(async move {
            conn.run_loop(event_tx, write_rx, resize_rx).await;

            // Remove from both the map and the active-id mirror once the loop exits.
            {
                let mut conns = connections.lock().await;
                conns.remove(&session_id);
            }
            {
                let mut ids = active_ids.lock().await;
                ids.remove(&session_id);
            }
        });

        Ok(())
    }

    /// Send data (user keystrokes) to an active session.
    pub async fn write(&self, session_id: &str, data: Vec<u8>) -> Result<()> {
        let conns = self.connections.lock().await;
        let entry = conns
            .get(session_id)
            .context("Session not found")?;

        entry
            .write_tx
            .send(data)
            .map_err(|_| anyhow::anyhow!("Session write channel closed"))?;

        Ok(())
    }

    /// Resize the PTY for an active session.
    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<()> {
        let conns = self.connections.lock().await;
        let entry = conns
            .get(session_id)
            .context("Session not found")?;

        entry
            .resize_tx
            .send((cols, rows))
            .map_err(|_| anyhow::anyhow!("Session resize channel closed"))?;

        Ok(())
    }

    /// Get a reference to the shared SSH handle for an active session.
    /// Used by the SFTP subsystem to open additional channels on the same connection.
    pub async fn get_handle(&self, session_id: &str) -> Result<SharedSshHandle> {
        let conns = self.connections.lock().await;
        let entry = conns
            .get(session_id)
            .context("Session not found")?;
        Ok(Arc::clone(&entry.handle))
    }

    /// Disconnect an active session by removing it from the map.
    /// Dropping the senders will cause the event loop to exit.
    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        {
            let mut conns = self.connections.lock().await;
            conns
                .remove(session_id)
                .context("Session not found")?;
        }
        {
            let mut ids = self.active_ids.lock().await;
            ids.remove(session_id);
        }

        Ok(())
    }
}
