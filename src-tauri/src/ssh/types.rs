use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectRequest {
    pub session_id: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    /// Optional override for the per-session SSH keepalive interval, in
    /// seconds. `None` falls back to the default (30s). `Some(0)` disables
    /// keepalives, which is useful for quirky servers that treat them as
    /// a session-idle signal.
    #[serde(default)]
    pub keepalive_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AuthMethod {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SshEvent {
    Connected,
    Data { bytes: Vec<u8> },
    Error { message: String },
    Disconnected,
}

/// Structured error payload returned from `ssh_connect`. The frontend pattern-
/// matches on `kind` to decide between a generic toast and the host-key-mismatch
/// confirmation dialog. Anything that isn't a mismatch falls through to `Other`,
/// which carries the untyped message for display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SshConnectError {
    #[serde(rename_all = "camelCase")]
    HostKeyMismatch {
        hostname: String,
        port: u16,
        expected_fingerprint: String,
        actual_fingerprint: String,
    },
    Other { message: String },
}

impl SshConnectError {
    pub fn other<S: Into<String>>(message: S) -> Self {
        Self::Other { message: message.into() }
    }
}
