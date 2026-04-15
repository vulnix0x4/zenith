import { useRef, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { v4 as uuid } from 'uuid';
import type { Terminal } from '@xterm/xterm';
import { useTabStore } from '../stores/tabStore';

interface SshConnectParams {
  sessionId: string;
  hostname: string;
  port: number;
  username: string;
  password: string;
}

interface SshEvent {
  event: 'connected' | 'data' | 'error' | 'disconnected';
  data?: { bytes?: number[]; message?: string };
}

export function useSshConnection() {
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());
  const setConnected = useTabStore((s) => s.setConnected);
  const setActivity = useTabStore((s) => s.setActivity);
  const storeConnectionParams = useTabStore((s) => s.storeConnectionParams);

  const registerTerminal = useCallback((tabId: string, terminal: Terminal) => {
    terminalsRef.current.set(tabId, terminal);
  }, []);

  const unregisterTerminal = useCallback((tabId: string) => {
    terminalsRef.current.delete(tabId);
  }, []);

  const connect = useCallback(
    async (tabId: string, params: SshConnectParams) => {
      const terminal = terminalsRef.current.get(tabId);

      // Store connection params for reconnection
      storeConnectionParams(tabId, {
        hostname: params.hostname,
        port: params.port,
        username: params.username,
        password: params.password,
      });

      const onEvent = new Channel<SshEvent>();
      onEvent.onmessage = (message: SshEvent) => {
        switch (message.event) {
          case 'connected':
            setConnected(tabId, true);
            break;
          case 'data':
            if (terminal && message.data?.bytes) {
              terminal.write(new Uint8Array(message.data.bytes));
            }
            // Notify activity on background tabs
            {
              const activeTabId = useTabStore.getState().activeTabId;
              if (tabId !== activeTabId) {
                setActivity(tabId, true);
              }
            }
            break;
          case 'error':
            if (terminal && message.data?.message) {
              terminal.write(`\r\n\x1b[31mError: ${message.data.message}\x1b[0m\r\n`);
            }
            break;
          case 'disconnected':
            setConnected(tabId, false);
            if (terminal) {
              terminal.write(
                '\r\n\x1b[33m\u26A1 Connection lost.\x1b[0m\r\n'
              );
            }
            break;
        }
      };

      try {
        await invoke('ssh_connect', {
          request: {
            sessionId: params.sessionId,
            hostname: params.hostname,
            port: params.port,
            username: params.username,
            authMethod: { type: 'password', password: params.password },
          },
          onEvent,
        });
      } catch (err) {
        if (terminal) {
          terminal.write(
            `\r\n\x1b[31mConnection failed: ${String(err)}\x1b[0m\r\n`
          );
        }
        setConnected(tabId, false);
      }
    },
    [setConnected, setActivity, storeConnectionParams]
  );

  const reconnect = useCallback(
    async (tabId: string) => {
      const tab = useTabStore.getState().tabs.find((t) => t.id === tabId);
      if (!tab || !tab.connectionParams) return;

      const terminal = terminalsRef.current.get(tabId);
      if (terminal) {
        terminal.write('\r\n\x1b[36mReconnecting...\x1b[0m\r\n');
      }

      // Generate a new sessionId for the reconnection
      const newSessionId = uuid();

      // Update the tab's sessionId in the store
      useTabStore.setState((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, sessionId: newSessionId, disconnectedAt: null } : t
        ),
      }));

      await connect(tabId, {
        sessionId: newSessionId,
        ...tab.connectionParams,
      });
    },
    [connect]
  );

  const write = useCallback(async (sessionId: string, data: string) => {
    const encoded = new TextEncoder().encode(data);
    try {
      await invoke('ssh_write', {
        sessionId,
        data: Array.from(encoded),
      });
    } catch {
      // Write failed silently
    }
  }, []);

  const resize = useCallback(async (sessionId: string, cols: number, rows: number) => {
    try {
      await invoke('ssh_resize', { sessionId, cols, rows });
    } catch {
      // Resize failed silently
    }
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    try {
      await invoke('ssh_disconnect', { sessionId });
    } catch {
      // Disconnect failed silently
    }
  }, []);

  return {
    connect,
    reconnect,
    write,
    resize,
    disconnect,
    registerTerminal,
    unregisterTerminal,
  };
}
