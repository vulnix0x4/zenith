import { useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open } from '@tauri-apps/plugin-dialog';

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: string | null;
  permissions: string | null;
}

export function useSftp(sessionId: string | null) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef<Set<string>>(new Set());

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
      try {
        await invoke('sftp_download', {
          sessionId,
          remotePath,
          localPath,
        });
      } catch (e) {
        setError(`Download failed: ${String(e)}`);
      }
    },
    [sessionId]
  );

  const upload = useCallback(async () => {
    if (!sessionId) return;
    const selected = await open({
      multiple: false,
      title: 'Select file to upload',
    });
    if (!selected) return;
    const localPath = typeof selected === 'string' ? selected : selected;
    const fileName = String(localPath).split('/').pop() ?? 'upload';
    const remotePath = currentPath.endsWith('/')
      ? `${currentPath}${fileName}`
      : `${currentPath}/${fileName}`;
    try {
      await invoke('sftp_upload', {
        sessionId,
        localPath: String(localPath),
        remotePath,
      });
      // Refresh listing
      await navigateTo(currentPath);
    } catch (e) {
      setError(`Upload failed: ${String(e)}`);
    }
  }, [sessionId, currentPath, navigateTo]);

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
