import { useTabStore } from '../../stores/tabStore';
import styles from './TabBar.module.css';

interface TabBarProps {
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
}

export default function TabBar({ onNewTab, onCloseTab }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab } = useTabStore();

  return (
    <div className={styles.tabBar}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`${styles.tab} ${tab.id === activeTabId ? styles.tabActive : ''}`}
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
        <button className={styles.actionButton} title="New Tab" onClick={onNewTab}>
          +
        </button>
        <button className={styles.actionButton} title="Split View">
          {'\u2AFC'}
        </button>
      </div>
    </div>
  );
}
