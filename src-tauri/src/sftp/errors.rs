use russh_sftp::client::error::Error as SftpClientError;
use russh_sftp::protocol::StatusCode;

/// Marker string the frontend looks for to detect a refused-overwrite upload.
/// Keep in sync with the detection in `src/hooks/useSftp.ts`.
pub const FILE_EXISTS_MARKER: &str = "FILE_EXISTS";

/// Convert a `russh_sftp` client error into a human-readable string.
///
/// SFTP status responses (the common case) map to their spec'd text names
/// so users see "Permission denied" instead of
/// `StatusCode { code: 3, error_message: "", ... }`. For `Failure` we keep
/// the server-provided message since it's the designated "no specific code"
/// bucket. Non-status errors (I/O, timeout, unexpected packets) fall through
/// to their `Display` impl.
pub fn humanize_sftp_error(err: &SftpClientError) -> String {
    match err {
        SftpClientError::Status(status) => match status.status_code {
            StatusCode::PermissionDenied => "Permission denied".to_string(),
            StatusCode::NoSuchFile => "File not found".to_string(),
            StatusCode::Failure => {
                // Generic error - prefer the server's message if any
                if status.error_message.is_empty() {
                    "Operation failed".to_string()
                } else {
                    status.error_message.clone()
                }
            }
            StatusCode::BadMessage => "Bad message".to_string(),
            StatusCode::NoConnection => "No connection".to_string(),
            StatusCode::ConnectionLost => "Connection lost".to_string(),
            StatusCode::OpUnsupported => "Operation not supported".to_string(),
            StatusCode::Eof => "End of file".to_string(),
            StatusCode::Ok => "OK".to_string(),
        },
        SftpClientError::IO(msg) => format!("I/O error: {msg}"),
        SftpClientError::Timeout => "Timed out".to_string(),
        SftpClientError::Limited(msg) => format!("Limit exceeded: {msg}"),
        SftpClientError::UnexpectedPacket => "Unexpected SFTP packet".to_string(),
        SftpClientError::UnexpectedBehavior(msg) => msg.clone(),
    }
}

/// Helper: tag an `anyhow::Error` so the frontend can detect file-exists
/// refusals from an upload without parsing free-form text. The frontend
/// greps for `FILE_EXISTS_MARKER` in the error string.
pub fn file_exists_error(remote_path: &str) -> anyhow::Error {
    anyhow::anyhow!("{FILE_EXISTS_MARKER}: {remote_path}")
}
