use serde::{Deserialize, Serialize};

/// What kind of filesystem entry this is. Distinguishes symlinks so the UI
/// can render them with a dedicated glyph. "Other" covers fifos, sockets,
/// block/char devices -- rare on paths users browse.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<String>,
    /// Kind of entry (file, directory, symlink, other). This is richer than
    /// `is_dir` because symlinks appear as neither dir nor regular file via
    /// the mode bits alone.
    pub file_type: FileKind,
}
