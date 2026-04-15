import { useEffect, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';

export interface MonitorData {
  cpu: number;
  ram: number;
  ramUsed: string;
  ramTotal: string;
  networkUp: string;
  networkDown: string;
  disk: number;
  diskUsed: string;
  diskTotal: string;
  uptime: string;
  hostname: string;
}

/**
 * Hook that starts/stops system monitoring for the active SSH session.
 * Returns live MonitorData streamed from the Rust backend, or null
 * when no session is active.
 */
export function useMonitoring(sessionId: string | null): MonitorData | null {
  const [data, setData] = useState<MonitorData | null>(null);
  const activeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      // No active session -- stop any existing monitoring and clear data
      if (activeRef.current) {
        invoke('stop_monitoring', { sessionId: activeRef.current }).catch(() => {});
        activeRef.current = null;
      }
      setData(null);
      return;
    }

    // Already monitoring this session
    if (activeRef.current === sessionId) return;

    // Stop monitoring the previous session
    if (activeRef.current) {
      invoke('stop_monitoring', { sessionId: activeRef.current }).catch(() => {});
    }

    activeRef.current = sessionId;

    const onEvent = new Channel<MonitorData>();
    onEvent.onmessage = (msg: MonitorData) => {
      setData(msg);
    };

    invoke('start_monitoring', { sessionId, onEvent }).catch((err) => {
      console.error('Failed to start monitoring:', err);
    });

    return () => {
      if (activeRef.current === sessionId) {
        invoke('stop_monitoring', { sessionId }).catch(() => {});
        activeRef.current = null;
      }
    };
  }, [sessionId]);

  return data;
}
