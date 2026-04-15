import { create } from 'zustand';
import { v4 as uuid } from 'uuid';

export interface ConnectionParams {
  hostname: string;
  port: number;
  username: string;
  password: string;
}

export interface Tab {
  id: string;
  sessionId: string;
  title: string;
  hostname: string;
  connected: boolean;
  hasActivity: boolean;
  disconnectedAt: number | null;
  connectionParams: ConnectionParams | null;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (sessionId: string, title: string, hostname: string) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setConnected: (id: string, connected: boolean) => void;
  setActivity: (id: string, hasActivity: boolean) => void;
  clearActivity: (id: string) => void;
  storeConnectionParams: (id: string, params: ConnectionParams) => void;
}

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: (sessionId, title, hostname) => {
    const id = uuid();
    set((state) => ({
      tabs: [
        ...state.tabs,
        {
          id,
          sessionId,
          title,
          hostname,
          connected: false,
          hasActivity: false,
          disconnectedAt: null,
          connectionParams: null,
        },
      ],
      activeTabId: id,
    }));
    return id;
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
      // Clear activity when switching to a tab
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasActivity: false } : t)),
    })),

  setConnected: (id, connected) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              connected,
              disconnectedAt: !connected && t.connected ? Date.now() : t.disconnectedAt,
            }
          : t
      ),
    })),

  setActivity: (id, hasActivity) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasActivity } : t)),
    })),

  clearActivity: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, hasActivity: false } : t)),
    })),

  storeConnectionParams: (id, params) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, connectionParams: params } : t)),
    })),
}));
