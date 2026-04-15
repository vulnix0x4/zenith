import { useEffect, useState, useCallback } from 'react';
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

  const rootSessions = sessions
    .filter((s) => !s.folderId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const getSessionsInFolder = (folderId: string) =>
    sessions.filter((s) => s.folderId === folderId).sort((a, b) => a.sortOrder - b.sortOrder);

  const sortedFolders = [...folders].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {sortedFolders.map((folder) => {
          const folderSessions = getSessionsInFolder(folder.id);
          return (
            <div key={folder.id} className={styles.folderGroup}>
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

      <div className={styles.bottomActions}>
        <button className={styles.actionBtn} onClick={handleNewSession}>
          + New Session
        </button>
        <button className={styles.actionBtn} onClick={handleNewFolder}>
          + New Folder
        </button>
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
