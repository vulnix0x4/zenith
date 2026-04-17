import { useRef, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { v4 as uuid } from 'uuid';
import type { Terminal } from '@xterm/xterm';
import { useTabStore, leavesOf, type LeafContent } from '../stores/tabStore';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * One-line shell snippet that wires up OSC 7 ("emit my CWD on every prompt").
 *
 * - Defines a small printf wrapper as `__z`.
 * - Hooks it into zsh via `precmd_functions`, falls back to bash via
 *   `PROMPT_COMMAND`, and is a no-op for shells that have neither (sh, dash,
 *   fish, csh, tcsh, etc.) -- those shells just see an unused function.
 * - Calls `__z` once immediately so the file browser picks up the *current*
 *   directory before the user runs anything.
 * - Leading space lets `HISTCONTROL=ignorespace` / `HIST_IGNORE_SPACE` skip
 *   the line in shell history if those are configured.
 */
const SHELL_INTEGRATION_SNIPPET =
  ` __z(){ printf '\\033]7;file://%s%s\\033\\\\' "$HOSTNAME" "$PWD"; };` +
  ` if [ -n "$ZSH_VERSION" ]; then precmd_functions+=(__z);` +
  ` elif [ -n "$BASH_VERSION" ]; then PROMPT_COMMAND="__z\${PROMPT_COMMAND:+;$PROMPT_COMMAND}";` +
  ` fi; __z 2>/dev/null\n`;

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

/** Walk every tab's pane tree and find the leaf with the given id. */
function findLeaf(leafId: string): LeafContent | null {
  for (const tab of useTabStore.getState().tabs) {
    for (const leaf of leavesOf(tab.pane)) {
      if (leaf.leafId === leafId) return leaf;
    }
  }
  return null;
}

export function useSshConnection() {
  // Each open xterm instance is keyed by its leafId so we can route incoming
  // SSH 'data' events to the right rendering surface even when a tab holds
  // multiple panes.
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());
  const setConnected = useTabStore((s) => s.setConnected);
  const setActivity = useTabStore((s) => s.setActivity);
  const storeConnectionParams = useTabStore((s) => s.storeConnectionParams);
  const setLeafSessionId = useTabStore((s) => s.setLeafSessionId);

  const registerTerminal = useCallback((leafId: string, terminal: Terminal) => {
    terminalsRef.current.set(leafId, terminal);
  }, []);

  const unregisterTerminal = useCallback((leafId: string) => {
    terminalsRef.current.delete(leafId);
  }, []);

  const connect = useCallback(
    async (leafId: string, params: SshConnectParams) => {
      // Resolve the destination terminal lazily on every event rather than
      // capturing it once -- the xterm instance can be replaced (e.g. when
      // a pane is re-parented during a split), and a captured reference
      // would write into a disposed terminal.
      const term = () => terminalsRef.current.get(leafId);

      // Persist params on the leaf so reconnect can replay them
      storeConnectionParams(leafId, {
        hostname: params.hostname,
        port: params.port,
        username: params.username,
        password: params.password,
      });

      const onEvent = new Channel<SshEvent>();
      onEvent.onmessage = (message: SshEvent) => {
        switch (message.event) {
          case 'connected':
            setConnected(leafId, true);
            // If the user has shell integration enabled, send the OSC 7 setup
            // snippet now. Read settings lazily here so toggling the pref
            // takes effect on the next connect without re-creating the
            // callback. Small delay lets the initial shell init / MOTD
            // finish before our line lands.
            {
              const inject = useSettingsStore.getState().settings.general
                .injectShellIntegration;
              if (inject) {
                setTimeout(() => {
                  invoke('ssh_write', {
                    sessionId: params.sessionId,
                    data: Array.from(new TextEncoder().encode(SHELL_INTEGRATION_SNIPPET)),
                  }).catch(() => {
                    // Write failed -- harmless, user can still cd manually
                  });
                }, 250);
              }
            }
            break;
          case 'data':
            {
              const t = term();
              if (t && message.data?.bytes) {
                t.write(new Uint8Array(message.data.bytes));
              }
            }
            // Pulse the tab if it isn't the active one. We don't try to
            // distinguish per-leaf activity in the tab bar; per-leaf focus
            // indicators inside the pane chrome handle that.
            {
              const state = useTabStore.getState();
              const owningTab = state.tabs.find((t) =>
                leavesOf(t.pane).some((l) => l.leafId === leafId)
              );
              if (owningTab && owningTab.id !== state.activeTabId) {
                setActivity(leafId, true);
              }
            }
            break;
          case 'error':
            {
              const t = term();
              if (t && message.data?.message) {
                t.write(`\r\n\x1b[31mError: ${message.data.message}\x1b[0m\r\n`);
              }
            }
            break;
          case 'disconnected':
            setConnected(leafId, false);
            {
              const t = term();
              if (t) {
                t.write('\r\n\x1b[33m\u26A1 Connection lost.\x1b[0m\r\n');
              }
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
        const t = term();
        if (t) {
          t.write(`\r\n\x1b[31mConnection failed: ${String(err)}\x1b[0m\r\n`);
        }
        setConnected(leafId, false);
      }
    },
    [setConnected, setActivity, storeConnectionParams]
  );

  const reconnect = useCallback(
    async (leafId: string) => {
      const leaf = findLeaf(leafId);
      if (!leaf || !leaf.connectionParams) return;

      const terminal = terminalsRef.current.get(leafId);
      if (terminal) {
        terminal.write('\r\n\x1b[36mReconnecting...\x1b[0m\r\n');
      }

      // Mint a fresh backend session id and pin it onto the leaf so future
      // write/resize/disconnect calls target the new SSH session.
      const newSessionId = uuid();
      setLeafSessionId(leafId, newSessionId);

      await connect(leafId, {
        sessionId: newSessionId,
        ...leaf.connectionParams,
      });
    },
    [connect, setLeafSessionId]
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
