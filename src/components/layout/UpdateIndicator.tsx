import { useUpdaterStore } from "../../stores/updaterStore";
import styles from "./UpdateIndicator.module.css";

interface Props {
  onOpenSettings?: () => void;
}

export default function UpdateIndicator({ onOpenSettings }: Props) {
  const status = useUpdaterStore((s) => s.status);

  if (status === "idle" || status === "checking" || status === "error") {
    return null;
  }

  if (status === "available") {
    return (
      <button
        className={styles.pillButton}
        onClick={onOpenSettings}
        title="A new version of Zenith is available"
      >
        <span className={styles.dot} aria-hidden="true" />
        Update available
      </button>
    );
  }

  if (status === "downloading") {
    return (
      <div className={styles.pill} aria-live="polite">
        Updating…
      </div>
    );
  }

  // ready (macOS / Linux)
  return (
    <button
      className={styles.pillReady}
      onClick={onOpenSettings}
      title="Restart Zenith to finish applying the update"
    >
      Restart to apply
    </button>
  );
}
