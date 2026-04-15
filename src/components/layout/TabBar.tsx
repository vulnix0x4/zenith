import styles from './TabBar.module.css';

interface Tab {
  id: string;
  title: string;
  connected: boolean;
  active: boolean;
}

// Placeholder tabs - will be driven by session store later
const tabs: Tab[] = [];

export default function TabBar() {
  return (
    <div className={styles.tabBar}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`${styles.tab} ${tab.active ? styles.tabActive : ''}`}
        >
          <span
            className={`${styles.statusDot} ${
              tab.connected ? styles.statusConnected : styles.statusDisconnected
            }`}
          />
          <span>{tab.title}</span>
          <span className={styles.tabClose}>&times;</span>
        </button>
      ))}
      <div className={styles.actions}>
        <button className={styles.actionButton} title="New Tab">+</button>
        <button className={styles.actionButton} title="Split View">{'\u2AFC'}</button>
      </div>
    </div>
  );
}
