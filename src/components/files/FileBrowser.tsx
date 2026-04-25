import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSftp, type FileEntry } from '../../hooks/useSftp';
import { useSettingsStore } from '../../stores/settingsStore';
import { SftpTransferIndicator } from './SftpTransferIndicator';
import styles from './FileBrowser.module.css';

interface FileBrowserProps {
  sessionId: string | null;
  /** Last reported terminal CWD for the active tab; null if shell hasn't
   *  emitted OSC 7 yet, or if the user is on a tab without one. */
  terminalCwd?: string | null;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry | null;
}

export default function FileBrowser({ sessionId, terminalCwd }: FileBrowserProps) {
  const followCwd = useSettingsStore((s) => s.settings.general.followTerminalCwd);
  const showHidden = useSettingsStore((s) => s.settings.general.showHiddenFiles);
  const updateGeneral = useSettingsStore((s) => s.updateGeneral);
  const {
    currentPath,
    entries,
    loading,
    error,
    navigateTo,
    download,
    upload,
    uploadFolder,
    uploadDropped,
    deleteEntry,
    renameEntry,
    createDir,
  } = useSftp(sessionId);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [initialized, setInitialized] = useState(false);
  // Tracks whether a file drag is currently over the panel. Used to render
  // a drop-target overlay. We count enters/leaves because a single drag
  // generates leave+enter events as it crosses child elements; relying on
  // a boolean would flicker.
  const [dragDepth, setDragDepth] = useState(0);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const prevSessionRef = useRef<string | null>(null);

  // Navigate to home on session change
  useEffect(() => {
    if (sessionId && sessionId !== prevSessionRef.current) {
      prevSessionRef.current = sessionId;
      setInitialized(false);
      navigateTo('/').then(() => setInitialized(true));
    }
  }, [sessionId, navigateTo]);

  // Auto-follow the terminal's working directory when the setting is on.
  // Only fires when terminalCwd actually changes (and isn't where we already
  // are), so manual navigation in the file browser isn't constantly
  // overridden by stale OSC 7 emits.
  useEffect(() => {
    if (!followCwd || !terminalCwd || !sessionId) return;
    if (terminalCwd === currentPath) return;
    navigateTo(terminalCwd);
  }, [terminalCwd, followCwd, sessionId, currentPath, navigateTo]);

  // Send a `cd <path>` line into the active SSH session's PTY. Used to keep
  // the terminal in sync when the user navigates the file browser. Only runs
  // when the follow-CWD setting is on -- otherwise the user has explicitly
  // opted into independent file browser navigation.
  //
  // The leading space lets shells with HISTCONTROL=ignorespace /
  // HIST_IGNORE_SPACE skip it from history. Single-quotes around the path
  // (with embedded `'` escaped as `'\''`) prevent variable / glob expansion.
  const sendCdToTerminal = useCallback(
    (path: string) => {
      if (!sessionId || !followCwd) return;
      const escaped = path.replace(/'/g, `'\\''`);
      const line = ` cd '${escaped}'\n`;
      invoke('ssh_write', {
        sessionId,
        data: Array.from(new TextEncoder().encode(line)),
      }).catch(() => {
        // Write failure -- file browser still navigated, terminal just stays put
      });
    },
    [sessionId, followCwd]
  );

  // User-initiated navigation: jump the file browser AND drive the terminal's
  // working directory so they don't desync. Used by the row click, breadcrumb
  // click, and parent-directory button handlers.
  const navigateAndSync = useCallback(
    async (path: string) => {
      await navigateTo(path);
      sendCdToTerminal(path);
    },
    [navigateTo, sendCdToTerminal]
  );

  // Focus rename input
  useEffect(() => {
    if (renamingPath && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingPath]);

  const closeContext = useCallback(() => setContextMenu(null), []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry | null) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    []
  );

  const handleRowClick = useCallback(
    (entry: FileEntry) => {
      if (entry.isDir) {
        navigateAndSync(entry.path);
      }
    },
    [navigateAndSync]
  );

  // Parent-directory handler that also `cd ..`s the terminal. Re-implements
  // useSftp.goUp's path math here so we have the resolved parent path to
  // send to the shell (otherwise the terminal would stay put).
  const handleGoUp = useCallback(() => {
    if (currentPath === '/') return;
    const parts = currentPath.replace(/\/$/, '').split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    navigateAndSync(parent);
  }, [currentPath, navigateAndSync]);

  const handleDownload = useCallback(() => {
    if (contextMenu?.entry && !contextMenu.entry.isDir) {
      download(contextMenu.entry.path, contextMenu.entry.name);
    }
    closeContext();
  }, [contextMenu, download, closeContext]);

  const handleDelete = useCallback(() => {
    if (contextMenu?.entry) {
      deleteEntry(contextMenu.entry.path);
    }
    closeContext();
  }, [contextMenu, deleteEntry, closeContext]);

  const startRename = useCallback(() => {
    if (contextMenu?.entry) {
      setRenamingPath(contextMenu.entry.path);
      setRenameValue(contextMenu.entry.name);
    }
    closeContext();
  }, [contextMenu, closeContext]);

  const commitRename = useCallback(() => {
    if (renamingPath && renameValue.trim()) {
      const parts = renamingPath.split('/');
      parts.pop();
      const newPath = [...parts, renameValue.trim()].join('/');
      renameEntry(renamingPath, newPath);
    }
    setRenamingPath(null);
  }, [renamingPath, renameValue, renameEntry]);

  const handleNewFolder = useCallback(() => {
    const name = 'new_folder';
    createDir(name);
    closeContext();
  }, [createDir, closeContext]);

  const handleUpload = useCallback(() => {
    upload();
    closeContext();
  }, [upload, closeContext]);

  // Filter out drags that don't actually carry files (text drags, browser
  // tab drags, the app's own tab-drag-to-split). Without this guard the drop
  // overlay flashes whenever a tab is dragged over the file panel.
  const dragHasFiles = useCallback((e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    if (!types) return false;
    // Most browsers expose 'Files' on the types list when the drag includes
    // OS files. Some older webviews use 'application/x-moz-file' instead.
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      if (t === 'Files' || t === 'application/x-moz-file') return true;
    }
    return false;
  }, []);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDragDepth((d) => d + 1);
    },
    [dragHasFiles]
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      // 'copy' produces the green-plus cursor, signalling "this drop will
      // upload" rather than the default move/link cursors.
      e.dataTransfer.dropEffect = 'copy';
    },
    [dragHasFiles]
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDragDepth((d) => Math.max(0, d - 1));
    },
    [dragHasFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDragDepth(0);
      // Prefer items (carries directory entries) over files (flat). Both
      // come from the same DataTransfer; we hand whichever exists to the
      // hook's traversal.
      const dt = e.dataTransfer;
      if (dt.items && dt.items.length > 0) {
        uploadDropped(dt.items);
      } else if (dt.files && dt.files.length > 0) {
        uploadDropped(dt.files);
      }
    },
    [dragHasFiles, uploadDropped]
  );

  if (!sessionId) {
    return (
      <div className={styles.noConnection}>
        Connect to a server to browse files
      </div>
    );
  }

  // Build breadcrumb segments
  const pathParts = currentPath.split('/').filter(Boolean);
  const breadcrumbs: { label: string; path: string }[] = [
    { label: '/', path: '/' },
  ];
  let accumulated = '';
  for (const part of pathParts) {
    accumulated += `/${part}`;
    breadcrumbs.push({ label: part, path: accumulated });
  }

  return (
    <div
      className={styles.fileBrowser}
      onContextMenu={(e) => handleContextMenu(e, null)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Path bar */}
      <div className={styles.pathBar} data-private>
        {breadcrumbs.map((seg, i) => (
          <span key={seg.path} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span className={styles.pathSep}>/</span>}
            <button
              className={`${styles.pathSegment} ${i === breadcrumbs.length - 1 ? styles.pathSegmentCurrent : ''}`}
              onClick={() => {
                if (i < breadcrumbs.length - 1) navigateAndSync(seg.path);
              }}
            >
              {seg.label}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button className={styles.toolBtn} onClick={handleGoUp} title="Parent directory" aria-label="Parent directory">
          {/* up arrow */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
        <button className={styles.toolBtn} onClick={() => navigateTo(currentPath)} title="Refresh (no terminal change)" aria-label="Refresh">
          {/* refresh */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <button className={styles.toolBtn} onClick={upload} title="Upload file(s)" aria-label="Upload file(s)">
          {/* upload tray */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
        <button className={styles.toolBtn} onClick={uploadFolder} title="Upload folder" aria-label="Upload folder">
          {/* folder + upward arrow -- distinct from the plain upload tray */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <polyline points="9 14 12 11 15 14" />
            <line x1="12" y1="11" x2="12" y2="18" />
          </svg>
        </button>
        <div className={styles.toolbarSpacer} />
        <button
          className={`${styles.toolBtn} ${showHidden ? styles.toolBtnActive : ''}`}
          onClick={() => updateGeneral({ showHiddenFiles: !showHidden })}
          title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
          aria-label="Toggle hidden files"
        >
          {/* eye / eye-off */}
          {showHidden ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          )}
        </button>
      </div>

      {/* Drop-target overlay -- visible only while a file drag is over the
          panel. pointer-events:none in CSS so it doesn't swallow drag events
          (otherwise the dragleave from the underlying panel never fires
          when the cursor crosses the overlay edge). */}
      {dragDepth > 0 && (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropOverlayInner}>
            Drop to upload to <span data-private>{currentPath}</span>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && <div className={styles.errorMsg}>{error}</div>}

      {/* Loading */}
      {loading && (
        <div className={styles.loading}>
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
          <span className={styles.loadingDot} />
        </div>
      )}

      {/* File list */}
      {!loading && (
        <div className={styles.fileList}>
          {entries
            .filter((entry) => showHidden || !entry.name.startsWith('.'))
            .map((entry) => {
              // Symlinks get a dedicated arrow glyph + styling so they're
              // visually distinct from regular files / dirs. We don't
              // resolve the target -- that'd need another SFTP round-trip
              // per entry and isn't justified for this level of polish.
              const isSymlink = entry.fileType === 'symlink';
              const nameClass = isSymlink
                ? styles.symlinkName
                : entry.isDir
                  ? styles.dirName
                  : styles.regularName;
              const icon = isSymlink
                ? '\u2937' // downwards arrow with tip rightwards -- reads as "link"
                : entry.isDir
                  ? '\uD83D\uDCC1'
                  : '\uD83D\uDCC4';
              return (
                <div
                  key={entry.path}
                  className={styles.fileRow}
                  onClick={() => handleRowClick(entry)}
                  onContextMenu={(e) => handleContextMenu(e, entry)}
                >
                  <span className={styles.fileIcon}>{icon}</span>
                  {renamingPath === entry.path ? (
                    <input
                      ref={renameInputRef}
                      className={styles.renameInput}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenamingPath(null);
                      }}
                    />
                  ) : (
                    <span className={`${styles.fileName} ${nameClass}`} data-private>
                      {entry.name}
                    </span>
                  )}
                  {!entry.isDir && !isSymlink && (
                    <span className={styles.fileMeta}>{formatSize(entry.size)}</span>
                  )}
                </div>
              );
            })}
          {!loading && entries.length === 0 && initialized && (
            <div className={styles.loading}>Empty directory</div>
          )}
        </div>
      )}

      {/* In-flight / recently-finished transfers. Renders nothing when the
          store's `transfers` list is empty, so has zero cost at rest. */}
      <SftpTransferIndicator />

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className={styles.contextOverlay} onClick={closeContext} onContextMenu={(e) => { e.preventDefault(); closeContext(); }} />
          <div
            className={styles.contextMenu}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.entry && !contextMenu.entry.isDir && (
              <button className={styles.contextItem} onClick={handleDownload}>
                Download
              </button>
            )}
            <button className={styles.contextItem} onClick={handleUpload}>
              Upload file(s) here
            </button>
            <button
              className={styles.contextItem}
              onClick={() => {
                uploadFolder();
                closeContext();
              }}
            >
              Upload folder here
            </button>
            <div className={styles.contextDivider} />
            <button className={styles.contextItem} onClick={handleNewFolder}>
              New Folder
            </button>
            {contextMenu.entry && (
              <>
                <button className={styles.contextItem} onClick={startRename}>
                  Rename
                </button>
                <button className={styles.contextItem} onClick={handleDelete}>
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
