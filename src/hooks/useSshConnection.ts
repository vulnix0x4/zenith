import { useRef, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
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

  const registerTerminal = useCallback((tabId: string, terminal: Terminal) => {
    terminalsRef.current.set(tabId, terminal);
  }, []);

  const unregisterTerminal = useCallback((tabId: string) => {
    terminalsRef.current.delete(tabId);
  }, []);

  const connect = useCallback(
    async (tabId: string, params: SshConnectParams) => {
      const terminal = terminalsRef.current.get(tabId);

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
            break;
          case 'error':
            if (terminal && message.data?.message) {
              terminal.write(`\r\n\x1b[31mError: ${message.data.message}\x1b[0m\r\n`);
            }
            break;
          case 'disconnected':
            setConnected(tabId, false);
            if (terminal) {
              terminal.write('\r\n\x1b[33mDisconnected.\x1b[0m\r\n');
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
    [setConnected]
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
    write,
    resize,
    disconnect,
    registerTerminal,
    unregisterTerminal,
  };
}
