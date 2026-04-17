import { create } from 'zustand';
import { v4 as uuid } from 'uuid';

export interface ConnectionParams {
  hostname: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Per-leaf session state. Each LeafNode in a pane tree owns one of these,
 * representing a single SSH connection rendered in a single xterm instance.
 */
export interface LeafContent {
  /** Unique id for this leaf instance. Used to address xterm + UI handlers. */
  leafId: string;
  /** Backend SSH session id (used by ssh_write / ssh_resize / ssh_disconnect). */
  sessionId: string;
  /** When this session came from a saved-session entry, the saved id. */
  savedSessionId: string | null;
  title: string;
  hostname: string;
  cwd: string | null;
  connected: boolean;
  hasActivity: boolean;
  disconnectedAt: number | null;
  connectionParams: ConnectionParams | null;
}

export interface LeafNode {
  kind: 'leaf';
  content: LeafContent;
}

export interface SplitNode {
  kind: 'split';
  /** `horizontal` = side-by-side (children stacked along the row axis).
   *  `vertical`   = stacked (children stacked along the column axis). */
  direction: 'horizontal' | 'vertical';
  /** Flex ratio for the FIRST child, between 0 and 1. The second child gets
   *  the remainder. Initialised to 0.5 on every split for v1; resizing is
   *  out of scope for the first pass. */
  ratio: number;
  first: PaneNode;
  second: PaneNode;
}

export type PaneNode = LeafNode | SplitNode;

/** Where on a pane the user dropped, relative to the pane's bounding box. */
export type DropZone = 'top' | 'bottom' | 'left' | 'right';

export interface Tab {
  id: string;
  /** The leaf currently considered "focused" for keyboard input + activity tracking. */
  focusedLeafId: string;
  /** Root of the pane tree shown when this tab is active. Always at least one leaf. */
  pane: PaneNode;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  /** Add a new tab containing a single fresh leaf. Returns { tabId, leafId }. */
  addTab: (
    sessionId: string,
    title: string,
    hostname: string,
    savedSessionId?: string | null
  ) => { tabId: string; leafId: string };
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setFocusedLeaf: (tabId: string, leafId: string) => void;
  setConnected: (leafId: string, connected: boolean) => void;
  setActivity: (leafId: string, hasActivity: boolean) => void;
  storeConnectionParams: (leafId: string, params: ConnectionParams) => void;
  renameTab: (tabId: string, title: string) => void;
  setCwd: (leafId: string, cwd: string) => void;
  /** Replace a leaf's backend SSH session id (used during reconnect when a
   *  fresh session_id is minted). */
  setLeafSessionId: (leafId: string, sessionId: string) => void;
  /** Move all leaves of `sourceTabId` into `targetTabId`, splitting the
   *  target leaf addressed by `targetLeafId` along the supplied edge. The
   *  source tab is removed. */
  splitInto: (
    targetTabId: string,
    targetLeafId: string,
    zone: DropZone,
    sourceTabId: string
  ) => void;
  /** Remove a leaf from its tab's pane tree. If it was the last leaf, the
   *  whole tab is removed (caller should also disconnect the SSH session). */
  removeLeaf: (leafId: string) => void;
}

// ---------------------------------------------------------------------------
// Pane-tree helpers (pure functions over PaneNode)
// ---------------------------------------------------------------------------

/** Yield every leaf in the tree (depth-first, left-to-right). */
export function leavesOf(pane: PaneNode): LeafContent[] {
  if (pane.kind === 'leaf') return [pane.content];
  return [...leavesOf(pane.first), ...leavesOf(pane.second)];
}

/** Returns a new tree with the leaf identified by leafId replaced via updater.
 *  If the leaf isn't in the tree, returns the original. */
function updateLeaf(
  pane: PaneNode,
  leafId: string,
  updater: (l: LeafContent) => LeafContent
): PaneNode {
  if (pane.kind === 'leaf') {
    return pane.content.leafId === leafId
      ? { kind: 'leaf', content: updater(pane.content) }
      : pane;
  }
  return {
    ...pane,
    first: updateLeaf(pane.first, leafId, updater),
    second: updateLeaf(pane.second, leafId, updater),
  };
}

/** Returns a new tree with the leaf removed, or null if removal would empty
 *  the tree. Splits with one remaining child collapse to that child. */
function dropLeaf(pane: PaneNode, leafId: string): PaneNode | null {
  if (pane.kind === 'leaf') {
    return pane.content.leafId === leafId ? null : pane;
  }
  const f = dropLeaf(pane.first, leafId);
  const s = dropLeaf(pane.second, leafId);
  if (f && s) return { ...pane, first: f, second: s };
  if (f) return f;
  if (s) return s;
  return null;
}

/** Returns a new tree with `targetLeafId` split: the target leaf is paired
 *  with `incoming` along the supplied edge. */
function splitAt(pane: PaneNode, targetLeafId: string, zone: DropZone, incoming: PaneNode): PaneNode {
  if (pane.kind === 'leaf') {
    if (pane.content.leafId !== targetLeafId) return pane;
    const direction: 'horizontal' | 'vertical' =
      zone === 'left' || zone === 'right' ? 'horizontal' : 'vertical';
    const incomingFirst = zone === 'left' || zone === 'top';
    return {
      kind: 'split',
      direction,
      ratio: 0.5,
      first: incomingFirst ? incoming : pane,
      second: incomingFirst ? pane : incoming,
    };
  }
  return {
    ...pane,
    first: splitAt(pane.first, targetLeafId, zone, incoming),
    second: splitAt(pane.second, targetLeafId, zone, incoming),
  };
}

/** Pick a sensible new focused leaf id after the current one is removed. */
function firstLeafId(pane: PaneNode): string {
  return pane.kind === 'leaf' ? pane.content.leafId : firstLeafId(pane.first);
}

/** Best-effort title for a tab whose pane tree may have multiple leaves --
 *  use the focused leaf's title, falling back to the first leaf. */
function tabTitleFor(tab: Tab): string {
  const leaves = leavesOf(tab.pane);
  const focused = leaves.find((l) => l.leafId === tab.focusedLeafId);
  return focused?.title ?? leaves[0]?.title ?? '';
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (sessionId, title, hostname, savedSessionId = null) => {
    const tabId = uuid();
    const leafId = uuid();
    const leaf: LeafNode = {
      kind: 'leaf',
      content: {
        leafId,
        sessionId,
        savedSessionId,
        title,
        hostname,
        cwd: null,
        connected: false,
        hasActivity: false,
        disconnectedAt: null,
        connectionParams: null,
      },
    };
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id: tabId,
          focusedLeafId: leafId,
          pane: leaf,
        },
      ],
      activeTabId: tabId,
    }));
    return { tabId, leafId };
  },

  removeTab: (id) =>
    set((state) => {
      const remaining = state.tabs.filter((t) => t.id !== id);
      let nextActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        nextActiveId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      }
      return { tabs: remaining, activeTabId: nextActiveId };
    }),

  setActiveTab: (id) =>
    set((state) => ({
      activeTabId: id,
      // Clear activity on the focused leaf of the now-active tab so the
      // pulsing indicator stops.
      tabs: state.tabs.map((t) => {
        if (t.id !== id) return t;
        return {
          ...t,
          pane: updateLeaf(t.pane, t.focusedLeafId, (l) => ({ ...l, hasActivity: false })),
        };
      }),
    })),

  setFocusedLeaf: (tabId, leafId) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              focusedLeafId: leafId,
              pane: updateLeaf(t.pane, leafId, (l) => ({ ...l, hasActivity: false })),
            }
          : t
      ),
    })),

  setConnected: (leafId, connected) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        pane: updateLeaf(t.pane, leafId, (l) => ({
          ...l,
          connected,
          disconnectedAt: !connected && l.connected ? Date.now() : l.disconnectedAt,
        })),
      })),
    })),

  setActivity: (leafId, hasActivity) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        pane: updateLeaf(t.pane, leafId, (l) => ({ ...l, hasActivity })),
      })),
    })),

  storeConnectionParams: (leafId, params) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        pane: updateLeaf(t.pane, leafId, (l) => ({ ...l, connectionParams: params })),
      })),
    })),

  renameTab: (tabId, title) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t;
        return {
          ...t,
          pane: updateLeaf(t.pane, t.focusedLeafId, (l) => ({ ...l, title })),
        };
      }),
    })),

  setCwd: (leafId, cwd) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        pane: updateLeaf(t.pane, leafId, (l) => ({ ...l, cwd })),
      })),
    })),

  setLeafSessionId: (leafId, sessionId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => ({
        ...t,
        pane: updateLeaf(t.pane, leafId, (l) => ({
          ...l,
          sessionId,
          disconnectedAt: null,
        })),
      })),
    })),

  splitInto: (targetTabId, targetLeafId, zone, sourceTabId) =>
    set((state) => {
      if (targetTabId === sourceTabId) return state;
      const source = state.tabs.find((t) => t.id === sourceTabId);
      const target = state.tabs.find((t) => t.id === targetTabId);
      if (!source || !target) return state;
      const newPane = splitAt(target.pane, targetLeafId, zone, source.pane);
      const remaining = state.tabs
        .filter((t) => t.id !== sourceTabId)
        .map((t) => (t.id === targetTabId ? { ...t, pane: newPane } : t));
      return {
        tabs: remaining,
        activeTabId: targetTabId,
      };
    }),

  removeLeaf: (leafId) =>
    set((state) => {
      const tabs: Tab[] = [];
      let activeTabId = state.activeTabId;
      for (const t of state.tabs) {
        const next = dropLeaf(t.pane, leafId);
        if (next === null) {
          // Whole tab is gone -- skip it
          if (activeTabId === t.id) {
            activeTabId = null;
          }
          continue;
        }
        const focusedStillExists = leavesOf(next).some(
          (l) => l.leafId === t.focusedLeafId
        );
        tabs.push({
          ...t,
          pane: next,
          focusedLeafId: focusedStillExists ? t.focusedLeafId : firstLeafId(next),
        });
      }
      if (activeTabId === null && tabs.length > 0) {
        activeTabId = tabs[tabs.length - 1].id;
      }
      return { tabs, activeTabId };
    }),
}));

// Re-export the title helper for components that show the tab label.
export { tabTitleFor };
