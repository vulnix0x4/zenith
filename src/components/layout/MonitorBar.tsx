import { useRef, type ReactNode } from 'react';
import type { MonitorData } from '../../hooks/useMonitoring';
import styles from './MonitorBar.module.css';

const SPARK_HISTORY = 40;
const SPARK_WIDTH = 80;
const SPARK_HEIGHT = 16;

interface MetricProps {
  label: string;
  primary: string;
  detail?: string;
  percentage?: number;
  color: string;
  primaryMinWidth?: number;
  children?: ReactNode;
}

function Metric({
  label,
  primary,
  detail,
  percentage,
  color,
  primaryMinWidth,
  children,
}: MetricProps) {
  return (
    <div className={styles.metric}>
      <div className={styles.row1}>
        <span className={styles.label} style={{ color }}>
          {label}
        </span>
        <span
          className={styles.primary}
          style={primaryMinWidth ? { minWidth: `${primaryMinWidth}px` } : undefined}
        >
          {primary}
        </span>
      </div>
      <div className={styles.row2}>
        {children ?? (
          percentage !== undefined ? (
            <div className={styles.bar} aria-hidden>
              <div
                className={styles.barFill}
                style={{
                  width: `${Math.max(0, Math.min(100, percentage))}%`,
                  backgroundColor: color,
                }}
              />
            </div>
          ) : null
        )}
        {detail && <span className={styles.detail}>{detail}</span>}
      </div>
    </div>
  );
}

interface SparklineProps {
  values: number[];
  color: string;
}

function Sparkline({ values, color }: SparklineProps) {
  const w = SPARK_WIDTH;
  const h = SPARK_HEIGHT;

  if (values.length < 2) {
    return <div className={styles.sparkPlaceholder} style={{ width: w, height: h }} aria-hidden />;
  }

  const max = Math.max(...values, 1);
  const step = w / (SPARK_HISTORY - 1);
  // Right-align: shorter histories sit at the right edge and grow leftward.
  const offset = w - step * (values.length - 1);
  const points = values
    .map((v, i) => `${(offset + i * step).toFixed(1)},${(h - (v / max) * (h - 1) - 0.5).toFixed(1)}`)
    .join(' ');
  const areaPoints = `${offset.toFixed(1)},${h} ${points} ${w},${h}`;

  return (
    <svg className={styles.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polygon points={areaPoints} style={{ fill: color, opacity: 0.18 }} />
      <polyline
        points={points}
        fill="none"
        style={{ stroke: color, strokeWidth: 1.25 }}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface MonitorBarProps {
  data: MonitorData | null;
}

export default function MonitorBar({ data }: MonitorBarProps) {
  const downHistRef = useRef<number[]>([]);
  const upHistRef = useRef<number[]>([]);
  const lastDataRef = useRef<MonitorData | null>(null);

  // Append to history when a new MonitorData arrives. The reference-equality
  // guard makes this safe under React strict mode's double-invoke (the second
  // pass sees lastDataRef === data and skips).
  if (data && data !== lastDataRef.current) {
    downHistRef.current = [
      ...downHistRef.current,
      data.networkDownBytesPerSec,
    ].slice(-SPARK_HISTORY);
    upHistRef.current = [
      ...upHistRef.current,
      data.networkUpBytesPerSec,
    ].slice(-SPARK_HISTORY);
    lastDataRef.current = data;
  } else if (!data && lastDataRef.current) {
    downHistRef.current = [];
    upHistRef.current = [];
    lastDataRef.current = null;
  }

  if (!data) {
    return (
      <div className={styles.monitorBar}>
        <span className={styles.noConnection}>No active connection</span>
      </div>
    );
  }

  // One sparkline of total throughput tells the "is the network busy" story
  // at a glance; the directional rates are spelled out in the primary text.
  const totalHist = downHistRef.current.map(
    (d, i) => d + (upHistRef.current[i] ?? 0),
  );

  return (
    <div className={styles.monitorBar}>
      <Metric
        label="CPU"
        primary={`${Math.round(data.cpu)}%`}
        percentage={data.cpu}
        color="var(--cyan)"
      />
      <Metric
        label="RAM"
        primary={`${Math.round(data.ram)}%`}
        detail={`${data.ramUsed} / ${data.ramTotal}`}
        percentage={data.ram}
        color="var(--purple)"
      />
      <Metric
        label="NET"
        primary={`↓ ${data.networkDown}  ↑ ${data.networkUp}`}
        primaryMinWidth={170}
        color="var(--pink)"
      >
        <Sparkline values={totalHist} color="var(--pink)" />
      </Metric>
      <Metric
        label="DSK"
        primary={`${Math.round(data.disk)}%`}
        detail={`${data.diskUsed} / ${data.diskTotal}`}
        percentage={data.disk}
        color="var(--blue)"
      />
      <div className={styles.spacer} />
      <div className={styles.info}>
        <span>{data.uptime}</span>
      </div>
    </div>
  );
}
