import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type AuthMethod = 'password' | 'privateKey';

export interface Session {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  privateKeyPath?: string;
  folderId?: string;
  colorLabel?: string;
  notes?: string;
  lastConnected?: string;
  createdAt: string;
  sortOrder: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  colorLabel?: string;
  sortOrder: number;
  expanded: boolean;
}

interface SessionsData {
  sessions: Session[];
  folders: Folder[];
}

interface SessionStore {
  sessions: Session[];
  folders: Folder[];
  loadSessions: () => Promise<void>;
  saveSession: (session: Session) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  saveFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveSession: (sessionId: string, folderId: string | null) => Promise<void>;
  toggleFolder: (id: string) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  folders: [],

  loadSessions: async () => {
    try {
      const data = await invoke<SessionsData>('get_sessions');
      set({ sessions: data.sessions, folders: data.folders });
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  },

  saveSession: async (session: Session) => {
    try {
      const data = await invoke<SessionsData>('save_session', { session });
      set({ sessions: data.sessions, folders: data.folders });
    } catch (err) {
      console.error('Failed to save session:', err);
    }
  },

  deleteSession: async (id: string) => {
    try {
      const data = await invoke<SessionsData>('delete_session', { sessionId: id });
      set({ sessions: data.sessions, folders: data.folders });
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  },

  saveFolder: async (folder: Folder) => {
    try {
      const data = await invoke<SessionsData>('save_folder', { folder });
      set({ sessions: data.sessions, folders: data.folders });
    } catch (err) {
      console.error('Failed to save folder:', err);
    }
  },

  deleteFolder: async (id: string) => {
    try {
      const data = await invoke<SessionsData>('delete_folder', { folderId: id });
      set({ sessions: data.sessions, folders: data.folders });
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  },

  moveSession: async (sessionId: string, folderId: string | null) => {
    try {
      const data = await invoke<SessionsData>('move_session_to_folder', {
        sessionId,
        folderId,
      });
      set({ sessions: data.sessions, folders: data.folders });
    } catch (err) {
      console.error('Failed to move session:', err);
    }
  },

  toggleFolder: (id: string) => {
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, expanded: !f.expanded } : f
      ),
    }));
  },
}));
