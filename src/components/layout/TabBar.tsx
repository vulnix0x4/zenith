import { useTabStore } from '../../stores/tabStore';
import { useSplitStore } from '../../stores/splitStore';
import styles from './TabBar.module.css';

interface TabBarProps {
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onSearchClick?: () => void;
}

export default function TabBar({ onNewTab, onCloseTab, onSearchClick }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab } = useTabStore();
  const cycleLayout = useSplitStore((s) => s.cycleLayout);

  const handleSplitClick = () => {
    if (activeTabId) {
      cycleLayout(activeTabId);
    }
  };

  return (
    <div className={styles.tabBar}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`${styles.tab} ${tab.id === activeTabId ? styles.tabActive : ''} ${
            tab.hasActivity && tab.id !== activeTabId ? styles.hasActivity : ''
          }`}
          onClick={() => setActiveTab(tab.id)}
        >
          <span
            className={`${styles.statusDot} ${
              tab.connected ? styles.statusConnected : styles.statusDisconnected
            }`}
          />
          <span>{tab.title}</span>
          <span
            className={styles.tabClose}
            onClick={(e) => {
              e.stopPropagation();
              onCloseTab(tab.id);
            }}
          >
            &times;
          </span>
        </button>
      ))}
      <div className={styles.actions}>
        <button className={styles.actionButton} title="Search (Ctrl+K)" onClick={onSearchClick}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button className={styles.actionButton} title="New Tab" onClick={onNewTab}>
          +
        </button>
        <button
          className={styles.actionButton}
          title="Split View"
          onClick={handleSplitClick}
        >
          {'\u2AFC'}
        </button>
      </div>
    </div>
  );
}
