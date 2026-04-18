import { openUrl } from '@tauri-apps/plugin-opener';
import { useUpdaterStore } from '../../stores/updaterStore';
import settingsStyles from './SettingsPanel.module.css';
import styles from './UpdatesSection.module.css';

export default function UpdatesSection() {
  const {
    status,
    currentVersion,
    latestVersion,
    releaseNotes,
    releaseUrl,
    error,
    checkForUpdate,
    downloadAndInstall,
    dismissError,
  } = useUpdaterStore();

  const busy = status === 'checking' || status === 'downloading';

  return (
    <div className={settingsStyles.section} id="updates-section">
      <div className={settingsStyles.sectionTitle}>Updates</div>

      <div className={settingsStyles.row}>
        <span className={settingsStyles.label}>Current version</span>
        <span className={styles.value}>v{currentVersion}</span>
      </div>

      {status === 'available' && latestVersion && (
        <div className={settingsStyles.row}>
          <span className={settingsStyles.label}>Latest version</span>
          <span className={styles.value}>{latestVersion}</span>
        </div>
      )}

      {releaseNotes && (status === 'available' || status === 'ready') && (
        <div className={styles.notes}>
          <div className={styles.notesTitle}>Release notes</div>
          <pre className={styles.notesBody}>{releaseNotes}</pre>
        </div>
      )}

      {status === 'downloading' && (
        <div className={styles.row}>Downloading…</div>
      )}

      {status === 'error' && error && (
        <div className={styles.errorBox}>
          <div>{error}</div>
          <button className={styles.btn} onClick={dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <div className={styles.actionRow}>
        <button
          className={styles.btn}
          onClick={() => checkForUpdate({ silent: false })}
          disabled={busy}
        >
          {status === 'checking' ? 'Checking…' : 'Check for updates'}
        </button>

        {status === 'available' && (
          <button
            className={styles.btnPrimary}
            onClick={downloadAndInstall}
            disabled={busy}
          >
            Download &amp; install
          </button>
        )}

        {releaseUrl && (
          <button
            className={styles.btnLink}
            onClick={() => {
              void openUrl(releaseUrl);
            }}
          >
            View on GitHub
          </button>
        )}
      </div>
    </div>
  );
}
