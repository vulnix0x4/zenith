import TitleBar from './TitleBar';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import MonitorBar from './MonitorBar';
import styles from './AppLayout.module.css';

export default function AppLayout() {
  return (
    <div className={styles.layout}>
      <TitleBar />
      <div className={styles.body}>
        <ActivityBar />
        <Sidebar />
        <div className={styles.mainArea}>
          <TabBar />
          <div className={styles.terminalArea}>
            <div className={styles.placeholder}>
              <div className={styles.placeholderLogo}>ZENITH</div>
              <div className={styles.placeholderHint}>
                Double-click a session or press + to connect
              </div>
            </div>
          </div>
          <MonitorBar />
        </div>
      </div>
    </div>
  );
}
