use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use russh::client;
use russh::keys::{self, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use tokio::sync::mpsc;

use crate::ssh::known_hosts::{self, CheckResult};
use crate::ssh::types::{AuthMethod, SshConnectRequest, SshEvent};

/// Default seconds between SSH keepalive probes when the caller didn't supply
/// a value. Chosen to be well under common NAT/idle-timeouts (5 minutes on
/// many corporate firewalls) while staying cheap.
const DEFAULT_KEEPALIVE_SECONDS: u64 = 30;

/// Concrete error type surfaced inside `russh::client::Handler::Error`. We
/// only need one distinguishable variant here -- a host-key mismatch -- so we
/// carry the mismatch details inline and fall through to `Russh` for anything
/// the underlying transport produces.
///
/// russh's `client::connect()` returns `Result<Handle<H>, H::Error>`, so
/// `HandlerError` is what we ultimately pattern-match on when the handshake
/// fails, without having to parse text.
#[derive(Debug, thiserror::Error)]
pub enum HandlerError {
    #[error("host key mismatch (expected {expected}, got {actual})")]
    HostKeyMismatch {
        expected: String,
        actual: String,
    },
    #[error(transparent)]
    Russh(#[from] russh::Error),
}

/// Client handler for russh. Enforces host-key TOFU via
/// [`known_hosts::check_and_record`].
pub(crate) struct ClientHandler {
    hostname: String,
    port: u16,
}

impl ClientHandler {
    fn new(hostname: String, port: u16) -> Self {
        Self { hostname, port }
    }
}

impl client::Handler for ClientHandler {
    type Error = HandlerError;

    async fn check_server_key(
        &mut self,
        server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        match known_hosts::check_and_record(&self.hostname, self.port, server_public_key) {
            CheckResult::TrustedOnFirstUse | CheckResult::Match => Ok(true),
            CheckResult::Mismatch { expected_fingerprint, actual_fingerprint } => {
                // Returning Err aborts the handshake. russh propagates this
                // up through `client::connect`, letting the caller downcast
                // the structured mismatch without string parsing.
                Err(HandlerError::HostKeyMismatch {
                    expected: expected_fingerprint,
                    actual: actual_fingerprint,
                })
            }
        }
    }
}

/// Type alias so other modules can hold a handle without knowing ClientHandler.
pub type SshHandle = client::Handle<ClientHandler>;

/// Thread-safe, shared SSH handle.
/// After authentication completes, all Handle methods used (channel_open_session,
/// disconnect) take &self, so an Arc suffices -- no Mutex needed.
pub type SharedSshHandle = Arc<SshHandle>;

/// Distinguishable error returned from `SshConnection::connect` so the
/// Tauri command layer can translate a host-key mismatch into the typed
/// `SshConnectError::HostKeyMismatch` payload.
#[derive(Debug)]
pub enum ConnectError {
    HostKeyMismatch {
        expected: String,
        actual: String,
    },
    Other(anyhow::Error),
}

impl From<anyhow::Error> for ConnectError {
    fn from(e: anyhow::Error) -> Self {
        ConnectError::Other(e)
    }
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::HostKeyMismatch { expected, actual } => write!(
                f,
                "host key mismatch (expected {expected}, got {actual})"
            ),
            ConnectError::Other(e) => write!(f, "{e:#}"),
        }
    }
}

/// Represents an active SSH connection with an open shell channel.
/// The SSH handle is stored externally in a `SharedSshHandle` so that
/// other subsystems (SFTP) can open additional channels.
pub struct SshConnection {
    channel: russh::Channel<client::Msg>,
    handle: SharedSshHandle,
}

impl SshConnection {
    /// Connect to a remote host, authenticate, open a PTY, and start a shell.
    /// Returns the connection and a shared handle that can be used to open
    /// additional channels (e.g. for SFTP).
    pub async fn connect(
        request: &SshConnectRequest,
    ) -> Result<(Self, SharedSshHandle), ConnectError> {
        // Translate the caller's keepalive preference into an Option<Duration>:
        //   None               -> fall back to DEFAULT_KEEPALIVE_SECONDS.
        //   Some(0)            -> disabled.
        //   Some(n) when n > 0 -> Duration::from_secs(n).
        let keepalive = match request.keepalive_seconds {
            Some(0) => None,
            Some(n) => Some(Duration::from_secs(n)),
            None => Some(Duration::from_secs(DEFAULT_KEEPALIVE_SECONDS)),
        };

        let config = client::Config {
            inactivity_timeout: Some(Duration::from_secs(600)),
            keepalive_interval: keepalive,
            ..<_>::default()
        };

        let addr = format!("{}:{}", request.hostname, request.port);
        let handler = ClientHandler::new(request.hostname.clone(), request.port);
        let mut handle = match client::connect(Arc::new(config), &addr, handler).await {
            Ok(h) => h,
            Err(HandlerError::HostKeyMismatch { expected, actual }) => {
                return Err(ConnectError::HostKeyMismatch { expected, actual });
            }
            Err(HandlerError::Russh(e)) => {
                return Err(ConnectError::Other(
                    anyhow::Error::new(e).context("Failed to connect to SSH server"),
                ));
            }
        };

        // Authenticate (requires &mut handle)
        let auth_result = match &request.auth_method {
            AuthMethod::Password { password } => {
                handle
                    .authenticate_password(&request.username, password)
                    .await
                    .context("Password authentication failed")?
            }
            AuthMethod::PrivateKey { key_path, passphrase } => {
                let key_pair = keys::load_secret_key(
                    key_path,
                    passphrase.as_deref(),
                )
                .context("Failed to load private key")?;

                let rsa_hash = handle
                    .best_supported_rsa_hash()
                    .await
                    .context("Failed to negotiate RSA hash algorithm")?
                    .flatten();

                let key_with_alg = PrivateKeyWithHashAlg::new(
                    Arc::new(key_pair),
                    rsa_hash,
                );

                handle
                    .authenticate_publickey(&request.username, key_with_alg)
                    .await
                    .context("Public key authentication failed")?
            }
        };

        if !auth_result.success() {
            return Err(ConnectError::Other(anyhow::anyhow!(
                "Authentication rejected by server"
            )));
        }

        // Open a session channel for the interactive shell
        let channel = handle
            .channel_open_session()
            .await
            .context("Failed to open session channel")?;

        // Request a PTY
        channel
            .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
            .await
            .context("Failed to request PTY")?;

        // Start the shell
        channel
            .request_shell(false)
            .await
            .context("Failed to request shell")?;

        // Wrap the handle in Arc now that auth is done.
        // All post-auth methods (channel_open_session, disconnect) take &self.
        let shared_handle = Arc::new(handle);
        let conn = Self {
            channel,
            handle: Arc::clone(&shared_handle),
        };

        Ok((conn, shared_handle))
    }

    /// Run the main event loop. Multiplexes:
    /// - Reading from the SSH channel and forwarding events
    /// - Writing user input to the SSH channel
    /// - Handling PTY resize requests
    ///
    /// This consumes the connection.
    pub async fn run_loop(
        mut self,
        event_tx: mpsc::UnboundedSender<SshEvent>,
        mut write_rx: mpsc::UnboundedReceiver<Vec<u8>>,
        mut resize_rx: mpsc::UnboundedReceiver<(u32, u32)>,
    ) {
        loop {
            tokio::select! {
                msg = self.channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) => {
                            let _ = event_tx.send(SshEvent::Data {
                                bytes: data.to_vec(),
                            });
                        }
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            // stderr data - forward as regular data
                            let _ = event_tx.send(SshEvent::Data {
                                bytes: data.to_vec(),
                            });
                        }
                        Some(ChannelMsg::ExitStatus { .. })
                        | Some(ChannelMsg::Eof)
                        | Some(ChannelMsg::Close)
                        | None => {
                            let _ = event_tx.send(SshEvent::Disconnected);
                            break;
                        }
                        _ => {}
                    }
                }
                data = write_rx.recv() => {
                    match data {
                        Some(bytes) => {
                            if let Err(e) = self.channel.data(&bytes[..]).await {
                                let _ = event_tx.send(SshEvent::Error {
                                    message: format!("Write error: {e}"),
                                });
                                break;
                            }
                        }
                        None => {
                            // Write channel closed, session is being torn down
                            break;
                        }
                    }
                }
                size = resize_rx.recv() => {
                    match size {
                        Some((cols, rows)) => {
                            if let Err(e) = self.channel.window_change(cols, rows, 0, 0).await {
                                let _ = event_tx.send(SshEvent::Error {
                                    message: format!("Resize error: {e}"),
                                });
                            }
                        }
                        None => {
                            // Resize channel closed
                            break;
                        }
                    }
                }
            }
        }

        // Clean up: send EOF and disconnect
        let _ = self.channel.eof().await;
        let _ = self
            .handle
            .disconnect(Disconnect::ByApplication, "", "")
            .await;
    }
}
