import { create } from 'zustand';

export type SplitLayout = 'single' | 'horizontal-2' | 'vertical-2' | 'quad';

const layoutCycle: SplitLayout[] = ['single', 'horizontal-2', 'vertical-2', 'quad'];

interface SplitState {
  layouts: Record<string, SplitLayout>;
  getLayout: (tabId: string) => SplitLayout;
  cycleLayout: (tabId: string) => void;
  setLayout: (tabId: string, layout: SplitLayout) => void;
}

export const useSplitStore = create<SplitState>((set, get) => ({
  layouts: {},

  getLayout: (tabId: string) => get().layouts[tabId] ?? 'single',

  cycleLayout: (tabId: string) =>
    set((state) => {
      const current = state.layouts[tabId] ?? 'single';
      const idx = layoutCycle.indexOf(current);
      const next = layoutCycle[(idx + 1) % layoutCycle.length];
      return { layouts: { ...state.layouts, [tabId]: next } };
    }),

  setLayout: (tabId: string, layout: SplitLayout) =>
    set((state) => ({
      layouts: { ...state.layouts, [tabId]: layout },
    })),
}));
