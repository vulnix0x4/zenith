import type { MutableRefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import XTerminal from './XTerminal';
import { useSplitStore } from '../../stores/splitStore';
import styles from './SplitTerminal.module.css';

interface SplitTerminalProps {
  tabId: string;
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  terminalRef: MutableRefObject<Terminal | null>;
}

function paneCount(layout: string): number {
  switch (layout) {
    case 'horizontal-2':
    case 'vertical-2':
      return 2;
    case 'quad':
      return 4;
    default:
      return 1;
  }
}

function layoutClass(layout: string): string {
  switch (layout) {
    case 'horizontal-2':
      return styles.layoutHorizontal2;
    case 'vertical-2':
      return styles.layoutVertical2;
    case 'quad':
      return styles.layoutQuad;
    default:
      return styles.layoutSingle;
  }
}

function PlaceholderPane() {
  return (
    <div className={styles.placeholder}>
      <div className={styles.placeholderInner}>
        <span className={styles.placeholderIcon}>{'\u229A'}</span>
        <span className={styles.placeholderText}>Open a session in this pane</span>
      </div>
    </div>
  );
}

export default function SplitTerminal({
  tabId,
  onData,
  onResize,
  terminalRef,
}: SplitTerminalProps) {
  const layout = useSplitStore((s) => s.getLayout(tabId));
  const count = paneCount(layout);

  return (
    <div className={`${styles.splitContainer} ${layoutClass(layout)}`}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.pane}>
          {i === 0 ? (
            <XTerminal
              onData={onData}
              onResize={onResize}
              terminalRef={terminalRef}
            />
          ) : (
            <PlaceholderPane />
          )}
        </div>
      ))}
    </div>
  );
}
