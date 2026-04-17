import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useTabStore,
  leavesOf,
  tabTitleFor,
  type Tab,
} from '../../stores/tabStore';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './TabBar.module.css';

interface TabBarProps {
  onNewTab: () => void;
  onCloseTab: (id: string) => void;
  onSearchClick?: () => void;
  /** Called when the user starts dragging a tab. Parent owns the global
   *  drag state so the drop overlay in the terminal area can react. */
  onTabDragStart?: (tabId: string) => void;
  onTabDragEnd?: () => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  tabId: string;
}

/** A tab is "connected" when any of its leaves are connected, and shows
 *  activity when any non-focused leaf has activity. Status indicator is the
 *  union view across the whole tab. */
function tabConnectionState(tab: Tab): { connected: boolean; hasActivity: boolean } {
  let connected = false;
  let hasActivity = false;
  for (const l of leavesOf(tab.pane)) {
    if (l.connected) connected = true;
    if (l.hasActivity) hasActivity = true;
  }
  return { connected, hasActivity };
}

export default function TabBar({
  onNewTab,
  onCloseTab,
  onSearchClick,
  onTabDragStart,
  onTabDragEnd,
}: TabBarProps) {
  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const renameTab = useTabStore((s) => s.renameTab);
  const sessions = useSessionStore((s) => s.sessions);
  const saveSession = useSessionStore((s) => s.saveSession);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const startRename = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      setRenamingTabId(tabId);
      setRenameValue(tabTitleFor(tab));
      setContextMenu(null);
    },
    [tabs]
  );

  // Commit rename: update the focused leaf's title and -- if it came from a
  // saved session -- persist to the session record so the new name shows up
  // in the sidebar list and survives reconnects.
  const commitRename = useCallback(() => {
    const id = renamingTabId;
    if (!id) return;
    const next = renameValue.trim();
    if (next.length === 0) {
      setRenamingTabId(null);
      return;
    }
    renameTab(id, next);
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      const focusedLeaf = leavesOf(tab.pane).find((l) => l.leafId === tab.focusedLeafId);
      if (focusedLeaf?.savedSessionId) {
        const session = sessions.find((s) => s.id === focusedLeaf.savedSessionId);
        if (session && session.name !== next) {
          saveSession({ ...session, name: next });
        }
      }
    }
    setRenamingTabId(null);
  }, [renamingTabId, renameValue, renameTab, tabs, sessions, saveSession]);

  useEffect(() => {
    if (renamingTabId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingTabId]);

  useEffect(() => {
    if (!contextMenu) return;
    const onDown = () => setContextMenu(null);
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [contextMenu]);

  return (
    <div className={styles.tabBar}>
      {tabs.map((tab) => {
        const { connected, hasActivity } = tabConnectionState(tab);
        const title = tabTitleFor(tab);
        return (
          <button
            key={tab.id}
            className={`${styles.tab} ${tab.id === activeTabId ? styles.tabActive : ''} ${
              hasActivity && tab.id !== activeTabId ? styles.hasActivity : ''
            }`}
            draggable
            onDragStart={(e) => {
              // dataTransfer payload isn't strictly needed (parent tracks
              // source via onTabDragStart) but Chrome won't fire dragover on
              // empty payloads in some setups -- include the id as a marker.
              e.dataTransfer.setData('text/plain', tab.id);
              e.dataTransfer.effectAllowed = 'move';
              onTabDragStart?.(tab.id);
            }}
            onDragEnd={() => onTabDragEnd?.()}
            onClick={() => setActiveTab(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setActiveTab(tab.id);
              setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename(tab.id);
            }}
          >
            <span
              className={`${styles.statusDot} ${
                connected ? styles.statusConnected : styles.statusDisconnected
              }`}
            />
            {renamingTabId === tab.id ? (
              <input
                ref={renameInputRef}
                className={styles.renameInput}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingTabId(null);
                }}
              />
            ) : (
              <span>{title}</span>
            )}
            <span
              className={styles.tabClose}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              &times;
            </span>
          </button>
        );
      })}
      <div className={styles.actions}>
        <button className={styles.actionButton} title="Search (Ctrl+K)" onClick={onSearchClick}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <button className={styles.actionButton} title="New Tab" onClick={onNewTab}>
          +
        </button>
      </div>
      {contextMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className={styles.contextItem}
            onClick={() => startRename(contextMenu.tabId)}
          >
            Rename
          </button>
          <button
            className={styles.contextItem}
            onClick={() => {
              onCloseTab(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            Close tab
          </button>
        </div>
      )}
    </div>
  );
}
