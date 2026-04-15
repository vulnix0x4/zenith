import { useLayoutStore } from '../../stores/layoutStore';
import SessionSidebar from '../sessions/SessionSidebar';
import FileBrowser from '../files/FileBrowser';
import SettingsPanel from '../settings/SettingsPanel';
import type { Session } from '../../stores/sessionStore';
import styles from './Sidebar.module.css';

const panelLabels: Record<string, string> = {
  sessions: 'Sessions',
  files: 'Files',
  monitoring: 'Monitoring',
  settings: 'Settings',
};

interface SidebarProps {
  onConnect?: (session: Session) => void;
  connectedSessionIds?: Set<string>;
  activeSessionId?: string | null;
}

export default function Sidebar({ onConnect, connectedSessionIds, activeSessionId }: SidebarProps) {
  const { sidebarOpen, sidebarPanel } = useLayoutStore();

  return (
    <div className={`${styles.sidebar} ${!sidebarOpen ? styles.sidebarCollapsed : ''}`}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>{panelLabels[sidebarPanel]}</span>
      </div>
      <div className={styles.content}>
        {sidebarPanel === 'sessions' && onConnect && connectedSessionIds ? (
          <SessionSidebar
            onConnect={onConnect}
            connectedSessionIds={connectedSessionIds}
          />
        ) : sidebarPanel === 'files' ? (
          <FileBrowser sessionId={activeSessionId ?? null} />
        ) : sidebarPanel === 'settings' ? (
          <SettingsPanel />
        ) : (
          <div className={styles.placeholder}>
            {sidebarPanel === 'monitoring' && 'No active monitors'}
          </div>
        )}
      </div>
    </div>
  );
}
