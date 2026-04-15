import { useLayoutStore } from '../../stores/layoutStore';
import styles from './Sidebar.module.css';

const panelLabels: Record<string, string> = {
  sessions: 'Sessions',
  files: 'Files',
  monitoring: 'Monitoring',
  settings: 'Settings',
};

export default function Sidebar() {
  const { sidebarOpen, sidebarPanel } = useLayoutStore();

  return (
    <div className={`${styles.sidebar} ${!sidebarOpen ? styles.sidebarCollapsed : ''}`}>
      <div className={styles.header}>
        <span className={styles.headerLabel}>{panelLabels[sidebarPanel]}</span>
      </div>
      <div className={styles.content}>
        <div className={styles.placeholder}>
          {sidebarPanel === 'sessions' && 'No saved sessions'}
          {sidebarPanel === 'files' && 'No files open'}
          {sidebarPanel === 'monitoring' && 'No active monitors'}
          {sidebarPanel === 'settings' && 'Settings panel'}
        </div>
      </div>
    </div>
  );
}
