import type { MonitorData } from '../../hooks/useMonitoring';
import styles from './MonitorBar.module.css';

interface MetricBarProps {
  label: string;
  percentage: number;
  detail?: string;
  color: string;
}

function MetricBar({ label, percentage, detail, color }: MetricBarProps) {
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
      <span className={styles.metricValue}>
        {detail ?? `${Math.round(percentage)}%`}
      </span>
    </div>
  );
}

interface MonitorBarProps {
  data: MonitorData | null;
}

export default function MonitorBar({ data }: MonitorBarProps) {
  if (!data) {
    return (
      <div className={styles.monitorBar}>
        <span className={styles.noConnection}>No active connection</span>
      </div>
    );
  }

  return (
    <div className={styles.monitorBar}>
      <MetricBar
        label="CPU"
        percentage={data.cpu}
        color="var(--cyan)"
      />
      <MetricBar
        label="RAM"
        percentage={data.ram}
        detail={`${data.ramUsed}/${data.ramTotal}`}
        color="var(--purple)"
      />
      <MetricBar
        label="NET"
        percentage={0}
        detail={`${data.networkDown} \u2193 ${data.networkUp} \u2191`}
        color="var(--pink)"
      />
      <MetricBar
        label="DSK"
        percentage={data.disk}
        detail={`${data.diskUsed}/${data.diskTotal}`}
        color="var(--blue)"
      />
      <div className={styles.spacer} />
      <div className={styles.info}>
        <span>{data.hostname}</span>
        <span>{data.uptime}</span>
      </div>
    </div>
  );
}
