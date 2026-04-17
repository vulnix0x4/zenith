import { create } from 'zustand';

export type SidebarPanel = 'sessions' | 'files' | 'settings';

interface LayoutState {
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarOpen: true,
  sidebarPanel: 'sessions',
  sidebarWidth: 260,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarPanel: (panel) =>
    set((s) => ({
      sidebarPanel: panel,
      sidebarOpen: s.sidebarPanel === panel ? !s.sidebarOpen : true,
    })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(500, width)) }),
}));
