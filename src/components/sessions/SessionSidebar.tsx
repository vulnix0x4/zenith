import { useEffect, useState, useCallback, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import { useSessionStore, type Session, type Folder } from '../../stores/sessionStore';
import SessionDialog from './SessionDialog';
import styles from './SessionSidebar.module.css';

interface SessionSidebarProps {
  onConnect: (session: Session) => void;
  connectedSessionIds: Set<string>;
}

export default function SessionSidebar({ onConnect, connectedSessionIds }: SessionSidebarProps) {
  const { sessions, folders, loadSessions, saveSession, saveFolder, deleteSession, deleteFolder, toggleFolder } =
    useSessionStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);

  // Inline-rename state for folders. When set, that folder's header renders
  // an <input> instead of a <span>. Committing or escaping clears it.
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);

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
      <div className={styles.list}>
        {sortedFolders.map((folder) => {
          const folderSessions = getSessionsInFolder(folder.id);
          const isEditing = editingFolderId === folder.id;
          return (
            <div key={folder.id} className={styles.folderGroup}>
              <div
                className={styles.folderHeader}
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
                    indented
                    onDoubleClick={() => handleDoubleClickSession(session)}
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
            indented={false}
            onDoubleClick={() => handleDoubleClickSession(session)}
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
  indented,
  onDoubleClick,
  onEdit,
  onDelete,
}: {
  session: Session;
  connected: boolean;
  indented: boolean;
  onDoubleClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`${styles.sessionItem} ${indented ? styles.indented : ''}`}
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
