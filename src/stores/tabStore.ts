import { create } from 'zustand';
import { v4 as uuid } from 'uuid';

export interface Tab {
  id: string;
  sessionId: string;
  title: string;
  hostname: string;
  connected: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (sessionId: string, title: string, hostname: string) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setConnected: (id: string, connected: boolean) => void;
}

export const useTabStore = create<TabState>((set) => ({
  tabs: [],
  activeTabId: null,

  addTab: (sessionId, title, hostname) => {
    const id = uuid();
    set((state) => ({
      tabs: [...state.tabs, { id, sessionId, title, hostname, connected: false }],
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

  setActiveTab: (id) => set({ activeTabId: id }),

  setConnected: (id, connected) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, connected } : t)),
    })),
}));
