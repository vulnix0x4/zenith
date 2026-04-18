import { useRef, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import { confirm } from '@tauri-apps/plugin-dialog';
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

/** Maximum number of consecutive auto-reconnect attempts before we give up
 *  and leave the tab in `failed` state. Chosen empirically: at 20 attempts
 *  with a 5-second base delay the backoff ceiling is reached well before
 *  the limit, so the user sees a useful handful of retries (roughly 1 hour
 *  of total wall clock) before the UI stops cycling. */
const MAX_RECONNECT_ATTEMPTS = 20;

/** Hard ceiling on the per-attempt wait (seconds). Prevents the exponential
 *  backoff from ballooning into "give up after a day" territory. */
const MAX_BACKOFF_SECONDS = 300;

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

/**
 * Structured error payload produced by the Rust `ssh_connect` command.
 * The `kind` discriminator is shared with the Rust `SshConnectError` enum
 * (see `src-tauri/src/ssh/types.rs`). The frontend recognises
 * `hostKeyMismatch` and prompts the user to accept a rotated key; any
 * other shape is treated as a generic failure.
 */
interface HostKeyMismatchPayload {
  kind: 'hostKeyMismatch';
  hostname: string;
  port: number;
  expectedFingerprint: string;
  actualFingerprint: string;
}

/**
 * Best-effort JSON decode of a Tauri command error. The `invoke` call rejects
 * with a string, which is our serialized `SshConnectError`. Any non-JSON
 * payload (or a payload with an unknown `kind`) returns null so callers can
 * fall back to the generic display path.
 */
function parseHostKeyMismatch(err: unknown): HostKeyMismatchPayload | null {
  if (typeof err !== 'string') return null;
  try {
    const parsed = JSON.parse(err) as { kind?: string } & Record<string, unknown>;
    if (parsed.kind !== 'hostKeyMismatch') return null;
    if (
      typeof parsed.hostname === 'string' &&
      typeof parsed.port === 'number' &&
      typeof parsed.expectedFingerprint === 'string' &&
      typeof parsed.actualFingerprint === 'string'
    ) {
      return {
        kind: 'hostKeyMismatch',
        hostname: parsed.hostname,
        port: parsed.port,
        expectedFingerprint: parsed.expectedFingerprint,
        actualFingerprint: parsed.actualFingerprint,
      };
    }
    return null;
  } catch {
    return null;
  }
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

/** Compute the backoff in seconds for the N-th retry attempt (1-indexed).
 *  `baseDelay * 2^(attempt - 1)` with a cap at `MAX_BACKOFF_SECONDS`. */
function backoffSeconds(attempt: number, baseDelay: number): number {
  const raw = baseDelay * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, MAX_BACKOFF_SECONDS);
}

/** Promise-returning sleep. Passed an AbortSignal so in-flight waits can be
 *  cancelled when the user manually reconnects or closes the tab. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function useSshConnection() {
  // Each open xterm instance is keyed by its leafId so we can route incoming
  // SSH 'data' events to the right rendering surface even when a tab holds
  // multiple panes.
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());

  /**
   * Per-leaf abort controller for any in-flight auto-reconnect loop.
   * Stored by leafId. We fire `.abort()` when:
   *   - the user manually reconnects (counter resets, new loop takes over),
   *   - the leaf is disconnected / the tab is closed.
   */
  const reconnectAbortsRef = useRef<Map<string, AbortController>>(new Map());

  const setConnected = useTabStore((s) => s.setConnected);
  const setConnectionState = useTabStore((s) => s.setConnectionState);
  const setActivity = useTabStore((s) => s.setActivity);
  const storeConnectionParams = useTabStore((s) => s.storeConnectionParams);
  const setLeafSessionId = useTabStore((s) => s.setLeafSessionId);

  const registerTerminal = useCallback((leafId: string, terminal: Terminal) => {
    terminalsRef.current.set(leafId, terminal);
  }, []);

  const unregisterTerminal = useCallback((leafId: string) => {
    terminalsRef.current.delete(leafId);
    // If a reconnect loop is still running for this leaf, cancel it.
    const ac = reconnectAbortsRef.current.get(leafId);
    if (ac) {
      ac.abort();
      reconnectAbortsRef.current.delete(leafId);
    }
  }, []);

  const cancelReconnectLoop = useCallback((leafId: string) => {
    const ac = reconnectAbortsRef.current.get(leafId);
    if (ac) {
      ac.abort();
      reconnectAbortsRef.current.delete(leafId);
    }
  }, []);

  /**
   * Drive the `ssh_connect` invoke. Handles the host-key mismatch flow:
   * on receiving a structured mismatch error the user is prompted to
   * accept the new fingerprint; if they agree, the stored key is forgotten
   * via `forget_host_key` and the connect is retried exactly once. Any
   * other failure propagates up so the caller can decide whether to enter
   * the auto-reconnect loop.
   *
   * Returns true when the connect succeeded, false otherwise.
   */
  const attemptConnect = useCallback(
    async (
      leafId: string,
      params: SshConnectParams,
      onEvent: Channel<SshEvent>
    ): Promise<boolean> => {
      const term = () => terminalsRef.current.get(leafId);
      const keepaliveSeconds = useSettingsStore.getState().settings.general
        .sshKeepaliveSeconds;

      const request = {
        sessionId: params.sessionId,
        hostname: params.hostname,
        port: params.port,
        username: params.username,
        authMethod: { type: 'password', password: params.password },
        keepaliveSeconds,
      };

      try {
        await invoke('ssh_connect', { request, onEvent });
        return true;
      } catch (err) {
        const mismatch = parseHostKeyMismatch(err);
        if (mismatch) {
          const approved = await confirm(
            `The SSH host key for ${mismatch.hostname}:${mismatch.port} has CHANGED since your last connection.\n\n` +
              `Expected: ${mismatch.expectedFingerprint}\n` +
              `Received: ${mismatch.actualFingerprint}\n\n` +
              `This could indicate a man-in-the-middle attack, OR the server was legitimately reinstalled.\n\n` +
              `Trust the new key and connect anyway?`,
            { title: 'SSH host key changed', kind: 'warning' }
          );
          if (approved) {
            try {
              await invoke('forget_host_key', {
                hostname: mismatch.hostname,
                port: mismatch.port,
              });
              await invoke('ssh_connect', { request, onEvent });
              return true;
            } catch (retryErr) {
              const t = term();
              if (t) {
                t.write(
                  `\r\n\x1b[31mConnection failed after accepting new key: ${String(
                    retryErr
                  )}\x1b[0m\r\n`
                );
              }
              return false;
            }
          } else {
            // User declined -- do NOT forget the key, and surface the
            // warning in the terminal so the rejection is visible.
            const t = term();
            if (t) {
              t.write(
                `\r\n\x1b[31mHost key mismatch. Connection refused to protect against MITM.\x1b[0m\r\n`
              );
            }
            return false;
          }
        }

        // Non-mismatch failure. Extract a human-readable message from either
        // the structured `Other` payload or the raw string we were handed.
        let message = String(err);
        if (typeof err === 'string') {
          try {
            const parsed = JSON.parse(err) as { message?: string };
            if (parsed?.message) message = parsed.message;
          } catch {
            // Not JSON -- keep the raw string.
          }
        }
        const t = term();
        if (t) {
          t.write(`\r\n\x1b[31mConnection failed: ${message}\x1b[0m\r\n`);
        }
        return false;
      }
    },
    []
  );

  /**
   * Core connect flow shared by `connect` and `runAutoReconnect`. The
   * `resetReconnectLoop` flag controls whether the existing auto-reconnect
   * loop (if any) should be aborted:
   *   - `true`  -- user-initiated connect: cancel any running loop so we
   *                don't race with it.
   *   - `false` -- called BY the reconnect loop itself: leave its controller
   *                in place so a spurious disconnect event doesn't spawn a
   *                second loop.
   */
  const connectCore = useCallback(
    async (
      leafId: string,
      params: SshConnectParams,
      resetReconnectLoop: boolean
    ) => {
      // Resolve the destination terminal lazily on every event rather than
      // capturing it once -- the xterm instance can be replaced (e.g. when
      // a pane is re-parented during a split), and a captured reference
      // would write into a disposed terminal.
      const term = () => terminalsRef.current.get(leafId);

      if (resetReconnectLoop) {
        cancelReconnectLoop(leafId);
      }

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
            setConnectionState(leafId, 'connected');
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
            // Flip state to 'disconnected' for now. If auto-reconnect is
            // enabled the subsequent call to runAutoReconnect will promote
            // it to 'reconnecting'.
            setConnectionState(leafId, 'disconnected');
            {
              const t = term();
              if (t) {
                t.write('\r\n\x1b[33m\u26A1 Connection lost.\x1b[0m\r\n');
              }
            }
            // Fire-and-forget auto-reconnect. It reads the latest settings
            // inside so toggling autoReconnect between events is honoured.
            runAutoReconnect(leafId).catch(() => {
              // AbortError or similar -- loop handles its own logging.
            });
            break;
        }
      };

      const ok = await attemptConnect(leafId, params, onEvent);
      if (!ok) {
        // A failure here is NOT necessarily terminal -- the auto-reconnect
        // loop (if running) may take another swing. Leave the tab in
        // 'disconnected' rather than 'failed' so the distinctive "gave up"
        // UI only appears when the loop actually exhausts its budget.
        setConnectionState(leafId, 'disconnected');
      }
    },
    [
      setConnectionState,
      setActivity,
      storeConnectionParams,
      attemptConnect,
      cancelReconnectLoop,
    ]
  );

  /** Public connect. Always user-initiated -- resets any running auto-reconnect loop. */
  const connect = useCallback(
    (leafId: string, params: SshConnectParams) => connectCore(leafId, params, true),
    [connectCore]
  );

  /**
   * Auto-reconnect loop with exponential backoff. Runs only if the user has
   * `general.autoReconnect` enabled. Otherwise the tab stays in `disconnected`
   * and the user has to click to retry.
   *
   * The loop minted a fresh backend session id per attempt so stale sessions
   * are cleaned up server-side, then invokes `connect()` which itself sets
   * state to `connected` on success via the `connected` event. If an attempt
   * fails, we wait `backoffSeconds(i, baseDelay)` seconds and try again. The
   * AbortController stored in `reconnectAbortsRef` lets the caller interrupt
   * the wait (e.g. on manual reconnect or tab close).
   */
  const runAutoReconnect = useCallback(
    async (leafId: string) => {
      const autoReconnect = useSettingsStore.getState().settings.general
        .autoReconnect;
      if (!autoReconnect) return;

      // If a loop is already running for this leaf, don't spawn another.
      if (reconnectAbortsRef.current.has(leafId)) return;

      const controller = new AbortController();
      reconnectAbortsRef.current.set(leafId, controller);
      setConnectionState(leafId, 'reconnecting');

      try {
        for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
          if (controller.signal.aborted) return;

          const baseDelay = useSettingsStore.getState().settings.general
            .reconnectDelay;
          const waitSec = backoffSeconds(attempt, baseDelay);
          const term = terminalsRef.current.get(leafId);
          if (term) {
            term.write(
              `\r\n\x1b[36mReconnecting (${attempt}/${MAX_RECONNECT_ATTEMPTS}) in ${waitSec}s...\x1b[0m\r\n`
            );
          }
          try {
            await sleep(waitSec * 1000, controller.signal);
          } catch {
            // Aborted -- caller took over.
            return;
          }
          if (controller.signal.aborted) return;

          const leaf = findLeaf(leafId);
          if (!leaf || !leaf.connectionParams) {
            // Leaf vanished (tab closed) or never had params -- stop.
            return;
          }

          const newSessionId = uuid();
          setLeafSessionId(leafId, newSessionId);
          // Mark as reconnecting again in case a previous failed attempt
          // flipped us to 'disconnected' in-flight. Keeps the tab's spinner
          // on until we either succeed or exhaust attempts.
          setConnectionState(leafId, 'reconnecting');

          // IMPORTANT: use `connectCore(..., false)` rather than the public
          // `connect()` so we don't cancel OURSELVES. We also rely on the
          // controller staying installed for the duration of the call: if
          // a spurious 'disconnected' event arrives in-flight, its handler
          // will see the map entry and skip spawning a second loop.
          await connectCore(
            leafId,
            { sessionId: newSessionId, ...leaf.connectionParams },
            false
          );

          const updated = findLeaf(leafId);
          if (updated?.connected) {
            // connect() succeeded and the 'connected' event fired. Done.
            return;
          }
          if (controller.signal.aborted) return;
        }

        // Exhausted the attempt budget.
        setConnectionState(leafId, 'failed');
        const term = terminalsRef.current.get(leafId);
        if (term) {
          term.write(
            `\r\n\x1b[31mAuto-reconnect gave up after ${MAX_RECONNECT_ATTEMPTS} attempts. Click the tab to retry.\x1b[0m\r\n`
          );
        }
      } finally {
        // Clean up our controller unless a nested call replaced it.
        const current = reconnectAbortsRef.current.get(leafId);
        if (current === controller) {
          reconnectAbortsRef.current.delete(leafId);
        }
      }
    },
    [connectCore, setConnectionState, setLeafSessionId]
  );

  const reconnect = useCallback(
    async (leafId: string) => {
      const leaf = findLeaf(leafId);
      if (!leaf || !leaf.connectionParams) return;

      // Manual reconnect always resets the backoff counter -- cancel any
      // in-flight loop so our attempt takes priority.
      cancelReconnectLoop(leafId);

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
    [connect, setLeafSessionId, cancelReconnectLoop]
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

  const disconnect = useCallback(
    async (sessionId: string, leafId?: string) => {
      if (leafId) cancelReconnectLoop(leafId);
      try {
        await invoke('ssh_disconnect', { sessionId });
      } catch {
        // Disconnect failed silently
      }
    },
    [cancelReconnectLoop]
  );

  // Keep `setConnected` in the API surface in case old callers lean on it.
  // New code should prefer `setConnectionState` via the tabStore directly.
  void setConnected;

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
