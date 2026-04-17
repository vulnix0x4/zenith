import { useCallback, useEffect, useRef } from 'react';
import { useLayoutStore } from '../../stores/layoutStore';
import SessionSidebar from '../sessions/SessionSidebar';
import FileBrowser from '../files/FileBrowser';
import SettingsPanel from '../settings/SettingsPanel';
import type { Session } from '../../stores/sessionStore';
import styles from './Sidebar.module.css';

const panelLabels: Record<string, string> = {
  sessions: 'Sessions',
  files: 'Files',
  settings: 'Settings',
};

interface SidebarProps {
  onConnect?: (session: Session) => void;
  connectedSessionIds?: Set<string>;
  activeSessionId?: string | null;
  activeTabCwd?: string | null;
}

export default function Sidebar({ onConnect, connectedSessionIds, activeSessionId, activeTabCwd }: SidebarProps) {
  const { sidebarOpen, sidebarPanel, sidebarWidth, setSidebarWidth } = useLayoutStore();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  // Drag-to-resize: capture pointer on mousedown, track movement until mouseup.
  // The sidebar's left edge is anchored after the activity bar, so we measure
  // the new width from that left edge to the cursor.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!sidebarRef.current) return;
    draggingRef.current = true;
    const leftEdge = sidebarRef.current.getBoundingClientRect().left;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      setSidebarWidth(ev.clientX - leftEdge);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setSidebarWidth]);

  // Safety: if the component unmounts mid-drag, drop our listeners.
  useEffect(() => {
    return () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  return (
    <div
      ref={sidebarRef}
      className={`${styles.sidebar} ${!sidebarOpen ? styles.sidebarCollapsed : ''}`}
      style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
    >
      <div className={styles.header}>
        <span className={styles.headerLabel}>{panelLabels[sidebarPanel]}</span>
      </div>
      <div className={styles.content}>
        {sidebarPanel === 'sessions' && onConnect && connectedSessionIds ? (
          <SessionSidebar
            onConnect={onConnect}
            connectedSessionIds={connectedSessionIds}
          />
        ) : sidebarPanel === 'files' ? (
          <FileBrowser sessionId={activeSessionId ?? null} terminalCwd={activeTabCwd ?? null} />
        ) : sidebarPanel === 'settings' ? (
          <SettingsPanel />
        ) : null}
      </div>
      {sidebarOpen && (
        <div
          className={styles.resizer}
          onMouseDown={handleResizeStart}
          title="Drag to resize"
        />
      )}
    </div>
  );
}
