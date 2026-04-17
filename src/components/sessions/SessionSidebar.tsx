import { useEffect, useState, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useSessionStore, type Session, type Folder } from '../../stores/sessionStore';
import SessionDialog from './SessionDialog';
import styles from './SessionSidebar.module.css';

interface SessionSidebarProps {
  onConnect: (session: Session) => void;
  connectedSessionIds: Set<string>;
}

/** Custom MIME used to mark a session-id payload during drag-and-drop.
 *  Anything more generic (text/plain) would let unrelated drags fool the
 *  drop targets into thinking they have a session in flight. */
const SESSION_MIME = 'application/x-zenith-session';

/** Returns true when the current drag carries a session payload. We can't
 *  call dataTransfer.getData() during dragover (browsers redact it for
 *  security), so we sniff the types list instead. */
function dragHasSession(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(SESSION_MIME);
}

export default function SessionSidebar({ onConnect, connectedSessionIds }: SessionSidebarProps) {
  const { sessions, folders, loadSessions, saveSession, saveFolder, deleteSession, deleteFolder, toggleFolder, moveSession } =
    useSessionStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  // Folder id currently highlighted as a drop target during a drag, or
  // 'root' for the bottom (no-folder) area.
  const [dropTarget, setDropTarget] = useState<string | 'root' | null>(null);

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

  const handleNewFolder = useCallback(() => {
    const folder: Folder = {
      id: uuid(),
      name: 'New Folder',
      sortOrder: folders.length,
      expanded: true,
    };
    saveFolder(folder);
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

  // ---- Drag and drop -----------------------------------------------------

  const handleSessionDragStart = useCallback(
    (e: React.DragEvent, sessionId: string) => {
      e.dataTransfer.setData(SESSION_MIME, sessionId);
      e.dataTransfer.effectAllowed = 'move';
    },
    []
  );

  const handleSessionDragEnd = useCallback(() => {
    setDropTarget(null);
  }, []);

  /** Move the dragged session to the supplied folder (or null = root).
   *  No-op if the session is already there. */
  const handleDropToTarget = useCallback(
    (e: React.DragEvent, folderId: string | null) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const sid = e.dataTransfer.getData(SESSION_MIME);
      if (!sid) return;
      const session = sessions.find((s) => s.id === sid);
      if (!session) return;
      const currentFolder = session.folderId ?? null;
      if (currentFolder === folderId) return;
      moveSession(sid, folderId);
    },
    [sessions, moveSession]
  );

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
        className={`${styles.list} ${dropTarget === 'root' ? styles.listDropTarget : ''}`}
        onDragOver={(e) => {
          if (!dragHasSession(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDropTarget('root');
        }}
        onDragLeave={(e) => {
          // Only clear if the pointer truly left the list (not into a child)
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropTarget((t) => (t === 'root' ? null : t));
          }
        }}
        onDrop={(e) => handleDropToTarget(e, null)}
      >
        {sortedFolders.map((folder) => {
          const folderSessions = getSessionsInFolder(folder.id);
          const isDropTarget = dropTarget === folder.id;
          return (
            <div
              key={folder.id}
              className={`${styles.folderGroup} ${isDropTarget ? styles.folderGroupDropTarget : ''}`}
              onDragOver={(e) => {
                if (!dragHasSession(e)) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                setDropTarget(folder.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setDropTarget((t) => (t === folder.id ? null : t));
                }
              }}
              onDrop={(e) => handleDropToTarget(e, folder.id)}
            >
              <div
                className={styles.folderHeader}
                onClick={() => toggleFolder(folder.id)}
                onDoubleClick={() => handleDoubleClickFolder(folder)}
              >
                <span className={styles.folderArrow}>
                  {folder.expanded ? '\u25BE' : '\u25B8'}
                </span>
                <span className={styles.folderName}>{folder.name}</span>
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
                    indented
                    onDoubleClick={() => handleDoubleClickSession(session)}
                    onEdit={() => handleEditSession(session)}
                    onDelete={() => deleteSession(session.id)}
                    onDragStart={handleSessionDragStart}
                    onDragEnd={handleSessionDragEnd}
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
            indented={false}
            onDoubleClick={() => handleDoubleClickSession(session)}
            onEdit={() => handleEditSession(session)}
            onDelete={() => deleteSession(session.id)}
            onDragStart={handleSessionDragStart}
            onDragEnd={handleSessionDragEnd}
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

function SessionItem({
  session,
  connected,
  indented,
  onDoubleClick,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
}: {
  session: Session;
  connected: boolean;
  indented: boolean;
  onDoubleClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent, sessionId: string) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      className={`${styles.sessionItem} ${indented ? styles.indented : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, session.id)}
      onDragEnd={onDragEnd}
      onDoubleClick={onDoubleClick}
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
        <button className={styles.smallBtn} onClick={onEdit} title="Edit">
          &#x270E;
        </button>
        <button className={styles.smallBtn} onClick={onDelete} title="Delete">
          &times;
        </button>
      </div>
    </div>
  );
}
