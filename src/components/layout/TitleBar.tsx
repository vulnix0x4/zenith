import styles from './TitleBar.module.css';

interface TitleBarProps {
  onSearchClick?: () => void;
}

export default function TitleBar({ onSearchClick }: TitleBarProps) {
  return (
    <div className={styles.titleBar}>
      <div className={styles.logo}>ZENITH</div>
      <div className={styles.searchBar} onClick={onSearchClick}>
        <span className={styles.searchPlaceholder}>Search sessions, commands...</span>
        <span className={styles.searchShortcut}>&#x2318;K</span>
      </div>
      <div className={styles.spacer} />
    </div>
  );
}
