import styles from './MonitorBar.module.css';

interface MetricBarProps {
  label: string;
  percentage: number;
  color: string;
}

function MetricBar({ label, percentage, color }: MetricBarProps) {
  const total = 10;
  const filled = Math.round((percentage / 100) * total);

  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.blocks}>
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={i < filled ? styles.blockFilled : styles.blockEmpty}
            style={{ color }}
          >
            {'\u25AE'}
          </span>
        ))}
      </span>
      <span className={styles.metricValue}>{percentage}%</span>
    </div>
  );
}

interface MonitorData {
  cpu: number;
  ram: number;
  network: number;
  disk: number;
  hostname: string;
  uptime: string;
}

// Will be driven by real data later
const monitorData: MonitorData | null = null;

export default function MonitorBar() {
  if (!monitorData) {
    return (
      <div className={styles.monitorBar}>
        <span className={styles.noConnection}>No active connection</span>
      </div>
    );
  }

  return (
    <div className={styles.monitorBar}>
      <MetricBar label="CPU" percentage={monitorData.cpu} color="var(--cyan)" />
      <MetricBar label="RAM" percentage={monitorData.ram} color="var(--purple)" />
      <MetricBar label="NET" percentage={monitorData.network} color="var(--pink)" />
      <MetricBar label="DSK" percentage={monitorData.disk} color="var(--blue)" />
      <div className={styles.spacer} />
      <div className={styles.info}>
        <span>{monitorData.hostname}</span>
        <span>{monitorData.uptime}</span>
      </div>
    </div>
  );
}
