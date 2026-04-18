import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { v4 as uuid } from 'uuid';
import { useSessionStore, type Session, type Folder } from '../../stores/sessionStore';
import SessionDialog from './SessionDialog';
import styles from './SessionSidebar.module.css';

interface SessionSidebarProps {
  onConnect: (session: Session) => void;
  connectedSessionIds: Set<string>;
}

/** MIME type used to carry dragged session ids on the clipboard. Namespaced to
 *  ourselves so we can distinguish our payload from anything else the browser
 *  might attach during drag/drop. */
const DRAG_MIME = 'application/x-zenith-session-ids';

export default function SessionSidebar({ onConnect, connectedSessionIds }: SessionSidebarProps) {
  const {
    sessions,
    folders,
    loadSessions,
    saveSession,
    saveFolder,
    deleteSession,
    deleteFolder,
    toggleFolder,
    moveSession,
  } = useSessionStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);

  // Inline-rename state for folders. When set, that folder's header renders
  // an <input> instead of a <span>. Committing or escaping clears it.
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);

  // Multi-select state for sessions (Ctrl/Cmd/Shift-click). We always drag the
  // current selection when the drag originates from a selected item; otherwise
  // the drag replaces the selection with just that single item.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Anchor for shift-range selection. Null until the user has made at least
  // one non-range click.
  const [anchorId, setAnchorId] = useState<string | null>(null);

  // Which folder (or root) is currently being hovered during a drag. Used to
  // paint the drop-target highlight. null = no drag in progress; '' = root.
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleNewSession = useCallback(() => {
    setEditingSession(null);
    setDialogOpen(true);
  }, []);

  const handleEditSession = useCallback((session: Session) => {
    setEditingSession(session);
    setDialogOpen(true);
  }, []);

  const handleSaveSession = useCallback(
    (session: Session) => {
      saveSession(session);
    },
    [saveSession]
  );

  // Creating a new folder: save it with the default name, then immediately
  // enter inline-rename mode so the user can type the real name without having
  // to go hunting for a rename action.
  const handleNewFolder = useCallback(async () => {
    const folder: Folder = {
      id: uuid(),
      name: 'New Folder',
      sortOrder: folders.length,
      expanded: true,
    };
    await saveFolder(folder);
    setEditingFolderId(folder.id);
  }, [folders.length, saveFolder]);

  const handleDoubleClickSession = useCallback(
    (session: Session) => {
      onConnect(session);
    },
    [onConnect]
  );

  const handleDoubleClickFolder = useCallback(
    (folder: Folder) => {
      const folderSessions = sessions.filter((s) => s.folderId === folder.id);
      for (const s of folderSessions) {
        onConnect(s);
      }
    },
    [sessions, onConnect]
  );

  // Commit a folder rename: trim, reject empty (revert), persist via saveFolder.
  const commitFolderRename = useCallback(
    (folder: Folder, nextName: string) => {
      setEditingFolderId(null);
      const trimmed = nextName.trim();
      if (!trimmed || trimmed === folder.name) return;
      saveFolder({ ...folder, name: trimmed });
    },
    [saveFolder]
  );

  // ---- Selection handling -----------------------------------------------

  // Flat visible order used for shift-range selection. Matches the render
  // order: folders in sortOrder, each folder's sessions in sortOrder, then
  // the root sessions at the bottom.
  const visibleSessionOrder = useMemo(() => {
    const order: string[] = [];
    const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const f of sortedFolders) {
      if (!f.expanded) continue;
      const inFolder = sessions
        .filter((s) => s.folderId === f.id)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      for (const s of inFolder) order.push(s.id);
    }
    const root = sessions
      .filter((s) => !s.folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const s of root) order.push(s.id);
    return order;
  }, [sessions, folders]);

  const handleSessionClick = useCallback(
    (sessionId: string, e: React.MouseEvent) => {
      if (e.shiftKey && anchorId) {
        const start = visibleSessionOrder.indexOf(anchorId);
        const end = visibleSessionOrder.indexOf(sessionId);
        if (start === -1 || end === -1) {
          setSelectedIds(new Set([sessionId]));
          setAnchorId(sessionId);
          return;
        }
        const [lo, hi] = start < end ? [start, end] : [end, start];
        const range = visibleSessionOrder.slice(lo, hi + 1);
        setSelectedIds(new Set(range));
      } else if (e.metaKey || e.ctrlKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          return next;
        });
        setAnchorId(sessionId);
      } else {
        setSelectedIds(new Set([sessionId]));
        setAnchorId(sessionId);
      }
    },
    [anchorId, visibleSessionOrder]
  );

  // ---- Drag & drop ------------------------------------------------------

  // Pack the dragged ids onto dataTransfer. If the drag started on a selected
  // item, carry the entire selection; otherwise carry just the single id (and
  // replace the selection with it so visual state lines up with what's moving).
  const handleSessionDragStart = useCallback(
    (sessionId: string, e: React.DragEvent) => {
      let ids: string[];
      if (selectedIds.has(sessionId) && selectedIds.size > 1) {
        ids = Array.from(selectedIds);
      } else {
        ids = [sessionId];
        setSelectedIds(new Set([sessionId]));
        setAnchorId(sessionId);
      }
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    },
    [selectedIds]
  );

  const parseDraggedIds = (e: React.DragEvent): string[] | null => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed;
      }
    } catch {
      // fall through
    }
    return null;
  };

  // onDragOver must call preventDefault() to mark the element as a valid drop
  // target -- otherwise the browser rejects the drop even if we have an
  // onDrop handler. We also set dropEffect = 'move' so the cursor matches the
  // operation we'll perform.
  const handleDragOver = useCallback((targetId: string, e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTarget((prev) => (prev === targetId ? prev : targetId));
  }, []);

  const handleDragLeave = useCallback((targetId: string, e: React.DragEvent) => {
    // Only clear when the cursor actually leaves the element, not when it
    // moves between the element's own children (relatedTarget will still be
    // inside the target for intra-element moves).
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    setDropTarget((prev) => (prev === targetId ? null : prev));
  }, []);

  const handleDropOnFolder = useCallback(
    (folderId: string, e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const ids = parseDraggedIds(e);
      if (!ids) return;
      for (const id of ids) {
        void moveSession(id, folderId);
      }
    },
    [moveSession]
  );

  const handleDropOnRoot = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      const ids = parseDraggedIds(e);
      if (!ids) return;
      for (const id of ids) {
        void moveSession(id, null);
      }
    },
    [moveSession]
  );

  // ---- Rendering --------------------------------------------------------

  const rootSessions = sessions
    .filter((s) => !s.folderId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getSessionsInFolder = (folderId: string) =>
    sessions.filter((s) => s.folderId === folderId).sort((a, b) => a.sortOrder - b.sortOrder);

  const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className={styles.container}>
      <div className={styles.topActions}>
        <button className={styles.primaryBtn} onClick={handleNewSession}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Session
        </button>
        <button className={styles.secondaryBtn} onClick={handleNewFolder} title="New Folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            <line x1="12" y1="11" x2="12" y2="17" />
            <line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>
      </div>
      <div
        className={styles.list}
        onDragOver={(e) => handleDragOver('', e)}
        onDragLeave={(e) => handleDragLeave('', e)}
        onDrop={handleDropOnRoot}
        data-drop-target={dropTarget === '' ? 'true' : undefined}
      >
        {sortedFolders.map((folder) => {
          const folderSessions = getSessionsInFolder(folder.id);
          const isEditing = editingFolderId === folder.id;
          return (
            <div key={folder.id} className={styles.folderGroup}>
              <div
                className={styles.folderHeader}
                data-drop-target={dropTarget === folder.id ? 'true' : undefined}
                onClick={() => {
                  // Don't toggle expand/collapse while the header is in
                  // rename mode -- the user is typing in the input and we
                  // shouldn't swallow the click as a toggle.
                  if (isEditing) return;
                  toggleFolder(folder.id);
                }}
                onDoubleClick={() => {
                  if (isEditing) return;
                  handleDoubleClickFolder(folder);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setEditingFolderId(folder.id);
                }}
                onDragOver={(e) => handleDragOver(folder.id, e)}
                onDragLeave={(e) => handleDragLeave(folder.id, e)}
                onDrop={(e) => handleDropOnFolder(folder.id, e)}
              >
                <span className={styles.folderArrow}>
                  {folder.expanded ? '\u25BE' : '\u25B8'}
                </span>
                {isEditing ? (
                  <FolderNameInput
                    initial={folder.name}
                    onCommit={(name) => commitFolderRename(folder, name)}
                    onCancel={() => setEditingFolderId(null)}
                  />
                ) : (
                  <span className={styles.folderName}>{folder.name}</span>
                )}
                <span className={styles.badge}>{folderSessions.length}</span>
                <button
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteFolder(folder.id);
                  }}
                  title="Delete folder"
                >
                  &times;
                </button>
              </div>
              {folder.expanded &&
                folderSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    connected={connectedSessionIds.has(session.id)}
                    selected={selectedIds.has(session.id)}
                    indented
                    onClick={(e) => handleSessionClick(session.id, e)}
                    onDoubleClick={() => handleDoubleClickSession(session)}
                    onDragStart={(e) => handleSessionDragStart(session.id, e)}
                    onEdit={() => handleEditSession(session)}
                    onDelete={() => deleteSession(session.id)}
                  />
                ))}
            </div>
          );
        })}

        {rootSessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            connected={connectedSessionIds.has(session.id)}
            selected={selectedIds.has(session.id)}
            indented={false}
            onClick={(e) => handleSessionClick(session.id, e)}
            onDoubleClick={() => handleDoubleClickSession(session)}
            onDragStart={(e) => handleSessionDragStart(session.id, e)}
            onEdit={() => handleEditSession(session)}
            onDelete={() => deleteSession(session.id)}
          />
        ))}

        {sessions.length === 0 && folders.length === 0 && (
          <div className={styles.empty}>No saved sessions</div>
        )}
      </div>

      <SessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSaveSession}
        session={editingSession}
      />
    </div>
  );
}

/** Controlled input for renaming a folder inline. Autofocuses + selects all
 *  on mount so the user can start typing immediately. Enter / blur commits,
 *  Escape reverts. */
function FolderNameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className={styles.folderNameInput}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
    />
  );
}

function SessionItem({
  session,
  connected,
  selected,
  indented,
  onClick,
  onDoubleClick,
  onDragStart,
  onEdit,
  onDelete,
}: {
  session: Session;
  connected: boolean;
  selected: boolean;
  indented: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`${styles.sessionItem} ${indented ? styles.indented : ''} ${selected ? styles.selected : ''}`}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      // Sessions already have an explicit edit pencil; a right-click context
      // menu would be redundant. Swallow the browser's default menu so we
      // don't surprise the user with native Inspect / Reload entries.
      onContextMenu={(e) => e.preventDefault()}
    >
      <span
        className={`${styles.statusDot} ${connected ? styles.statusConnected : ''}`}
      />
      <div className={styles.sessionInfo}>
        <span className={styles.sessionName}>{session.name}</span>
        <span className={styles.sessionHost}>
          {session.username}@{session.hostname}
        </span>
      </div>
      <div className={styles.sessionActions}>
        <button
          className={styles.smallBtn}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Edit"
        >
          &#x270E;
        </button>
        <button
          className={styles.smallBtn}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
