import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  scrollbackLines: number;
  cursorStyle: string;
  cursorBlink: boolean;
}

export interface MonitoringSettings {
  enabled: boolean;
  refreshInterval: number;
}

export interface GeneralSettings {
  autoReconnect: boolean;
  reconnectDelay: number;
  confirmOnClose: boolean;
  selectToCopy: boolean;
  autoCollapseSidebar: boolean;
}

export interface AppSettings {
  terminal: TerminalSettings;
  monitoring: MonitoringSettings;
  general: GeneralSettings;
}

const defaultSettings: AppSettings = {
  terminal: {
    fontFamily: 'JetBrains Mono',
    fontSize: 14,
    lineHeight: 1.4,
    scrollbackLines: 10000,
    cursorStyle: 'bar',
    cursorBlink: true,
  },
  monitoring: {
    enabled: true,
    refreshInterval: 3,
  },
  general: {
    autoReconnect: false,
    reconnectDelay: 5,
    confirmOnClose: true,
    selectToCopy: true,
    autoCollapseSidebar: true,
  },
};

interface SettingsStore {
  settings: AppSettings;
  loaded: boolean;
  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  updateTerminal: (partial: Partial<TerminalSettings>) => Promise<void>;
  updateMonitoring: (partial: Partial<MonitoringSettings>) => Promise<void>;
  updateGeneral: (partial: Partial<GeneralSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: defaultSettings,
  loaded: false,

  loadSettings: async () => {
    try {
      const settings = await invoke<AppSettings>('get_settings');
      set({ settings, loaded: true });
    } catch (err) {
      console.error('Failed to load settings:', err);
      set({ loaded: true });
    }
  },

  saveSettings: async (settings: AppSettings) => {
    try {
      const saved = await invoke<AppSettings>('save_settings', { settings });
      set({ settings: saved });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },

  updateTerminal: async (partial: Partial<TerminalSettings>) => {
    const current = get().settings;
    const updated: AppSettings = {
      ...current,
      terminal: { ...current.terminal, ...partial },
    };
    await get().saveSettings(updated);
  },

  updateMonitoring: async (partial: Partial<MonitoringSettings>) => {
    const current = get().settings;
    const updated: AppSettings = {
      ...current,
      monitoring: { ...current.monitoring, ...partial },
    };
    await get().saveSettings(updated);
  },

  updateGeneral: async (partial: Partial<GeneralSettings>) => {
    const current = get().settings;
    const updated: AppSettings = {
      ...current,
      general: { ...current.general, ...partial },
    };
    await get().saveSettings(updated);
  },
}));
