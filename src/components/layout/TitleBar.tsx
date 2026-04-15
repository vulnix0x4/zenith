import styles from './TitleBar.module.css';

export default function TitleBar() {
  return (
    <div className={styles.titleBar}>
      <div className={styles.logo}>ZENITH</div>
      <div className={styles.searchBar}>
        <span className={styles.searchPlaceholder}>Search sessions, commands...</span>
        <span className={styles.searchShortcut}>&#x2318;K</span>
      </div>
      <div className={styles.spacer} />
    </div>
  );
}
