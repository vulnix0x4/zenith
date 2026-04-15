import { useState, useCallback, useEffect, useMemo, type MutableRefObject } from 'react';
import { v4 as uuid } from 'uuid';
import type { Terminal } from '@xterm/xterm';
import TitleBar from './TitleBar';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import MonitorBar from './MonitorBar';
import XTerminal from '../terminal/XTerminal';
import QuickConnect from '../dialogs/QuickConnect';
import CommandPalette from '../command-palette/CommandPalette';
import PasswordPrompt from '../dialogs/PasswordPrompt';
import { useTabStore } from '../../stores/tabStore';
import { useSessionStore, type Session } from '../../stores/sessionStore';
import { useSshConnection } from '../../hooks/useSshConnection';
import styles from './AppLayout.module.css';

export default function AppLayout() {
  const { tabs, activeTabId, addTab, removeTab } = useTabStore();
  const { sessions, loadSessions } = useSessionStore();
  const { connect, write, resize, disconnect, registerTerminal, unregisterTerminal } =
    useSshConnection();

  const [showQuickConnect, setShowQuickConnect] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [passwordSession, setPasswordSession] = useState<Session | null>(null);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Derive connected session IDs from tabs
  const connectedSessionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of tabs) {
      if (tab.connected) {
        // The tab.sessionId is a generated UUID per connection, not the saved session id.
        // We need to map back. We store the saved session id in the tab title pattern.
        // Instead, let's track saved-session ids via a convention:
        // We'll match sessions by looking at hostname in tabs.
        for (const s of sessions) {
          const label = `${s.username}@${s.hostname}`;
          if (tab.title === label || tab.title === s.name) {
            ids.add(s.id);
          }
        }
      }
    }
    return ids;
  }, [tabs, sessions]);

  const handleNewTab = useCallback(() => {
    setShowQuickConnect(true);
  }, []);

  // Quick-connect flow (no saved session, password provided inline)
  const handleQuickConnect = useCallback(
    (params: { hostname: string; port: number; username: string; password: string }) => {
      const sessionId = uuid();
      const title = `${params.username}@${params.hostname}`;
      const tabId = addTab(sessionId, title, params.hostname);
      setShowQuickConnect(false);

      setTimeout(() => {
        connect(tabId, {
          sessionId,
          hostname: params.hostname,
          port: params.port,
          username: params.username,
          password: params.password,
        });
      }, 100);
    },
    [addTab, connect]
  );

  // Connect from a saved session -- prompt for password if auth method is password
  const handleSessionConnect = useCallback(
    (session: Session) => {
      if (session.authMethod === 'password') {
        setPasswordSession(session);
      } else {
        // Private key auth -- connect with empty password
        const sessionId = uuid();
        const title = `${session.username}@${session.hostname}`;
        const tabId = addTab(sessionId, title, session.hostname);

        setTimeout(() => {
          connect(tabId, {
            sessionId,
            hostname: session.hostname,
            port: session.port,
            username: session.username,
            password: '',
          });
        }, 100);
      }
    },
    [addTab, connect]
  );

  // After password is provided for a saved session
  const handlePasswordSubmit = useCallback(
    (password: string) => {
      if (!passwordSession) return;
      const session = passwordSession;
      setPasswordSession(null);

      const sessionId = uuid();
      const title = `${session.username}@${session.hostname}`;
      const tabId = addTab(sessionId, title, session.hostname);

      setTimeout(() => {
        connect(tabId, {
          sessionId,
          hostname: session.hostname,
          port: session.port,
          username: session.username,
          password,
        });
      }, 100);
    },
    [passwordSession, addTab, connect]
  );

  const handleTabClose = useCallback(
    (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        disconnect(tab.sessionId);
        unregisterTerminal(tabId);
      }
      removeTab(tabId);
    },
    [tabs, disconnect, unregisterTerminal, removeTab]
  );

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={styles.layout}>
      <TitleBar onSearchClick={() => setShowPalette(true)} />
      <div className={styles.body}>
        <ActivityBar />
        <Sidebar
          onConnect={handleSessionConnect}
          connectedSessionIds={connectedSessionIds}
        />
        <div className={styles.mainArea}>
          <TabBar onNewTab={handleNewTab} onCloseTab={handleTabClose} />
          <div className={styles.terminalArea}>
            {tabs.length === 0 && (
              <div className={styles.placeholder}>
                <div className={styles.placeholderLogo}>ZENITH</div>
                <div className={styles.placeholderHint}>
                  Double-click a session or press + to connect
                </div>
              </div>
            )}
            {tabs.map((tab) => (
              <div
                key={tab.id}
                style={{
                  display: tab.id === activeTabId ? 'block' : 'none',
                  width: '100%',
                  height: '100%',
                }}
              >
                <XTerminal
                  onData={(data) => write(tab.sessionId, data)}
                  onResize={(cols, rows) => resize(tab.sessionId, cols, rows)}
                  terminalRef={
                    {
                      get current() {
                        return null;
                      },
                      set current(term: Terminal | null) {
                        if (term) registerTerminal(tab.id, term);
                      },
                    } as MutableRefObject<Terminal | null>
                  }
                />
              </div>
            ))}
          </div>
          <MonitorBar />
        </div>
      </div>
      <QuickConnect
        open={showQuickConnect}
        onClose={() => setShowQuickConnect(false)}
        onConnect={handleQuickConnect}
      />
      <CommandPalette
        open={showPalette}
        onClose={() => setShowPalette(false)}
        onSelectSession={handleSessionConnect}
        connectedSessionIds={connectedSessionIds}
      />
      <PasswordPrompt
        open={passwordSession !== null}
        sessionName={passwordSession?.name ?? ''}
        onClose={() => setPasswordSession(null)}
        onSubmit={handlePasswordSubmit}
      />
    </div>
  );
}
