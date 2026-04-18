import { create } from 'zustand';

export type TransferDirection = 'up' | 'down';
export type TransferState = 'active' | 'done' | 'error';

export interface SftpTransfer {
  id: string;
  filename: string;
  direction: TransferDirection;
  /** File size in bytes if known (from local stat for uploads, remote
   *  metadata for downloads). Falls back to undefined when unavailable --
   *  the indicator just drops the size suffix in that case. */
  size?: number;
  state: TransferState;
  /** Terminal error message for failed transfers. Not shown for active
   *  transfers. */
  error?: string;
}

interface SftpState {
  transfers: SftpTransfer[];
  /** Start tracking a new transfer. Returns the generated id so the caller
   *  can later mark it done / errored. */
  startTransfer: (params: {
    filename: string;
    direction: TransferDirection;
    size?: number;
  }) => string;
  /** Mark a transfer as successfully finished. It stays in the list briefly
   *  so the UI can show a "Done" flash, then gets auto-pruned. */
  finishTransfer: (id: string) => void;
  /** Mark a transfer as failed. Error message is retained for display. */
  errorTransfer: (id: string, message: string) => void;
  /** Hard-remove a transfer (used by the auto-prune timer). */
  removeTransfer: (id: string) => void;
}

// How long completed / errored transfers linger in the list before they
// get pruned. Long enough for a user to notice; short enough not to pile up.
const FINISHED_LINGER_MS = 2500;
const ERROR_LINGER_MS = 6000;

export const useSftpStore = create<SftpState>((set, get) => ({
  transfers: [],

  startTransfer: ({ filename, direction, size }) => {
    // `crypto.randomUUID` is available in all Tauri webviews (Tauri ships
    // WebView2 / WKWebView, both of which have had it for years).
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((s) => ({
      transfers: [
        ...s.transfers,
        { id, filename, direction, size, state: 'active' },
      ],
    }));
    return id;
  },

  finishTransfer: (id) => {
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id ? { ...t, state: 'done' } : t
      ),
    }));
    // Auto-prune after a short linger so the "done" state is visible briefly.
    window.setTimeout(() => get().removeTransfer(id), FINISHED_LINGER_MS);
  },

  errorTransfer: (id, message) => {
    set((s) => ({
      transfers: s.transfers.map((t) =>
        t.id === id ? { ...t, state: 'error', error: message } : t
      ),
    }));
    // Keep error entries around a little longer so the user actually sees them.
    window.setTimeout(() => get().removeTransfer(id), ERROR_LINGER_MS);
  },

  removeTransfer: (id) => {
    set((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) }));
  },
}));
