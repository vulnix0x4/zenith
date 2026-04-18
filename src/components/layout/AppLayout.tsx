import { useState, useCallback, useEffect, useMemo, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuid } from 'uuid';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { Terminal } from '@xterm/xterm';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import TitleBar from './TitleBar';
import MonitorBar from './MonitorBar';
import SplitTerminal from '../terminal/SplitTerminal';
import XTerminal from '../terminal/XTerminal';
import QuickConnect from '../dialogs/QuickConnect';
import CommandPalette from '../command-palette/CommandPalette';
import PasswordPrompt from '../dialogs/PasswordPrompt';
import {
  useTabStore,
  leavesOf,
  type DropZone,
  type Tab,
} from '../../stores/tabStore';
import { useSessionStore, type Session } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useUpdaterStore } from '../../stores/updaterStore';
import { useSshConnection } from '../../hooks/useSshConnection';
import { useMonitoring } from '../../hooks/useMonitoring';
import styles from './AppLayout.module.css';

/** Drag-state we share between TabBar (source) and SplitTerminal (drop targets). */
interface DragState {
  /** Tab id currently being dragged from the tab bar. Null when no drag. */
  sourceTabId: string | null;
  /** Hovered drop target leaf + zone, set during dragover. */
  hoverLeafId: string | null;
  hoverZone: DropZone | null;
}

const NO_DRAG: DragState = { sourceTabId: null, hoverLeafId: null, hoverZone: null };

export default function AppLayout() {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const addTab = useTabStore((s) => s.addTab);
  const removeTab = useTabStore((s) => s.removeTab);
  const setCwd = useTabStore((s) => s.setCwd);
  const splitInto = useTabStore((s) => s.splitInto);
  const removeLeaf = useTabStore((s) => s.removeLeaf);

  const { sessions, loadSessions } = useSessionStore();
  const { connect, reconnect, write, resize, disconnect, registerTerminal, unregisterTerminal } =
    useSshConnection();

  const [showQuickConnect, setShowQuickConnect] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [passwordSession, setPasswordSession] = useState<Session | null>(null);
  const [drag, setDrag] = useState<DragState>(NO_DRAG);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Kick off a silent update check once on app launch. Failures fall through
  // to idle (see updaterStore.checkForUpdate when silent: true) so this is
  // non-disruptive even when offline / behind a captive portal.
  const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
  useEffect(() => {
    void checkForUpdate({ silent: true });
  }, [checkForUpdate]);

  // Clicking the UpdateIndicator pill in the title bar should open the
  // settings sidebar panel and scroll the Updates section into view. We
  // write directly via setState rather than reuse setSidebarPanel('settings')
  // because the latter toggles the panel closed when it's already active --
  // from the pill's perspective we always want "open", never "toggle".
  const handleOpenUpdates = useCallback(() => {
    useLayoutStore.setState({ sidebarPanel: 'settings', sidebarOpen: true });
    // Give React a frame to mount SettingsPanel before scrolling to the
    // #updates-section anchor -- before that, the node doesn't exist yet.
    requestAnimationFrame(() => {
      document.getElementById('updates-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);

  // The active tab + its focused leaf drive the file browser, monitoring, and
  // sidebar highlights. We resolve them once and reuse below.
  const activeTab: Tab | null = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? null,
    [tabs, activeTabId]
  );

  const activeFocusedLeaf = useMemo(() => {
    if (!activeTab) return null;
    return (
      leavesOf(activeTab.pane).find((l) => l.leafId === activeTab.focusedLeafId) ?? null
    );
  }, [activeTab]);

  const activeSessionId = activeFocusedLeaf?.connected ? activeFocusedLeaf.sessionId : null;
  const activeTabCwd = activeFocusedLeaf?.cwd ?? null;

  // Live system monitoring tracks the focused leaf's session.
  const monitorData = useMonitoring(activeSessionId);

  // Auto-open SFTP for every connected leaf (one per session). Idempotent
  // backend-side -- re-calling on an already-open session is a no-op.
  useEffect(() => {
    for (const tab of tabs) {
      for (const leaf of leavesOf(tab.pane)) {
        if (leaf.connected) {
          invoke('sftp_open', { sessionId: leaf.sessionId }).catch(() => {});
        }
      }
    }
  }, [tabs]);

  // Highlight saved sessions in the sidebar that are currently connected in
  // some leaf. Walk every leaf, match by savedSessionId (preferred) or by
  // user@host fallback for legacy / quick-connect tabs.
  const connectedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of tabs) {
      for (const leaf of leavesOf(tab.pane)) {
        if (!leaf.connected) continue;
        if (leaf.savedSessionId) {
          ids.add(leaf.savedSessionId);
          continue;
        }
        for (const s of sessions) {
          const label = `${s.username}@${s.hostname}`;
          if (leaf.title === label || leaf.title === s.name) {
            ids.add(s.id);
          }
        }
      }
    }
    return ids;
  }, [tabs, sessions]);

  const handleNewTab = useCallback(() => {
    setShowQuickConnect(true);
  }, []);

  // ---- Connection flows --------------------------------------------------

  // Quick-connect flow (no saved session, password provided inline)
  const handleQuickConnect = useCallback(
    (params: { hostname: string; port: number; username: string; password: string }) => {
      const sessionId = uuid();
      const title = `${params.username}@${params.hostname}`;
      const { leafId } = addTab(sessionId, title, params.hostname);
      setShowQuickConnect(false);

      setTimeout(() => {
        connect(leafId, {
          sessionId,
          hostname: params.hostname,
          port: params.port,
          username: params.username,
          password: params.password,
        });
      }, 100);
    },
    [addTab, connect]
  );

  // Build the tab title for a saved session: prefer the user-given name,
  // fall back to user@host so unnamed sessions still get something readable.
  const titleFor = (session: Session): string =>
    session.name?.trim() ? session.name.trim() : `${session.username}@${session.hostname}`;

  // Connect from a saved session -- try keychain credentials first, then prompt
  const handleSessionConnect = useCallback(
    async (session: Session) => {
      if (session.authMethod === 'password') {
        try {
          const savedPassword = await invoke<string | null>('get_credential', {
            sessionId: session.id,
          });
          if (savedPassword) {
            const sessionId = uuid();
            const { leafId } = addTab(sessionId, titleFor(session), session.hostname, session.id);
            setTimeout(() => {
              connect(leafId, {
                sessionId,
                hostname: session.hostname,
                port: session.port,
                username: session.username,
                password: savedPassword,
              });
            }, 100);
            return;
          }
        } catch {
          // Keychain lookup failed, fall through to password prompt
        }
        setPasswordSession(session);
      } else {
        // Private key auth -- connect with empty password
        const sessionId = uuid();
        const { leafId } = addTab(sessionId, titleFor(session), session.hostname, session.id);
        setTimeout(() => {
          connect(leafId, {
            sessionId,
            hostname: session.hostname,
            port: session.port,
            username: session.username,
            password: '',
          });
        }, 100);
      }
    },
    [addTab, connect]
  );

  const handlePasswordSubmit = useCallback(
    (password: string) => {
      if (!passwordSession) return;
      const session = passwordSession;
      setPasswordSession(null);

      const sessionId = uuid();
      const { leafId } = addTab(sessionId, titleFor(session), session.hostname, session.id);
      setTimeout(() => {
        connect(leafId, {
          sessionId,
          hostname: session.hostname,
          port: session.port,
          username: session.username,
          password,
        });
      }, 100);
    },
    [passwordSession, addTab, connect]
  );

  // ---- Tab + pane lifecycle ---------------------------------------------

  // Closing a tab walks all of its leaves and tears down each SSH session
  // and xterm instance, then removes the tab entry itself.
  const handleTabClose = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        for (const leaf of leavesOf(tab.pane)) {
          disconnect(leaf.sessionId);
          unregisterTerminal(leaf.leafId);
        }
      }
      removeTab(tabId);
    },
    [tabs, disconnect, unregisterTerminal, removeTab]
  );

  // Closing a single pane: tear down its SSH session and unregister the
  // xterm. The store handles tree collapse + tab removal if it was the last.
  const handleClosePane = useCallback(
    (leafId: string) => {
      // Find the leaf to grab its sessionId before the store mutation drops it
      for (const tab of tabs) {
        for (const leaf of leavesOf(tab.pane)) {
          if (leaf.leafId === leafId) {
            disconnect(leaf.sessionId);
            unregisterTerminal(leafId);
            removeLeaf(leafId);
            return;
          }
        }
      }
    },
    [tabs, disconnect, unregisterTerminal, removeLeaf]
  );

  // ---- Drag and drop -----------------------------------------------------

  const setActiveTab = useTabStore((s) => s.setActiveTab);

  const handleTabDragStart = useCallback(
    (tabId: string) => {
      setDrag({ sourceTabId: tabId, hoverLeafId: null, hoverZone: null });
      // If the user grabs the currently-active tab, swap focus to a sibling
      // so they actually see a terminal underneath to drop onto. The dragged
      // tab's pane tree is what gets merged in -- it doesn't need to be
      // visible during the drag.
      if (tabId === activeTabId && tabs.length > 1) {
        const sibling = tabs.find((t) => t.id !== tabId);
        if (sibling) setActiveTab(sibling.id);
      }
    },
    [activeTabId, tabs, setActiveTab]
  );

  const handleTabDragEnd = useCallback(() => {
    setDrag(NO_DRAG);
  }, []);

  const handleDragOverPane = useCallback(
    (leafId: string, zone: DropZone | null) => {
      setDrag((d) =>
        d.sourceTabId === null
          ? d
          : { ...d, hoverLeafId: zone ? leafId : null, hoverZone: zone }
      );
    },
    []
  );

  // Drop a tab onto a pane: merge its tree into the target tab's at the
  // chosen edge. Refuse no-ops (drop onto a leaf belonging to the same tab
  // for v1; intra-tab pane rearrangement comes later).
  const handleDropOnPane = useCallback(
    (targetLeafId: string, zone: DropZone) => {
      const sourceTabId = drag.sourceTabId;
      setDrag(NO_DRAG);
      if (!sourceTabId) return;
      // Find which tab owns the target leaf
      const targetTab = tabs.find((t) =>
        leavesOf(t.pane).some((l) => l.leafId === targetLeafId)
      );
      if (!targetTab || targetTab.id === sourceTabId) return;
      splitInto(targetTab.id, targetLeafId, zone, sourceTabId);
    },
    [drag.sourceTabId, tabs, splitInto]
  );

  // ---- Sidebar collapse behaviour ---------------------------------------

  const { sidebarOpen, toggleSidebar } = useLayoutStore();
  const autoCollapse = useSettingsStore((s) => s.settings.general.autoCollapseSidebar);

  const anyConnected = useMemo(
    () =>
      tabs.some((t) => leavesOf(t.pane).some((l) => l.connected)),
    [tabs]
  );

  useEffect(() => {
    if (anyConnected && autoCollapse !== false && sidebarOpen) {
      toggleSidebar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyConnected]);

  const handleTerminalAreaClick = useCallback(() => {
    if (autoCollapse !== false && sidebarOpen && anyConnected) {
      toggleSidebar();
    }
  }, [autoCollapse, sidebarOpen, anyConnected, toggleSidebar]);

  // Global Cmd/Ctrl+K opens the command palette. We deliberately skip
  // interception when the user is in a form field or inside the xterm
  // viewport: the terminal binds Ctrl+K itself (readline "kill to end of
  // line") and swallowing it from under the shell would surprise users.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key === 'k')) return;

      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return;
        // xterm's focused element lives inside a .xterm container; bail if
        // the terminal owns the focus so its own Ctrl+K binding wins.
        if (active.closest('.xterm')) return;
      }

      e.preventDefault();
      setShowPalette((v) => !v);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Confirm-on-close: intercept the OS close request (Alt+F4 / Cmd+Q / red X)
  // when the user has active tabs and the "Confirm on Close" setting is on.
  // Tauri's onCloseRequested fires before the window is destroyed so we can
  // call event.preventDefault() while the confirm dialog resolves.
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    const unlistenPromise = win.onCloseRequested(async (event) => {
      const { confirmOnClose } = useSettingsStore.getState().settings.general;
      if (!confirmOnClose) return; // allow close

      // Count tabs as a simple proxy for "active work". The confirm-on-close
      // toggle implies the user wants to be asked about any tab loss, and
      // counting connected-only leaves would miss tabs that are mid-reconnect.
      const tabCount = useTabStore.getState().tabs.length;
      if (tabCount === 0) return; // nothing to lose

      event.preventDefault();
      const confirmed = await confirm(
        `You have ${tabCount} open tab${tabCount === 1 ? '' : 's'}. Close anyway?`,
        { title: 'Close Zenith?', kind: 'warning' }
      );
      if (confirmed && !cancelled) {
        // Drop our own listener before re-calling close so the handler
        // doesn't intercept the request a second time and loop forever.
        const fn = await unlistenPromise;
        fn();
        await win.close();
      }
    });
    return () => {
      cancelled = true;
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  // ---- Persistent xterm rendering via portals ---------------------------
  //
  // Each leaf's XTerminal is mounted ONCE at this level and projected into
  // its pane's slot div via createPortal. Re-parenting the pane (split /
  // merge) used to remount XTerminal which disposed the underlying terminal
  // and wiped the buffer; the portal lets the instance survive across tree
  // reorganisations.

  // leafId -> slot DOM element registered by PaneLeaf
  const [slots, setSlots] = useState<Record<string, HTMLDivElement>>({});

  const registerSlot = useCallback((leafId: string, el: HTMLDivElement | null) => {
    setSlots((prev) => {
      if (el === prev[leafId]) return prev;
      const next = { ...prev };
      if (el) next[leafId] = el;
      else delete next[leafId];
      return next;
    });
  }, []);

  // A hidden off-screen "limbo" host. When a slot disappears momentarily
  // (e.g. between an old PaneLeaf unmounting and its replacement mounting),
  // the terminal is portal'd here instead of being unmounted.
  const [limbo, setLimbo] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;left:-99999px;top:0;width:800px;height:600px;pointer-events:none;';
    document.body.appendChild(el);
    setLimbo(el);
    return () => {
      el.remove();
    };
  }, []);

  // Flatten every leaf across all tabs so we can render one XTerminal per leaf
  // regardless of which tab is active. Inactive tab slots still exist in the
  // DOM (display:none ancestor) so portals stay valid.
  const allLeaves = useMemo(
    () => tabs.flatMap((t) => leavesOf(t.pane)),
    [tabs]
  );

  return (
    <div className={styles.layout}>
      <TitleBar
        onSearchClick={() => setShowPalette(true)}
        onOpenUpdates={handleOpenUpdates}
      />
      <div className={styles.body}>
        <ActivityBar />
        <Sidebar
          onConnect={handleSessionConnect}
          connectedSessionIds={connectedSessionIds}
          activeSessionId={activeSessionId}
          activeTabCwd={activeTabCwd}
        />
        <div className={styles.mainArea}>
          <TabBar
            onNewTab={handleNewTab}
            onCloseTab={handleTabClose}
            onSearchClick={() => setShowPalette(true)}
            onTabDragStart={handleTabDragStart}
            onTabDragEnd={handleTabDragEnd}
          />
          <div
            className={`${styles.terminalArea} ${tabs.length > 0 ? styles.terminalAreaActive : ''}`}
            onMouseDown={handleTerminalAreaClick}
          >
            {tabs.length === 0 && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderLogo}>ZENITH</div>
                <div className={styles.placeholderHint}>
                  Double-click a session or press + to connect
                </div>
              </div>
            )}
            {tabs.map((tab) => {
              const leaves = leavesOf(tab.pane);
              const focused = leaves.find((l) => l.leafId === tab.focusedLeafId);
              const showReconnectBanner =
                focused && !focused.connected && focused.disconnectedAt !== null;
              return (
                <div
                  key={tab.id}
                  style={{
                    display: tab.id === activeTabId ? 'block' : 'none',
                    width: '100%',
                    height: '100%',
                  }}
                >
                  <div className={styles.terminalWrapper}>
                    {showReconnectBanner && focused && (
                      <div className={styles.reconnectOverlay}>
                        <span>{'\u26A1'} Connection lost</span>
                        <button
                          className={styles.reconnectBtn}
                          onClick={() => reconnect(focused.leafId)}
                        >
                          Reconnect
                        </button>
                      </div>
                    )}
                    <SplitTerminal
                      tabId={tab.id}
                      pane={tab.pane}
                      focusedLeafId={tab.focusedLeafId}
                      registerSlot={registerSlot}
                      onClosePane={handleClosePane}
                      onDragOverPane={handleDragOverPane}
                      onDropOnPane={handleDropOnPane}
                      // Whenever any tab is being dragged, this pane is a
                      // candidate drop target. Self-drops are no-op'd at
                      // drop time, so we don't need to gate on source !=
                      // tab.id here -- doing so would suppress the cursor
                      // and prevent the user from previewing the drop.
                      isDragActive={drag.sourceTabId !== null}
                      dragHoverLeafId={drag.hoverLeafId}
                      dragHoverZone={drag.hoverZone}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <MonitorBar data={monitorData} />
        </div>
      </div>
      <QuickConnect
        open={showQuickConnect}
        onClose={() => setShowQuickConnect(false)}
        onConnect={handleQuickConnect}
      />
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onSelectSession={handleSessionConnect}
        connectedSessionIds={connectedSessionIds}
      />
      <PasswordPrompt
        open={passwordSession !== null}
        sessionName={passwordSession?.name ?? ''}
        onClose={() => setPasswordSession(null)}
        onSubmit={handlePasswordSubmit}
      />

      {/* Portalled XTerminals: one per leaf, mounted here at a stable level
          so re-parenting the pane tree never disposes the underlying xterm.
          Falls back to the off-screen "limbo" host when no slot is mounted. */}
      {allLeaves.map((leaf) => {
        const target = slots[leaf.leafId] ?? limbo;
        if (!target) return null;
        return createPortal(
          <XTerminal
            onData={(data) => write(leaf.sessionId, data)}
            onResize={(cols, rows) => resize(leaf.sessionId, cols, rows)}
            onCwdChange={(cwd) => setCwd(leaf.leafId, cwd)}
            terminalRef={
              {
                get current() {
                  return null;
                },
                set current(term: Terminal | null) {
                  if (term) registerTerminal(leaf.leafId, term);
                },
              } as MutableRefObject<Terminal | null>
            }
          />,
          target,
          leaf.leafId
        );
      })}
    </div>
  );
}
