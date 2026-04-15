import { useLayoutStore, type SidebarPanel } from '../../stores/layoutStore';
import styles from './ActivityBar.module.css';

const topItems: { panel: SidebarPanel; icon: string; label: string }[] = [
  { panel: 'sessions', icon: '\u2302', label: 'Sessions' },
  { panel: 'files', icon: '\uD83D\uDCC1', label: 'Files' },
  { panel: 'monitoring', icon: '\uD83D\uDCCA', label: 'Monitoring' },
];

const bottomItems: { panel: SidebarPanel; icon: string; label: string }[] = [
  { panel: 'settings', icon: '\u2699', label: 'Settings' },
];

export default function ActivityBar() {
  const { sidebarPanel, sidebarOpen, setSidebarPanel } = useLayoutStore();

  const renderButton = (item: { panel: SidebarPanel; icon: string; label: string }) => {
    const isActive = sidebarOpen && sidebarPanel === item.panel;
    return (
      <button
        key={item.panel}
        className={`${styles.iconButton} ${isActive ? styles.iconButtonActive : ''}`}
        onClick={() => setSidebarPanel(item.panel)}
        title={item.label}
      >
        {item.icon}
      </button>
    );
  };

  return (
    <div className={styles.activityBar}>
      <div className={styles.topIcons}>
        {topItems.map(renderButton)}
      </div>
      <div className={styles.bottomIcons}>
        {bottomItems.map(renderButton)}
      </div>
    </div>
  );
}
