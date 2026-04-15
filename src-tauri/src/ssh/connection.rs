use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use russh::client;
use russh::keys::{self, PrivateKeyWithHashAlg};
use russh::{ChannelMsg, Disconnect};
use tokio::sync::mpsc;

use crate::ssh::types::{AuthMethod, SshConnectRequest, SshEvent};

/// Client handler for russh. Accepts all host keys for now.
struct ClientHandler;

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: Implement known_hosts checking
        Ok(true)
    }
}

/// Represents an active SSH connection with an open shell channel.
pub struct SshConnection {
    handle: client::Handle<ClientHandler>,
    channel: russh::Channel<client::Msg>,
}

impl SshConnection {
    /// Connect to a remote host, authenticate, open a PTY, and start a shell.
    pub async fn connect(request: &SshConnectRequest) -> Result<Self> {
        let config = client::Config {
            inactivity_timeout: Some(Duration::from_secs(600)),
            keepalive_interval: Some(Duration::from_secs(30)),
            ..<_>::default()
        };

        let addr = format!("{}:{}", request.hostname, request.port);
        let mut handle = client::connect(Arc::new(config), &addr, ClientHandler)
            .await
            .context("Failed to connect to SSH server")?;

        // Authenticate
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
            anyhow::bail!("Authentication rejected by server");
        }

        // Open a session channel
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

        Ok(Self { handle, channel })
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
