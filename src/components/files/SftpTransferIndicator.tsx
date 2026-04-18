import { useSftpStore, type SftpTransfer } from '../../stores/sftpStore';
import styles from './FileBrowser.module.css';

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return ` ${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function verbFor(t: SftpTransfer): string {
  const action = t.direction === 'up' ? 'Uploading' : 'Downloading';
  if (t.state === 'done') return t.direction === 'up' ? 'Uploaded' : 'Downloaded';
  if (t.state === 'error') return t.direction === 'up' ? 'Upload failed' : 'Download failed';
  return `${action}\u2026`; // ellipsis
}

/** Thin status bar showing active / recently-finished SFTP transfers.
 *
 *  We intentionally don't render a progress bar with percent -- russh-sftp's
 *  high-level `read`/`write` don't surface byte counters, and the ergonomics
 *  of a "something is happening" indicator are good enough for the common
 *  case (small-to-medium files). If a transfer errors, the error message
 *  lingers for a few seconds via the store's auto-prune timer. */
export function SftpTransferIndicator() {
  const transfers = useSftpStore((s) => s.transfers);
  if (transfers.length === 0) return null;

  return (
    <div className={styles.transferList} role="status" aria-live="polite">
      {transfers.map((t) => (
        <div
          key={t.id}
          className={`${styles.transferRow} ${
            t.state === 'error'
              ? styles.transferError
              : t.state === 'done'
                ? styles.transferDone
                : styles.transferActive
          }`}
          title={t.error ?? undefined}
        >
          <span className={styles.transferVerb}>{verbFor(t)}</span>
          <span className={styles.transferName}>{t.filename}</span>
          {t.state === 'active' && t.size !== undefined && (
            <span className={styles.transferSize}>{formatBytes(t.size)}</span>
          )}
        </div>
      ))}
    </div>
  );
}
