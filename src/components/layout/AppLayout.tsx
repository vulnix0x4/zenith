import { useState, useCallback, type MutableRefObject } from 'react';
import { v4 as uuid } from 'uuid';
import type { Terminal } from '@xterm/xterm';
import TitleBar from './TitleBar';
import ActivityBar from './ActivityBar';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import MonitorBar from './MonitorBar';
import XTerminal from '../terminal/XTerminal';
import QuickConnect from '../dialogs/QuickConnect';
import { useTabStore } from '../../stores/tabStore';
import { useSshConnection } from '../../hooks/useSshConnection';
import styles from './AppLayout.module.css';

export default function AppLayout() {
  const { tabs, activeTabId, addTab, removeTab } = useTabStore();
  const { connect, write, resize, disconnect, registerTerminal, unregisterTerminal } =
    useSshConnection();
  const [showQuickConnect, setShowQuickConnect] = useState(false);

  const handleNewTab = useCallback(() => {
    setShowQuickConnect(true);
  }, []);

  const handleConnect = useCallback(
    (params: { hostname: string; port: number; username: string; password: string }) => {
      const sessionId = uuid();
      const title = `${params.username}@${params.hostname}`;
      const tabId = addTab(sessionId, title, params.hostname);
      setShowQuickConnect(false);

      // Short delay to let the terminal mount and register
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

  return (
    <div className={styles.layout}>
      <TitleBar />
      <div className={styles.body}>
        <ActivityBar />
        <Sidebar />
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
        onConnect={handleConnect}
      />
    </div>
  );
}
