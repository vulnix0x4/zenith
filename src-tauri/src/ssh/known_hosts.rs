//! Host-key TOFU (Trust On First Use) store.
//!
//! Persists accepted SSH host keys to `<config_dir>/zenith/known_hosts` so that
//! MITM attacks get flagged on reconnect.
//!
//! File format (ASCII, one entry per line, `#` comments ignored):
//!
//!   <hostname>:<port> <algorithm> <SHA256:base64-fingerprint>
//!
//! We deliberately invented our own format rather than reusing OpenSSH's
//! `known_hosts` wire format because:
//!   * OpenSSH encodes the FULL key; we only need a fingerprint for detection.
//!   * Hashed-hostname support + wildcards + @cert-authority markers add
//!     complexity we don't need.
//!   * A greenfield file side-steps any chance of corrupting the user's real
//!     ~/.ssh/known_hosts.
//!
//! The trust decision is:
//!   * no matching line  -> TOFU: accept + append (first connect).
//!   * matching line same fingerprint -> accept silently.
//!   * matching line different fingerprint -> reject with `Mismatch { .. }`.

use std::fs;
use std::path::PathBuf;

use russh::keys::ssh_key::{HashAlg, PublicKey};

use crate::sessions::storage::data_dir;
use crate::storage_util::atomic_write;

/// Outcome of checking a server key against the on-disk store.
pub enum CheckResult {
    /// First time we've seen this host -- caller should treat as trusted and
    /// the entry has already been appended to the file.
    TrustedOnFirstUse,
    /// Stored fingerprint matches the presented key.
    Match,
    /// Stored fingerprint does NOT match. Connection MUST be rejected.
    Mismatch {
        expected_fingerprint: String,
        actual_fingerprint: String,
    },
}

fn known_hosts_file() -> PathBuf {
    data_dir().join("known_hosts")
}

/// Serialize a `PublicKey` to `SHA256:<base64>` via ssh-key's built-in
/// `Display` impl on `Fingerprint`. SHA-256 is what OpenSSH uses by default.
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// Human-readable algorithm name, e.g. "ssh-ed25519", "ssh-rsa".
pub fn algorithm_name(key: &PublicKey) -> String {
    key.algorithm().as_str().to_string()
}

/// Parsed `known_hosts` entry. Private -- only used inside this module to
/// keep the file-format details contained.
struct Entry {
    host_key: String, // "hostname:port"
    #[allow(dead_code)]
    algorithm: String,
    fingerprint: String,
}

fn load_entries() -> Vec<Entry> {
    let path = known_hosts_file();
    let text = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
        Err(e) => {
            log::warn!("known_hosts read failed ({e}); treating as empty");
            return Vec::new();
        }
    };
    text.lines()
        .filter_map(parse_line)
        .collect()
}

fn parse_line(line: &str) -> Option<Entry> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut parts = line.splitn(3, char::is_whitespace);
    let host_key = parts.next()?.to_string();
    let algorithm = parts.next()?.to_string();
    let fingerprint = parts.next()?.trim().to_string();
    Some(Entry { host_key, algorithm, fingerprint })
}

fn host_key_for(hostname: &str, port: u16) -> String {
    format!("{hostname}:{port}")
}

/// Append a fresh entry to the known_hosts file. The file is rewritten
/// atomically to avoid a partial line on crash.
fn append_entry(hostname: &str, port: u16, algorithm: &str, fingerprint: &str) {
    let mut entries = load_entries();
    entries.push(Entry {
        host_key: host_key_for(hostname, port),
        algorithm: algorithm.to_string(),
        fingerprint: fingerprint.to_string(),
    });
    write_entries(&entries);
}

fn write_entries(entries: &[Entry]) {
    let mut out = String::from(
        "# Zenith known hosts. One entry per line: \
         <hostname>:<port> <algorithm> <SHA256:base64-fingerprint>\n",
    );
    for e in entries {
        out.push_str(&format!("{} {} {}\n", e.host_key, e.algorithm, e.fingerprint));
    }
    if let Err(err) = atomic_write(&known_hosts_file(), out.as_bytes()) {
        log::warn!("known_hosts write failed: {err}");
    }
}

/// Trust-on-first-use check. On a brand new hostname the key is recorded and
/// we return `TrustedOnFirstUse`. On a hostname we already know, we compare
/// fingerprints; a mismatch yields `Mismatch`, a match yields `Match`.
pub fn check_and_record(hostname: &str, port: u16, key: &PublicKey) -> CheckResult {
    let needle = host_key_for(hostname, port);
    let presented_fp = fingerprint(key);
    let algorithm = algorithm_name(key);

    let entries = load_entries();
    let existing = entries.iter().find(|e| e.host_key == needle);

    match existing {
        None => {
            append_entry(hostname, port, &algorithm, &presented_fp);
            log::info!(
                "known_hosts: TOFU-trusting new host {needle} ({algorithm} {presented_fp})"
            );
            CheckResult::TrustedOnFirstUse
        }
        Some(entry) if entry.fingerprint == presented_fp => CheckResult::Match,
        Some(entry) => CheckResult::Mismatch {
            expected_fingerprint: entry.fingerprint.clone(),
            actual_fingerprint: presented_fp,
        },
    }
}

/// Remove any entry for `hostname:port`. No-op if nothing matched.
/// Used by `forget_host_key` so the user can re-accept a rotated key after
/// a deliberate server reinstall.
pub fn forget(hostname: &str, port: u16) -> std::io::Result<()> {
    let needle = host_key_for(hostname, port);
    let entries = load_entries();
    let before = entries.len();
    let filtered: Vec<Entry> = entries
        .into_iter()
        .filter(|e| e.host_key != needle)
        .collect();
    if filtered.len() != before {
        write_entries(&filtered);
        log::info!("known_hosts: forgot entry for {needle}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_line;

    #[test]
    fn parse_line_skips_blank_and_comments() {
        assert!(parse_line("").is_none());
        assert!(parse_line("   ").is_none());
        assert!(parse_line("# comment").is_none());
        assert!(parse_line("  # indented comment").is_none());
    }

    #[test]
    fn parse_line_reads_well_formed_entry() {
        let e = parse_line("example.com:22 ssh-ed25519 SHA256:abc123").unwrap();
        assert_eq!(e.host_key, "example.com:22");
        assert_eq!(e.algorithm, "ssh-ed25519");
        assert_eq!(e.fingerprint, "SHA256:abc123");
    }

    #[test]
    fn parse_line_rejects_truncated_entries() {
        assert!(parse_line("example.com:22").is_none());
        assert!(parse_line("example.com:22 ssh-ed25519").is_none());
    }
}
