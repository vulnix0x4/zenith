import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useSftpStore } from '../stores/sftpStore';

/** Raw kind of a remote filesystem entry as the Rust backend reports it.
 *  "other" catches fifos, sockets, devices -- rare on paths users browse. */
export type FileKind = 'directory' | 'file' | 'symlink' | 'other';

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string | null;
  permissions: string | null;
  /** Richer than `isDir` because it distinguishes symlinks, which show up
   *  as neither "file" nor "directory" via the mode bits alone. */
  fileType: FileKind;
}

/** Backend returns this exact string in the error message when an upload
 *  is refused because the remote path already exists. Must stay in sync
 *  with `FILE_EXISTS_MARKER` in `src-tauri/src/sftp/errors.rs`. */
const FILE_EXISTS_MARKER = 'FILE_EXISTS';

/** Extract the last path segment, treating both `/` and `\` as separators
 *  so we degrade gracefully on Windows-sourced paths. */
function basename(p: string): string {
  const m = p.replace(/[\\/]+$/, '').match(/[^\\/]+$/);
  return m ? m[0] : p;
}

export function useSftp(sessionId: string | null) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef<Set<string>>(new Set());
  const startTransfer = useSftpStore((s) => s.startTransfer);
  const finishTransfer = useSftpStore((s) => s.finishTransfer);
  const errorTransfer = useSftpStore((s) => s.errorTransfer);

  const ensureOpen = useCallback(
    async (sid: string) => {
      if (initializedRef.current.has(sid)) return;
      try {
        await invoke('sftp_open', { sessionId: sid });
        initializedRef.current.add(sid);
      } catch {
        // May already be open from a previous call, that's fine
        initializedRef.current.add(sid);
      }
    },
    []
  );

  const navigateTo = useCallback(
    async (path: string) => {
      if (!sessionId) return;
      setLoading(true);
      setError(null);
      try {
        await ensureOpen(sessionId);
        const result = await invoke<FileEntry[]>('sftp_list_dir', {
          sessionId,
          path,
        });
        // Sort: directories first, then files, alphabetically
        const sorted = result.sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
        setCurrentPath(path);
      } catch (e) {
        setError(String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, ensureOpen]
  );

  const goUp = useCallback(() => {
    if (currentPath === '/') return;
    const parts = currentPath.replace(/\/$/, '').split('/');
    parts.pop();
    const parent = parts.join('/') || '/';
    navigateTo(parent);
  }, [currentPath, navigateTo]);

  const download = useCallback(
    async (remotePath: string, fileName: string) => {
      if (!sessionId) return;
      const localPath = await save({
        defaultPath: fileName,
        title: 'Save file as',
      });
      if (!localPath) return;
      // Look up size from the current listing so the indicator can show a
      // readable byte count without another round-trip. Best-effort: zero is
      // shown as "--" by the formatter.
      const listed = entries.find((e) => e.path === remotePath);
      const tid = startTransfer({
        filename: fileName,
        direction: 'down',
        size: listed?.size,
      });
      try {
        await invoke('sftp_download', {
          sessionId,
          remotePath,
          localPath,
        });
        finishTransfer(tid);
      } catch (e) {
        const msg = String(e);
        errorTransfer(tid, msg);
        setError(`Download failed: ${msg}`);
      }
    },
    [sessionId, entries, startTransfer, finishTransfer, errorTransfer]
  );

  /** Core upload step used both on first attempt and on retry-with-overwrite.
   *  Kept as an inner helper so the overwrite confirmation flow doesn't have
   *  to duplicate the refresh / error-plumbing boilerplate.
   *
   *  We don't try to pre-stat the local file for a byte count -- the
   *  indicator just shows "Uploading <name>" without a size on uploads. */
  const doUpload = useCallback(
    async (
      localPath: string,
      remotePath: string,
      fileName: string,
      overwrite: boolean
    ): Promise<boolean> => {
      const tid = startTransfer({
        filename: fileName,
        direction: 'up',
      });
      try {
        await invoke('sftp_upload', {
          sessionId,
          localPath,
          remotePath,
          overwrite,
        });
        finishTransfer(tid);
        return true;
      } catch (e) {
        const msg = String(e);
        // File-exists is an expected refusal, not a hard error. Clean up the
        // transfer silently and let the caller decide whether to prompt.
        if (msg.includes(FILE_EXISTS_MARKER)) {
          // Remove transfer entry immediately since we'll either retry
          // (creating a new one) or cancel -- either way the half-started
          // attempt shouldn't linger in the indicator.
          useSftpStore.getState().removeTransfer(tid);
          throw new Error(FILE_EXISTS_MARKER);
        }
        errorTransfer(tid, msg);
        setError(`Upload failed: ${msg}`);
        return false;
      }
    },
    [sessionId, startTransfer, finishTransfer, errorTransfer]
  );

  const upload = useCallback(async () => {
    if (!sessionId) return;
    const selected = await open({
      multiple: false,
      title: 'Select file to upload',
    });
    if (!selected) return;
    const localPath = typeof selected === 'string' ? selected : selected;
    const fileName = basename(String(localPath));
    const remotePath = currentPath.endsWith('/')
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;

    try {
      const ok = await doUpload(String(localPath), remotePath, fileName, false);
      if (ok) await navigateTo(currentPath);
    } catch (e) {
      // First attempt was refused because remote file exists. Ask the user
      // whether to overwrite. window.confirm is intentional: a fancy modal
      // is overkill here, and a native prompt is unambiguous.
      if (e instanceof Error && e.message === FILE_EXISTS_MARKER) {
        const confirmed = window.confirm(
          `"${fileName}" already exists. Overwrite?`
        );
        if (!confirmed) return;
        try {
          const ok = await doUpload(
            String(localPath),
            remotePath,
            fileName,
            true
          );
          if (ok) await navigateTo(currentPath);
        } catch {
          // If the retry somehow also throws FILE_EXISTS, treat as a hard
          // error -- shouldn't happen, but swallow gracefully.
          setError('Upload failed: remote file still reports as existing');
        }
      }
    }
  }, [sessionId, currentPath, navigateTo, doUpload]);

  const deleteEntry = useCallback(
    async (path: string) => {
      if (!sessionId) return;
      try {
        await invoke('sftp_delete', { sessionId, path });
        await navigateTo(currentPath);
      } catch (e) {
        setError(`Delete failed: ${String(e)}`);
      }
    },
    [sessionId, currentPath, navigateTo]
  );

  const renameEntry = useCallback(
    async (oldPath: string, newPath: string) => {
      if (!sessionId) return;
      try {
        await invoke('sftp_rename', { sessionId, oldPath, newPath });
        await navigateTo(currentPath);
      } catch (e) {
        setError(`Rename failed: ${String(e)}`);
      }
    },
    [sessionId, currentPath, navigateTo]
  );

  const createDir = useCallback(
    async (name: string) => {
      if (!sessionId) return;
      const path = currentPath.endsWith('/')
        ? `${currentPath}${name}`
        : `${currentPath}/${name}`;
      try {
        await invoke('sftp_mkdir', { sessionId, path });
        await navigateTo(currentPath);
      } catch (e) {
        setError(`Create directory failed: ${String(e)}`);
      }
    },
    [sessionId, currentPath, navigateTo]
  );

  return {
    currentPath,
    entries,
    loading,
    error,
    navigateTo,
    goUp,
    download,
    upload,
    deleteEntry,
    renameEntry,
    createDir,
  };
}
