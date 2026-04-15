import { useEffect, useState, useCallback, useRef } from 'react';
import { useSftp, type FileEntry } from '../../hooks/useSftp';
import styles from './FileBrowser.module.css';

interface FileBrowserProps {
  sessionId: string | null;
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

export default function FileBrowser({ sessionId }: FileBrowserProps) {
  const {
    currentPath,
    entries,
    loading,
    error,
    navigateTo,
    goUp,
    download,
    upload,
    deleteEntry,
    renameEntry,
    createDir,
  } = useSftp(sessionId);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [initialized, setInitialized] = useState(false);
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
        navigateTo(entry.path);
      }
    },
    [navigateTo]
  );

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
    <div className={styles.fileBrowser} onContextMenu={(e) => handleContextMenu(e, null)}>
      {/* Path bar */}
      <div className={styles.pathBar}>
        {breadcrumbs.map((seg, i) => (
          <span key={seg.path} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span className={styles.pathSep}>/</span>}
            <button
              className={`${styles.pathSegment} ${i === breadcrumbs.length - 1 ? styles.pathSegmentCurrent : ''}`}
              onClick={() => {
                if (i < breadcrumbs.length - 1) navigateTo(seg.path);
              }}
            >
              {seg.label}
            </button>
          </span>
        ))}
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button className={styles.toolBtn} onClick={goUp} title="Parent directory">
          ..
        </button>
        <button className={styles.toolBtn} onClick={() => navigateTo(currentPath)} title="Refresh">
          Refresh
        </button>
        <button className={styles.toolBtn} onClick={upload} title="Upload file">
          Upload
        </button>
      </div>

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
          {entries.map((entry) => (
            <div
              key={entry.path}
              className={styles.fileRow}
              onClick={() => handleRowClick(entry)}
              onContextMenu={(e) => handleContextMenu(e, entry)}
            >
              <span className={styles.fileIcon}>{entry.isDir ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
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
                <span className={`${styles.fileName} ${entry.isDir ? styles.dirName : styles.regularName}`}>
                  {entry.name}
                </span>
              )}
              {!entry.isDir && (
                <span className={styles.fileMeta}>{formatSize(entry.size)}</span>
              )}
            </div>
          ))}
          {!loading && entries.length === 0 && initialized && (
            <div className={styles.loading}>Empty directory</div>
          )}
        </div>
      )}

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
              Upload here
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
