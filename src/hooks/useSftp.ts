import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';
import { useSftpStore } from '../stores/sftpStore';
import { joinRemote, basename } from '../utils/remotePath';
import {
  collectDroppedItems,
  type DroppedFile,
} from '../utils/droppedItems';

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

interface UploadDirReport {
  uploaded: number;
  skipped: number;
}

/** Backend returns this exact string in the error message when an upload
 *  is refused because the remote path already exists. Must stay in sync
 *  with `FILE_EXISTS_MARKER` in `src-tauri/src/sftp/errors.rs`. */
const FILE_EXISTS_MARKER = 'FILE_EXISTS';

/** Tristate decision for the bulk-overwrite prompt. `all` and `none` short-
 *  circuit the prompt for the rest of the batch so the user isn't asked once
 *  per file when dropping a folder. */
type OverwriteChoice = 'yes' | 'no' | 'all' | 'none';

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

  /** Upload a single local-path file. Surfaces the existing-file refusal as
   *  a thrown `FILE_EXISTS_MARKER` error so callers can pick between
   *  prompting once vs. running a "yes to all" loop. */
  const uploadOnePath = useCallback(
    async (
      localPath: string,
      remotePath: string,
      fileName: string,
      overwrite: boolean,
      size?: number
    ): Promise<boolean> => {
      const tid = startTransfer({
        filename: fileName,
        direction: 'up',
        size,
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
        if (msg.includes(FILE_EXISTS_MARKER)) {
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

  /** Upload a single in-memory blob. Used by the drag-and-drop path -- the
   *  browser hands us `File` objects with no OS path, so we ship the bytes
   *  through IPC instead. */
  const uploadOneData = useCallback(
    async (
      bytes: Uint8Array,
      remotePath: string,
      fileName: string,
      overwrite: boolean
    ): Promise<boolean> => {
      const tid = startTransfer({
        filename: fileName,
        direction: 'up',
        size: bytes.byteLength,
      });
      try {
        await invoke('sftp_upload_data', {
          sessionId,
          remotePath,
          // Tauri serializes Vec<u8> as a JS number array; passing a typed
          // array results in `[object Object]` on the Rust side. Array.from
          // explodes the bytes into a regular array.
          data: Array.from(bytes),
          overwrite,
        });
        finishTransfer(tid);
        return true;
      } catch (e) {
        const msg = String(e);
        if (msg.includes(FILE_EXISTS_MARKER)) {
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

  /** Idempotent mkdir wrapper. Used during drop-tree replication so each
   *  intermediate directory gets created once and existing dirs don't error. */
  const ensureRemoteDir = useCallback(
    async (remotePath: string): Promise<boolean> => {
      try {
        await invoke('sftp_ensure_dir', { sessionId, path: remotePath });
        return true;
      } catch (e) {
        setError(`Create directory failed: ${String(e)}`);
        return false;
      }
    },
    [sessionId]
  );

  /** Run the bulk-overwrite prompt for a path the user has already conflicted
   *  on. `previous` lets a "yes/no to all" answer short-circuit subsequent
   *  prompts in the same batch. Returns the resolved choice. */
  const confirmOverwrite = useCallback(
    (fileName: string, hasMore: boolean, previous: OverwriteChoice | null): OverwriteChoice => {
      if (previous === 'all') return 'all';
      if (previous === 'none') return 'none';
      // Plain text confirm() is intentional: a custom modal is overkill,
      // and a native prompt is unambiguous on every OS.
      const suffix = hasMore ? '\n(OK = overwrite, Cancel = skip)' : '';
      const ok = window.confirm(
        `"${fileName}" already exists. Overwrite?${suffix}`
      );
      return ok ? 'yes' : 'no';
    },
    []
  );

  /** Upload a list of local-path files into the current remote dir, with a
   *  single overwrite prompt per existing file (and "all/none" short-
   *  circuits if the user is dragging in many files at once). */
  const uploadPaths = useCallback(
    async (localPaths: string[]) => {
      if (!sessionId || localPaths.length === 0) return;
      let bulkChoice: OverwriteChoice | null = null;
      for (let i = 0; i < localPaths.length; i++) {
        const localPath = localPaths[i];
        const fileName = basename(localPath);
        const remotePath = joinRemote(currentPath, fileName);
        try {
          await uploadOnePath(localPath, remotePath, fileName, false);
        } catch (e) {
          if (!(e instanceof Error) || e.message !== FILE_EXISTS_MARKER) continue;
          const hasMore = i < localPaths.length - 1;
          let choice = confirmOverwrite(fileName, hasMore, bulkChoice);
          // Promote single-file decisions into batch decisions when the user
          // holds Shift on the prompt? Native confirm() can't surface that.
          // Instead we let the FIRST conflict's answer apply to all remaining
          // ones if the user clicks OK and there are more files: "ok-all".
          // Keeping it simple: yes/no apply per-file, all/none must be set
          // explicitly by callers (currently unused here).
          if (choice === 'yes') {
            await uploadOnePath(localPath, remotePath, fileName, true);
          } else if (choice === 'all') {
            await uploadOnePath(localPath, remotePath, fileName, true);
            bulkChoice = 'all';
          } else if (choice === 'none') {
            bulkChoice = 'none';
          }
        }
      }
      await navigateTo(currentPath);
    },
    [sessionId, currentPath, navigateTo, uploadOnePath, confirmOverwrite]
  );

  /** Toolbar "Upload file" handler. Multi-select via the OS dialog. */
  const upload = useCallback(async () => {
    if (!sessionId) return;
    const selected = await open({
      multiple: true,
      title: 'Select files to upload',
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    await uploadPaths(paths.map(String));
  }, [sessionId, uploadPaths]);

  /** Toolbar "Upload folder" handler. Server-side recursion via Rust. */
  const uploadFolder = useCallback(async () => {
    if (!sessionId) return;
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select folder to upload',
    });
    if (!selected || Array.isArray(selected)) return;
    const localDir = String(selected);
    const folderName = basename(localDir);
    const tid = startTransfer({
      filename: folderName + '/',
      direction: 'up',
    });
    try {
      const report = await invoke<UploadDirReport>('sftp_upload_dir', {
        sessionId,
        localDir,
        remoteParentDir: currentPath,
        // Folder uploads always overwrite -- prompting per-file would be
        // unbearable on a tree with hundreds of conflicts, and this matches
        // `scp -r` semantics.
        overwrite: true,
      });
      finishTransfer(tid);
      if (report.skipped > 0) {
        setError(
          `Folder uploaded with ${report.skipped} file(s) skipped (read or write errors).`
        );
      }
      await navigateTo(currentPath);
    } catch (e) {
      const msg = String(e);
      errorTransfer(tid, msg);
      setError(`Folder upload failed: ${msg}`);
    }
  }, [sessionId, currentPath, navigateTo, startTransfer, finishTransfer, errorTransfer]);

  /** Drop handler. Walks the drop's `DataTransferItemList`, replicates
   *  every directory under `currentPath`, and uploads each file's bytes via
   *  the byte-stream IPC command. */
  const uploadDropped = useCallback(
    async (items: DataTransferItemList | FileList | null) => {
      if (!sessionId || !items) return;
      const collected = await collectDroppedItems(items);
      if (collected.length === 0) return;

      // First pass: ensure every directory along every dropped file's path
      // exists on the remote. We dedupe so a tree with many siblings doesn't
      // re-mkdir the same parents per file.
      const dirSet = new Set<string>();
      for (const file of collected) {
        const parts = file.relativePath.split('/');
        parts.pop(); // strip filename, keep dirs
        let acc = currentPath;
        for (const part of parts) {
          if (!part) continue;
          acc = joinRemote(acc, part);
          dirSet.add(acc);
        }
      }
      // Sort by depth so parents are created before children. Same length =>
      // any order works.
      const dirs = [...dirSet].sort(
        (a, b) => a.split('/').length - b.split('/').length
      );
      for (const dir of dirs) {
        const ok = await ensureRemoteDir(dir);
        if (!ok) return;
      }

      // For folder drops we overwrite silently -- per-file prompts on a
      // tree with hundreds of conflicts is a worse UX than the rare
      // miscopy. Detection: any item arriving with a sub-path means at
      // least one folder was in the drop. Loose file drops still prompt.
      const hasFolder = collected.some((f) => f.relativePath.includes('/'));

      let bulkChoice: OverwriteChoice | null = null;
      for (let i = 0; i < collected.length; i++) {
        const file = collected[i];
        const remotePath = joinRemote(currentPath, file.relativePath);
        const bytes = new Uint8Array(await file.file.arrayBuffer());

        if (hasFolder) {
          await uploadOneData(bytes, remotePath, file.file.name, true);
          continue;
        }

        try {
          await uploadOneData(bytes, remotePath, file.file.name, false);
        } catch (e) {
          if (!(e instanceof Error) || e.message !== FILE_EXISTS_MARKER) continue;
          const hasMore = i < collected.length - 1;
          const choice = confirmOverwrite(file.file.name, hasMore, bulkChoice);
          if (choice === 'yes') {
            await uploadOneData(bytes, remotePath, file.file.name, true);
          } else if (choice === 'all') {
            await uploadOneData(bytes, remotePath, file.file.name, true);
            bulkChoice = 'all';
          } else if (choice === 'none') {
            bulkChoice = 'none';
          }
        }
      }
      await navigateTo(currentPath);
    },
    [sessionId, currentPath, navigateTo, ensureRemoteDir, uploadOneData, confirmOverwrite]
  );

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
      const path = joinRemote(currentPath, name);
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
    uploadFolder,
    uploadDropped,
    deleteEntry,
    renameEntry,
    createDir,
  };
}

export type { DroppedFile };
