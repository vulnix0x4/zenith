# Zenith Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Zenith — a cross-platform SSH terminal with session management, SFTP file browser, and system monitoring, styled with a cyberpunk/neon aesthetic.

**Architecture:** Tauri v2 (Rust backend) + React/TypeScript frontend. Rust handles SSH (russh), SFTP (russh-sftp), credential storage (keyring plugin), and system monitoring. React handles all UI via xterm.js for terminals and custom components for everything else. Communication via Tauri IPC commands and channels.

**Tech Stack:** Tauri 2.x, React 18+, TypeScript, Vite, russh 0.60, russh-sftp 2.1, russh-keys, tokio, xterm.js 6.x (@xterm/xterm), @xterm/addon-fit, @xterm/addon-webgl, @xterm/addon-search, Zustand (state), tauri-plugin-keyring, tauri-plugin-dialog

**Spec:** `docs/superpowers/specs/2026-04-15-zenith-design.md`

---

## Phase 1: Project Foundation

### Task 1: Scaffold Tauri + React + TypeScript Project

**Files:**
- Create: project root (scaffolded by create-tauri-app)
- Modify: `src-tauri/Cargo.toml` (add dependencies)
- Modify: `package.json` (add npm dependencies)
- Modify: `src-tauri/tauri.conf.json` (configure app identity)

- [ ] **Step 1: Scaffold the project**

```bash
cd /Users/vulnix/Documents/mobaxterm2.0
npm create tauri-app@latest -- --yes zenith-app -m npm -t react-ts
```

This creates a `zenith-app/` directory. Move its contents to the project root:

```bash
shopt -s dotglob
mv zenith-app/* .
mv zenith-app/.* . 2>/dev/null || true
rmdir zenith-app
```

- [ ] **Step 2: Configure Tauri identity**

Edit `src-tauri/tauri.conf.json` — set these top-level fields:

```json
{
  "productName": "Zenith",
  "identifier": "com.zenith.terminal",
  "version": "0.1.0"
}
```

- [ ] **Step 3: Add Rust dependencies**

Edit `src-tauri/Cargo.toml` — replace the `[dependencies]` section:

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
tauri-plugin-keyring = "0.1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
russh = "0.60"
russh-keys = "0.46"
russh-sftp = "2.1"
tokio = { version = "1", features = ["rt-multi-thread", "net", "io-util", "sync", "time", "macros"] }
uuid = { version = "1", features = ["v4", "serde"] }
thiserror = "2"
anyhow = "1"
dirs = "6"
chrono = { version = "0.4", features = ["serde"] }
log = "0.4"
env_logger = "0.11"
```

- [ ] **Step 4: Add npm dependencies**

```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-search zustand uuid
npm install -D @types/uuid
```

- [ ] **Step 5: Verify the project builds and opens a window**

```bash
npm run tauri dev
```

Expected: A Tauri window opens showing the default React template. Close it after verifying.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri + React + TypeScript project with dependencies"
```

---

### Task 2: Cyberpunk Theme + Base CSS

**Files:**
- Create: `src/styles/theme.css`
- Create: `src/styles/global.css`
- Modify: `src/main.tsx` (import styles)
- Delete: `src/styles.css` or `src/App.css` (scaffolded defaults)

- [ ] **Step 1: Create the cyberpunk theme CSS variables**

Create `src/styles/theme.css`:

```css
:root {
  /* Backgrounds */
  --bg-deep: #07070d;
  --bg-base: #0a0a0f;
  --bg-surface: #0d0d1a;
  --bg-elevated: #1a1a2e;

  /* Accent colors */
  --cyan: #00ffc8;
  --cyan-dim: #00ffc844;
  --cyan-glow: #00ffc822;
  --purple: #7B61FF;
  --purple-dim: #7B61FF44;
  --purple-glow: #7B61FF22;
  --pink: #ff6b9d;
  --pink-dim: #ff6b9d44;
  --pink-glow: #ff6b9d22;
  --blue: #00b4d8;
  --blue-dim: #00b4d844;

  /* Text */
  --text-primary: #e0e0e0;
  --text-secondary: #888;
  --text-dim: #555;
  --text-muted: #333;

  /* Borders */
  --border: #00ffc822;
  --border-subtle: #ffffff08;

  /* Status */
  --status-connected: #00ffc8;
  --status-disconnected: #555;
  --status-error: #ff5f57;

  /* Typography */
  --font-mono: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
  --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* Sizing */
  --activity-bar-width: 42px;
  --sidebar-width: 260px;
  --tab-bar-height: 36px;
  --monitor-bar-height: 32px;
  --titlebar-height: 38px;

  /* Transitions */
  --transition-fast: 0.15s ease;
  --transition-normal: 0.25s ease;
}
```

- [ ] **Step 2: Create global styles**

Create `src/styles/global.css`:

```css
@import './theme.css';

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--text-muted);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-dim);
}

::selection {
  background: var(--cyan-dim);
  color: var(--text-primary);
}

button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-family: inherit;
}

input {
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  padding: 6px 10px;
  outline: none;
  transition: border-color var(--transition-fast);
}

input:focus {
  border-color: var(--cyan-dim);
}

input::placeholder {
  color: var(--text-dim);
}
```

- [ ] **Step 3: Update main.tsx to use new styles**

Replace the contents of `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Delete scaffolded default styles**

Remove any `src/styles.css`, `src/App.css`, or similar default stylesheets created by the scaffold. Remove their imports from any files.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add cyberpunk theme CSS variables and global styles"
```

---

### Task 3: Base App Layout Shell

**Files:**
- Create: `src/components/layout/AppLayout.tsx`
- Create: `src/components/layout/AppLayout.module.css`
- Create: `src/components/layout/TitleBar.tsx`
- Create: `src/components/layout/TitleBar.module.css`
- Create: `src/components/layout/ActivityBar.tsx`
- Create: `src/components/layout/ActivityBar.module.css`
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/layout/Sidebar.module.css`
- Create: `src/components/layout/TabBar.tsx`
- Create: `src/components/layout/TabBar.module.css`
- Create: `src/components/layout/MonitorBar.tsx`
- Create: `src/components/layout/MonitorBar.module.css`
- Create: `src/stores/layoutStore.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the layout state store**

Create `src/stores/layoutStore.ts`:

```ts
import { create } from 'zustand';

export type SidebarPanel = 'sessions' | 'files' | 'monitoring' | 'settings';

interface LayoutState {
  sidebarOpen: boolean;
  sidebarPanel: SidebarPanel;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setSidebarWidth: (width: number) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarOpen: true,
  sidebarPanel: 'sessions',
  sidebarWidth: 260,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarPanel: (panel) =>
    set((s) => ({
      sidebarPanel: panel,
      sidebarOpen: s.sidebarPanel === panel ? !s.sidebarOpen : true,
    })),
  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(500, width)) }),
}));
```

- [ ] **Step 2: Create the TitleBar component**

Create `src/components/layout/TitleBar.module.css`:

```css
.titleBar {
  height: var(--titlebar-height);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 12px;
  -webkit-app-region: drag;
  user-select: none;
}

.logo {
  color: var(--cyan);
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
}

.searchBar {
  flex: 1;
  max-width: 400px;
  margin: 0 auto;
  -webkit-app-region: no-drag;
}

.searchInput {
  width: 100%;
  background: var(--bg-deep);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.searchInput:hover {
  border-color: var(--cyan-dim);
}

.shortcut {
  color: var(--cyan-dim);
  font-family: var(--font-mono);
  font-size: 10px;
}
```

Create `src/components/layout/TitleBar.tsx`:

```tsx
import styles from './TitleBar.module.css';

interface TitleBarProps {
  onSearchClick: () => void;
}

export function TitleBar({ onSearchClick }: TitleBarProps) {
  return (
    <div className={styles.titleBar}>
      <span className={styles.logo}>ZENITH</span>
      <div className={styles.searchBar}>
        <div className={styles.searchInput} onClick={onSearchClick}>
          <span className={styles.shortcut}>⌘K</span>
          <span>Search sessions, commands...</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the ActivityBar component**

Create `src/components/layout/ActivityBar.module.css`:

```css
.activityBar {
  width: var(--activity-bar-width);
  background: var(--bg-deep);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 10px;
  gap: 6px;
  flex-shrink: 0;
}

.icon {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-dim);
  transition: color var(--transition-fast), background var(--transition-fast);
  cursor: pointer;
  position: relative;
}

.icon:hover {
  color: var(--text-secondary);
  background: var(--bg-elevated);
}

.icon.active {
  color: var(--cyan);
  background: var(--cyan-glow);
}

.icon.active::before {
  content: '';
  position: absolute;
  left: -6px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--cyan);
  border-radius: 1px;
}

.spacer {
  flex: 1;
}
```

Create `src/components/layout/ActivityBar.tsx`:

```tsx
import { useLayoutStore, SidebarPanel } from '../../stores/layoutStore';
import styles from './ActivityBar.module.css';

const icons: { panel: SidebarPanel; icon: string; label: string }[] = [
  { panel: 'sessions', icon: '⌂', label: 'Sessions' },
  { panel: 'files', icon: '📁', label: 'Files' },
  { panel: 'monitoring', icon: '📊', label: 'Monitoring' },
];

export function ActivityBar() {
  const { sidebarPanel, sidebarOpen, setSidebarPanel } = useLayoutStore();

  return (
    <div className={styles.activityBar}>
      {icons.map(({ panel, icon, label }) => (
        <button
          key={panel}
          className={`${styles.icon} ${sidebarOpen && sidebarPanel === panel ? styles.active : ''}`}
          onClick={() => setSidebarPanel(panel)}
          title={label}
        >
          {icon}
        </button>
      ))}
      <div className={styles.spacer} />
      <button
        className={`${styles.icon} ${sidebarOpen && sidebarPanel === 'settings' ? styles.active : ''}`}
        onClick={() => setSidebarPanel('settings')}
        title="Settings"
      >
        ⚙
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create the Sidebar shell component**

Create `src/components/layout/Sidebar.module.css`:

```css
.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width var(--transition-normal);
  flex-shrink: 0;
}

.sidebar.collapsed {
  width: 0;
  border-right: none;
}

.header {
  padding: 10px 12px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--cyan);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
```

Create `src/components/layout/Sidebar.tsx`:

```tsx
import { useLayoutStore } from '../../stores/layoutStore';
import styles from './Sidebar.module.css';

const panelTitles = {
  sessions: 'Sessions',
  files: 'Files',
  monitoring: 'Monitoring',
  settings: 'Settings',
} as const;

export function Sidebar() {
  const { sidebarOpen, sidebarPanel } = useLayoutStore();

  return (
    <div className={`${styles.sidebar} ${!sidebarOpen ? styles.collapsed : ''}`}>
      <div className={styles.header}>{panelTitles[sidebarPanel]}</div>
      <div className={styles.content}>
        {/* Panel content will be added in later tasks */}
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          {panelTitles[sidebarPanel]} panel
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create the TabBar component**

Create `src/components/layout/TabBar.module.css`:

```css
.tabBar {
  height: var(--tab-bar-height);
  background: var(--bg-deep);
  display: flex;
  align-items: stretch;
  padding: 4px 4px 0;
  gap: 2px;
  overflow-x: auto;
  flex-shrink: 0;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-deep);
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  white-space: nowrap;
  transition: color var(--transition-fast), background var(--transition-fast);
  border: 1px solid transparent;
  border-bottom: none;
}

.tab:hover {
  color: var(--text-secondary);
  background: var(--bg-surface);
}

.tab.active {
  color: var(--cyan);
  background: var(--bg-surface);
  border-color: var(--border);
}

.statusDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-disconnected);
  flex-shrink: 0;
}

.statusDot.connected {
  background: var(--status-connected);
  box-shadow: 0 0 6px var(--cyan-glow);
}

.closeBtn {
  font-size: 14px;
  color: var(--text-muted);
  padding: 0 2px;
  line-height: 1;
}

.closeBtn:hover {
  color: var(--status-error);
}

.newTabBtn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  color: var(--cyan-dim);
  font-size: 16px;
  cursor: pointer;
}

.newTabBtn:hover {
  color: var(--cyan);
}

.spacer {
  flex: 1;
}

.splitBtn {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  margin: auto 4px auto 0;
  font-size: 11px;
  color: var(--text-dim);
  border: 1px solid var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
}

.splitBtn:hover {
  color: var(--text-secondary);
  border-color: var(--text-dim);
}
```

Create `src/components/layout/TabBar.tsx`:

```tsx
import styles from './TabBar.module.css';

export interface TabInfo {
  id: string;
  title: string;
  connected: boolean;
}

interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
}

export function TabBar({ tabs, activeTabId, onTabClick, onTabClose, onNewTab }: TabBarProps) {
  return (
    <div className={styles.tabBar}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`${styles.tab} ${tab.id === activeTabId ? styles.active : ''}`}
          onClick={() => onTabClick(tab.id)}
        >
          <span className={`${styles.statusDot} ${tab.connected ? styles.connected : ''}`} />
          <span>{tab.title}</span>
          <button
            className={styles.closeBtn}
            onClick={(e) => { e.stopPropagation(); onTabClose(tab.id); }}
          >
            ×
          </button>
        </div>
      ))}
      <button className={styles.newTabBtn} onClick={onNewTab} title="New Tab">
        +
      </button>
      <div className={styles.spacer} />
      <button className={styles.splitBtn} title="Split Terminal">
        ⫼ Split
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Create the MonitorBar placeholder component**

Create `src/components/layout/MonitorBar.module.css`:

```css
.monitorBar {
  height: var(--monitor-bar-height);
  background: var(--bg-surface);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 12px;
  font-family: var(--font-mono);
  font-size: 11px;
  flex-shrink: 0;
}

.metric {
  display: flex;
  align-items: center;
  gap: 4px;
}

.label {
  font-weight: 600;
}

.bar {
  display: flex;
  gap: 1px;
}

.barFilled {
  width: 5px;
  height: 10px;
  border-radius: 1px;
}

.barEmpty {
  width: 5px;
  height: 10px;
  border-radius: 1px;
  background: var(--text-muted);
}

.value {
  min-width: 32px;
}

.spacer {
  flex: 1;
}

.hostname {
  color: var(--text-dim);
}
```

Create `src/components/layout/MonitorBar.tsx`:

```tsx
import styles from './MonitorBar.module.css';

interface MetricBarProps {
  label: string;
  value: number;
  color: string;
}

function MetricBar({ label, value, color }: MetricBarProps) {
  const filled = Math.round(value / 10);
  const empty = 10 - filled;

  return (
    <div className={styles.metric}>
      <span className={styles.label} style={{ color }}>
        {label}
      </span>
      <div className={styles.bar}>
        {Array.from({ length: filled }, (_, i) => (
          <div key={`f${i}`} className={styles.barFilled} style={{ background: color }} />
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <div key={`e${i}`} className={styles.barEmpty} />
        ))}
      </div>
      <span className={styles.value} style={{ color }}>
        {value}%
      </span>
    </div>
  );
}

export interface MonitorData {
  cpu: number;
  ram: number;
  networkUp: string;
  networkDown: string;
  disk: number;
  uptime: string;
  hostname: string;
}

interface MonitorBarProps {
  data: MonitorData | null;
}

export function MonitorBar({ data }: MonitorBarProps) {
  if (!data) {
    return (
      <div className={styles.monitorBar}>
        <span className={styles.hostname}>No active connection</span>
      </div>
    );
  }

  return (
    <div className={styles.monitorBar}>
      <MetricBar label="CPU" value={data.cpu} color="var(--cyan)" />
      <MetricBar label="RAM" value={data.ram} color="var(--purple)" />
      <div className={styles.metric}>
        <span style={{ color: 'var(--pink)' }}>↑{data.networkUp} ↓{data.networkDown}</span>
      </div>
      <MetricBar label="DSK" value={data.disk} color="var(--blue)" />
      <div className={styles.spacer} />
      <span className={styles.hostname}>{data.hostname} · UP {data.uptime}</span>
    </div>
  );
}
```

- [ ] **Step 7: Create the AppLayout that composes everything**

Create `src/components/layout/AppLayout.module.css`:

```css
.app {
  height: 100vh;
  width: 100vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.mainArea {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.terminalArea {
  flex: 1;
  background: var(--bg-base);
  position: relative;
  overflow: hidden;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 14px;
  flex-direction: column;
  gap: 8px;
}

.placeholderLogo {
  color: var(--cyan);
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 4px;
}
```

Create `src/components/layout/AppLayout.tsx`:

```tsx
import { useState } from 'react';
import { TitleBar } from './TitleBar';
import { ActivityBar } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { TabBar, TabInfo } from './TabBar';
import { MonitorBar } from './MonitorBar';
import styles from './AppLayout.module.css';

export function AppLayout() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const handleTabClose = (id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
    if (activeTabId === id) {
      setActiveTabId(tabs.length > 1 ? tabs[0].id : null);
    }
  };

  const handleNewTab = () => {
    // Placeholder — will open session dialog later
  };

  return (
    <div className={styles.app}>
      <TitleBar onSearchClick={() => {}} />
      <div className={styles.body}>
        <ActivityBar />
        <Sidebar />
        <div className={styles.mainArea}>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTabId}
            onTabClose={handleTabClose}
            onNewTab={handleNewTab}
          />
          <div className={styles.terminalArea}>
            {tabs.length === 0 ? (
              <div className={styles.placeholder}>
                <div className={styles.placeholderLogo}>ZENITH</div>
                <span>Double-click a session or press + to connect</span>
              </div>
            ) : (
              <div>{/* Terminal components will render here */}</div>
            )}
          </div>
          <MonitorBar data={null} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Wire AppLayout into App.tsx**

Replace contents of `src/App.tsx`:

```tsx
import { AppLayout } from './components/layout/AppLayout';

export default function App() {
  return <AppLayout />;
}
```

- [ ] **Step 9: Verify the layout renders**

```bash
npm run tauri dev
```

Expected: Window opens showing the cyberpunk-themed layout with:
- Title bar with "ZENITH" logo and search bar
- Activity bar on the left with icons
- Collapsible sidebar
- Tab bar (empty)
- "ZENITH" placeholder in the terminal area
- Monitor bar at the bottom showing "No active connection"

Click the activity bar icons to verify sidebar panel switching works.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add cyberpunk base layout with activity bar, sidebar, tabs, and monitor bar"
```

---

## Phase 2: SSH + Terminal Core

### Task 4: Rust SSH Connection Manager

**Files:**
- Create: `src-tauri/src/ssh/mod.rs`
- Create: `src-tauri/src/ssh/connection.rs`
- Create: `src-tauri/src/ssh/types.rs`
- Modify: `src-tauri/src/lib.rs` (add module, register commands)

- [ ] **Step 1: Create the SSH types module**

Create `src-tauri/src/ssh/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConnectRequest {
    pub session_id: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum AuthMethod {
    Password { password: String },
    PrivateKey { key_path: String, passphrase: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum SshEvent {
    Connected,
    Data { bytes: Vec<u8> },
    Error { message: String },
    Disconnected,
}
```

- [ ] **Step 2: Create the SSH connection module**

Create `src-tauri/src/ssh/connection.rs`:

```rust
use anyhow::Result;
use russh::keys::*;
use russh::*;
use std::sync::Arc;
use tokio::sync::mpsc;

use super::types::*;

struct ClientHandler;

#[async_trait::async_trait]
impl client::Handler for ClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO: Implement known_hosts checking in a future task
        Ok(true)
    }
}

pub struct SshConnection {
    handle: client::Handle<ClientHandler>,
    channel: Channel<client::Msg>,
}

impl SshConnection {
    pub async fn connect(request: &SshConnectRequest) -> Result<Self> {
        let config = Arc::new(client::Config {
            ..Default::default()
        });

        let handler = ClientHandler;
        let mut handle = client::connect(
            config,
            (request.hostname.as_str(), request.port),
            handler,
        )
        .await?;

        // Authenticate
        let auth_result = match &request.auth_method {
            AuthMethod::Password { password } => {
                handle
                    .authenticate_password(&request.username, password)
                    .await?
            }
            AuthMethod::PrivateKey { key_path, passphrase } => {
                let key = load_secret_key(key_path, passphrase.as_deref())?;
                let key_with_alg = PrivateKeyWithHashAlg::new(
                    Arc::new(key),
                    handle.best_supported_rsa_hash().await?.flatten(),
                );
                handle
                    .authenticate_publickey(&request.username, key_with_alg)
                    .await?
            }
        };

        if !auth_result.success() {
            anyhow::bail!("Authentication failed");
        }

        // Open channel and request PTY
        let mut channel = handle.channel_open_session().await?;
        channel
            .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
            .await?;
        channel.request_shell(true).await?;

        Ok(Self { handle, channel })
    }

    pub async fn write(&self, data: &[u8]) -> Result<()> {
        self.channel.data(data).await?;
        Ok(())
    }

    pub async fn resize(&self, cols: u32, rows: u32) -> Result<()> {
        self.channel.window_change(cols, rows, 0, 0).await?;
        Ok(())
    }

    pub async fn read_loop(
        mut self,
        tx: mpsc::UnboundedSender<SshEvent>,
    ) {
        loop {
            match self.channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    let _ = tx.send(SshEvent::Data {
                        bytes: data.to_vec(),
                    });
                }
                Some(ChannelMsg::ExitStatus { .. }) | Some(ChannelMsg::Eof) | None => {
                    let _ = tx.send(SshEvent::Disconnected);
                    break;
                }
                _ => {}
            }
        }
    }

    pub async fn close(self) -> Result<()> {
        self.channel.eof().await?;
        Ok(())
    }
}
```

- [ ] **Step 3: Create the SSH module entry**

Create `src-tauri/src/ssh/mod.rs`:

```rust
pub mod connection;
pub mod types;
```

- [ ] **Step 4: Add async-trait dependency**

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
async-trait = "0.1"
```

- [ ] **Step 5: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: Compiles with no errors (warnings are OK).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Rust SSH connection manager with russh"
```

---

### Task 5: SSH Command Manager (Tauri IPC)

**Files:**
- Create: `src-tauri/src/ssh/manager.rs`
- Create: `src-tauri/src/ssh/commands.rs`
- Modify: `src-tauri/src/ssh/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the connection manager**

This holds all active SSH connections, keyed by session ID.

Create `src-tauri/src/ssh/manager.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

use super::connection::SshConnection;
use super::types::*;

pub struct ConnectionEntry {
    pub connection: Arc<Mutex<Option<SshConnection>>>,
    pub writer: mpsc::UnboundedSender<Vec<u8>>,
}

pub struct SshManager {
    connections: Mutex<HashMap<String, ConnectionEntry>>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(
        &self,
        request: SshConnectRequest,
        event_tx: mpsc::UnboundedSender<SshEvent>,
    ) -> Result<(), String> {
        let session_id = request.session_id.clone();

        let conn = SshConnection::connect(&request)
            .await
            .map_err(|e| format!("SSH connection failed: {e}"))?;

        // Create a channel for writing data to the SSH connection
        let (write_tx, mut write_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        let conn = Arc::new(Mutex::new(Some(conn)));
        let conn_write = conn.clone();
        let conn_read = conn.clone();

        // Spawn write loop
        tokio::spawn(async move {
            while let Some(data) = write_rx.recv().await {
                let guard = conn_write.lock().await;
                if let Some(ref c) = *guard {
                    let _ = c.write(&data).await;
                }
            }
        });

        // Spawn read loop
        let event_tx_clone = event_tx.clone();
        tokio::spawn(async move {
            let conn_taken = {
                let mut guard = conn_read.lock().await;
                guard.take()
            };
            if let Some(c) = conn_taken {
                c.read_loop(event_tx_clone).await;
            }
        });

        let _ = event_tx.send(SshEvent::Connected);

        let mut conns = self.connections.lock().await;
        conns.insert(session_id, ConnectionEntry {
            connection: conn,
            writer: write_tx,
        });

        Ok(())
    }

    pub async fn write(&self, session_id: &str, data: Vec<u8>) -> Result<(), String> {
        let conns = self.connections.lock().await;
        let entry = conns.get(session_id).ok_or("Session not found")?;
        entry.writer.send(data).map_err(|e| format!("Write failed: {e}"))
    }

    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let conns = self.connections.lock().await;
        let entry = conns.get(session_id).ok_or("Session not found")?;
        let guard = entry.connection.lock().await;
        if let Some(ref c) = *guard {
            c.resize(cols, rows).await.map_err(|e| format!("Resize failed: {e}"))?;
        }
        Ok(())
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), String> {
        let mut conns = self.connections.lock().await;
        conns.remove(session_id);
        Ok(())
    }
}
```

- [ ] **Step 2: Create Tauri IPC commands**

Create `src-tauri/src/ssh/commands.rs`:

```rust
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::sync::mpsc;

use super::manager::SshManager;
use super::types::*;

#[tauri::command]
pub async fn ssh_connect(
    request: SshConnectRequest,
    on_event: Channel<SshEvent>,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::unbounded_channel::<SshEvent>();

    // Forward events from the mpsc channel to the Tauri IPC channel
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = on_event.send(event);
        }
    });

    manager.connect(request, tx).await
}

#[tauri::command]
pub async fn ssh_write(
    session_id: String,
    data: Vec<u8>,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    manager.write(&session_id, data).await
}

#[tauri::command]
pub async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    manager.resize(&session_id, cols, rows).await
}

#[tauri::command]
pub async fn ssh_disconnect(
    session_id: String,
    manager: State<'_, SshManager>,
) -> Result<(), String> {
    manager.disconnect(&session_id).await
}
```

- [ ] **Step 3: Update the SSH module entry**

Replace `src-tauri/src/ssh/mod.rs`:

```rust
pub mod commands;
pub mod connection;
pub mod manager;
pub mod types;
```

- [ ] **Step 4: Register everything in lib.rs**

Replace the contents of `src-tauri/src/lib.rs`:

```rust
mod ssh;

use ssh::commands::*;
use ssh::manager::SshManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SshManager::new())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Verify it compiles**

```bash
cd src-tauri && cargo check
```

Expected: Compiles with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add SSH manager with Tauri IPC commands for connect/write/resize/disconnect"
```

---

### Task 6: xterm.js Terminal Component

**Files:**
- Create: `src/components/terminal/XTerminal.tsx`
- Create: `src/components/terminal/XTerminal.module.css`
- Create: `src/components/terminal/cyberpunkTheme.ts`

- [ ] **Step 1: Create the cyberpunk xterm.js theme**

Create `src/components/terminal/cyberpunkTheme.ts`:

```ts
import type { ITheme } from '@xterm/xterm';

export const cyberpunkTheme: ITheme = {
  foreground: '#e0e0e0',
  background: '#0a0a0f',
  cursor: '#00ffc8',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#00ffc844',
  selectionForeground: '#ffffff',
  selectionInactiveBackground: '#00ffc822',

  // ANSI colors
  black: '#0a0a0f',
  red: '#ff6b9d',
  green: '#00ffc8',
  yellow: '#febc2e',
  blue: '#7B61FF',
  magenta: '#c084fc',
  cyan: '#00b4d8',
  white: '#e0e0e0',

  // Bright ANSI
  brightBlack: '#555555',
  brightRed: '#ff8fba',
  brightGreen: '#33ffd6',
  brightYellow: '#ffd060',
  brightBlue: '#9b85ff',
  brightMagenta: '#d4a0ff',
  brightCyan: '#33c8e8',
  brightWhite: '#ffffff',
};
```

- [ ] **Step 2: Create the terminal component**

Create `src/components/terminal/XTerminal.module.css`:

```css
.terminalContainer {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminalContainer :global(.xterm) {
  padding: 8px;
}
```

Create `src/components/terminal/XTerminal.tsx`:

```tsx
import { useRef, useEffect, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { cyberpunkTheme } from './cyberpunkTheme';
import '@xterm/xterm/css/xterm.css';
import styles from './XTerminal.module.css';

interface XTerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  terminalRef?: React.MutableRefObject<Terminal | null>;
}

export function XTerminal({ onData, onResize, terminalRef }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalTermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const write = useCallback((data: string | Uint8Array) => {
    internalTermRef.current?.write(data);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      lineHeight: 1.4,
      scrollback: 10000,
      theme: cyberpunkTheme,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    terminal.open(containerRef.current);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL not available, using default renderer');
    }

    fitAddon.fit();
    internalTermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (terminalRef) {
      terminalRef.current = terminal;
    }

    // User input -> parent
    const dataDisposable = terminal.onData((data) => onData(data));

    // Terminal resize -> parent
    const resizeDisposable = terminal.onResize(({ cols, rows }) => onResize(cols, rows));

    // Select-to-copy
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      }
    });

    // Custom key handler for Ctrl+C copy and Ctrl+V paste
    terminal.attachCustomKeyEventHandler((event) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key === 'c' && terminal.hasSelection()) {
        navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      if (mod && event.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          terminal.paste(text);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeDisposable.dispose();
      selectionDisposable.dispose();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, []);

  return <div ref={containerRef} className={styles.terminalContainer} />;
}

export type { XTerminalProps };
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run build
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add xterm.js terminal component with cyberpunk theme and copy/paste"
```

---

### Task 7: Wire SSH to Terminal via Tauri IPC

**Files:**
- Create: `src/hooks/useSshConnection.ts`
- Create: `src/stores/tabStore.ts`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create the tab store**

Create `src/stores/tabStore.ts`:

```ts
import { create } from 'zustand';
import { v4 as uuid } from 'uuid';

export interface Tab {
  id: string;
  sessionId: string;
  title: string;
  hostname: string;
  connected: boolean;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (sessionId: string, title: string, hostname: string) => string;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setConnected: (id: string, connected: boolean) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (sessionId, title, hostname) => {
    const id = uuid();
    set((s) => ({
      tabs: [...s.tabs, { id, sessionId, title, hostname, connected: false }],
      activeTabId: id,
    }));
    return id;
  },

  removeTab: (id) => {
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      return {
        tabs: remaining,
        activeTabId:
          s.activeTabId === id
            ? remaining.length > 0
              ? remaining[remaining.length - 1].id
              : null
            : s.activeTabId,
      };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setConnected: (id, connected) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, connected } : t)),
    })),
}));
```

- [ ] **Step 2: Create the SSH connection hook**

Create `src/hooks/useSshConnection.ts`:

```ts
import { useRef, useCallback } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';
import { useTabStore } from '../stores/tabStore';

interface SshConnectParams {
  sessionId: string;
  hostname: string;
  port: number;
  username: string;
  authMethod:
    | { type: 'password'; password: string }
    | { type: 'privateKey'; keyPath: string; passphrase?: string };
}

export function useSshConnection() {
  const terminals = useRef<Map<string, Terminal>>(new Map());
  const { setConnected } = useTabStore();

  const registerTerminal = useCallback((tabId: string, terminal: Terminal) => {
    terminals.current.set(tabId, terminal);
  }, []);

  const unregisterTerminal = useCallback((tabId: string) => {
    terminals.current.delete(tabId);
  }, []);

  const connect = useCallback(async (tabId: string, params: SshConnectParams) => {
    const terminal = terminals.current.get(tabId);
    if (!terminal) return;

    const onEvent = new Channel<{ event: string; data?: any }>();
    onEvent.onmessage = (message) => {
      switch (message.event) {
        case 'connected':
          setConnected(tabId, true);
          break;
        case 'data':
          if (message.data?.bytes) {
            terminal.write(new Uint8Array(message.data.bytes));
          }
          break;
        case 'error':
          terminal.writeln(`\r\n\x1b[31mError: ${message.data?.message}\x1b[0m`);
          break;
        case 'disconnected':
          setConnected(tabId, false);
          terminal.writeln('\r\n\x1b[33mDisconnected.\x1b[0m');
          break;
      }
    };

    try {
      await invoke('ssh_connect', {
        request: {
          sessionId: params.sessionId,
          hostname: params.hostname,
          port: params.port,
          username: params.username,
          authMethod: params.authMethod,
        },
        onEvent,
      });
    } catch (e) {
      terminal.writeln(`\r\n\x1b[31mConnection failed: ${e}\x1b[0m`);
    }
  }, [setConnected]);

  const write = useCallback(async (sessionId: string, data: string) => {
    const encoder = new TextEncoder();
    await invoke('ssh_write', {
      sessionId,
      data: Array.from(encoder.encode(data)),
    });
  }, []);

  const resize = useCallback(async (sessionId: string, cols: number, rows: number) => {
    await invoke('ssh_resize', { sessionId, cols, rows });
  }, []);

  const disconnect = useCallback(async (sessionId: string) => {
    await invoke('ssh_disconnect', { sessionId });
  }, []);

  return { connect, write, resize, disconnect, registerTerminal, unregisterTerminal };
}
```

- [ ] **Step 3: Create a quick-connect dialog for testing**

Create `src/components/dialogs/QuickConnect.tsx`:

```tsx
import { useState } from 'react';

interface QuickConnectProps {
  open: boolean;
  onClose: () => void;
  onConnect: (params: {
    hostname: string;
    port: number;
    username: string;
    password: string;
  }) => void;
}

export function QuickConnect({ open, onClose, onConnect }: QuickConnectProps) {
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConnect({ hostname, port: parseInt(port), username, password });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 24, width: 360,
          display: 'flex', flexDirection: 'column', gap: 12,
        }}
      >
        <h3 style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)', margin: 0 }}>
          Quick Connect
        </h3>
        <input placeholder="Hostname" value={hostname} onChange={(e) => setHostname(e.target.value)} required />
        <input placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" style={{
          background: 'var(--cyan-glow)', border: '1px solid var(--cyan-dim)',
          color: 'var(--cyan)', padding: '8px 16px', borderRadius: 6,
          fontFamily: 'var(--font-mono)', fontWeight: 600, cursor: 'pointer',
        }}>
          Connect
        </button>
      </form>
    </div>
  );
}
```

Create `src/components/dialogs/QuickConnect.module.css`: (empty placeholder — styles are inline above for speed)

- [ ] **Step 4: Update AppLayout to wire everything together**

Replace `src/components/layout/AppLayout.tsx`:

```tsx
import { useState, useRef, useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { Terminal } from '@xterm/xterm';
import { TitleBar } from './TitleBar';
import { ActivityBar } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { MonitorBar } from './MonitorBar';
import { XTerminal } from '../terminal/XTerminal';
import { QuickConnect } from '../dialogs/QuickConnect';
import { useSshConnection } from '../../hooks/useSshConnection';
import { useTabStore } from '../../stores/tabStore';
import styles from './AppLayout.module.css';

export function AppLayout() {
  const { tabs, activeTabId, addTab, removeTab, setActiveTab } = useTabStore();
  const { connect, write, resize, disconnect, registerTerminal, unregisterTerminal } = useSshConnection();
  const [showQuickConnect, setShowQuickConnect] = useState(false);

  const handleNewTab = () => {
    setShowQuickConnect(true);
  };

  const handleConnect = useCallback(async (params: {
    hostname: string;
    port: number;
    username: string;
    password: string;
  }) => {
    const sessionId = uuid();
    const tabId = addTab(sessionId, params.hostname, params.hostname);

    // Small delay so the terminal component mounts first
    setTimeout(async () => {
      await connect(tabId, {
        sessionId,
        hostname: params.hostname,
        port: params.port,
        username: params.username,
        authMethod: { type: 'password', password: params.password },
      });
    }, 100);
  }, [addTab, connect]);

  const handleTabClose = useCallback(async (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) {
      await disconnect(tab.sessionId);
      unregisterTerminal(tabId);
    }
    removeTab(tabId);
  }, [tabs, disconnect, unregisterTerminal, removeTab]);

  return (
    <div className={styles.app}>
      <TitleBar onSearchClick={() => {}} />
      <div className={styles.body}>
        <ActivityBar />
        <Sidebar />
        <div className={styles.mainArea}>
          <TabBar
            tabs={tabs.map((t) => ({ id: t.id, title: t.title, connected: t.connected }))}
            activeTabId={activeTabId}
            onTabClick={setActiveTab}
            onTabClose={handleTabClose}
            onNewTab={handleNewTab}
          />
          <div className={styles.terminalArea}>
            {tabs.length === 0 ? (
              <div className={styles.placeholder}>
                <div className={styles.placeholderLogo}>ZENITH</div>
                <span>Press + to connect to a server</span>
              </div>
            ) : (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: tab.id === activeTabId ? 'block' : 'none',
                  }}
                >
                  <XTerminal
                    onData={(data) => write(tab.sessionId, data)}
                    onResize={(cols, rows) => resize(tab.sessionId, cols, rows)}
                    terminalRef={(() => {
                      const ref = { current: null as Terminal | null };
                      const originalRef = ref;
                      return {
                        get current() { return originalRef.current; },
                        set current(term: Terminal | null) {
                          originalRef.current = term;
                          if (term) registerTerminal(tab.id, term);
                        },
                      };
                    })()}
                  />
                </div>
              ))
            )}
          </div>
          <MonitorBar data={null} />
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
```

- [ ] **Step 5: Update Tauri capabilities to allow IPC commands**

Edit `src-tauri/capabilities/default.json` — ensure the `permissions` array includes:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "core:window:allow-set-title",
    "dialog:default"
  ]
}
```

Note: Tauri v2 commands registered via `invoke_handler` are allowed by default unless you use command-level permissions. The above should suffice.

- [ ] **Step 6: Test the full SSH connection flow**

```bash
npm run tauri dev
```

Expected:
1. Window opens with cyberpunk layout
2. Click the + button in the tab bar
3. Quick Connect dialog appears
4. Enter a hostname, username, and password for a real SSH server you can access
5. Click Connect
6. A new tab appears. Terminal shows the SSH session
7. You can type commands, see output, and interact with the remote shell
8. Close the tab disconnects

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: wire SSH to terminal via Tauri IPC — working SSH connections"
```

---

## Phase 3: Session Management

### Task 8: Session Data Model + JSON Storage (Rust)

**Files:**
- Create: `src-tauri/src/sessions/mod.rs`
- Create: `src-tauri/src/sessions/types.rs`
- Create: `src-tauri/src/sessions/storage.rs`
- Create: `src-tauri/src/sessions/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create session types**

Create `src-tauri/src/sessions/types.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SessionAuthMethod,
    pub private_key_path: Option<String>,
    pub folder_id: Option<String>,
    pub color_label: Option<String>,
    pub notes: Option<String>,
    pub last_connected: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionAuthMethod {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color_label: Option<String>,
    pub sort_order: i32,
    pub expanded: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsData {
    pub sessions: Vec<Session>,
    pub folders: Vec<Folder>,
}

impl Session {
    pub fn new(name: String, hostname: String, port: u16, username: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            hostname,
            port,
            username,
            auth_method: SessionAuthMethod::Password,
            private_key_path: None,
            folder_id: None,
            color_label: None,
            notes: None,
            last_connected: None,
            created_at: Utc::now(),
            sort_order: 0,
        }
    }
}

impl Folder {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            parent_id: None,
            color_label: None,
            sort_order: 0,
            expanded: true,
        }
    }
}
```

- [ ] **Step 2: Create storage layer**

Create `src-tauri/src/sessions/storage.rs`:

```rust
use anyhow::Result;
use std::path::PathBuf;

use super::types::SessionsData;

fn data_dir() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .ok_or_else(|| anyhow::anyhow!("Could not find config directory"))?
        .join("zenith");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn sessions_file() -> Result<PathBuf> {
    Ok(data_dir()?.join("sessions.json"))
}

pub fn load_sessions() -> Result<SessionsData> {
    let path = sessions_file()?;
    if !path.exists() {
        return Ok(SessionsData {
            sessions: vec![],
            folders: vec![],
        });
    }
    let contents = std::fs::read_to_string(&path)?;
    let data: SessionsData = serde_json::from_str(&contents)?;
    Ok(data)
}

pub fn save_sessions(data: &SessionsData) -> Result<()> {
    let path = sessions_file()?;
    let json = serde_json::to_string_pretty(data)?;
    std::fs::write(&path, json)?;
    Ok(())
}

pub fn export_sessions(data: &SessionsData, export_path: &str) -> Result<()> {
    let json = serde_json::to_string_pretty(data)?;
    std::fs::write(export_path, json)?;
    Ok(())
}

pub fn import_sessions(import_path: &str) -> Result<SessionsData> {
    let contents = std::fs::read_to_string(import_path)?;
    let data: SessionsData = serde_json::from_str(&contents)?;
    Ok(data)
}
```

- [ ] **Step 3: Create session Tauri commands**

Create `src-tauri/src/sessions/commands.rs`:

```rust
use super::storage;
use super::types::*;

#[tauri::command]
pub fn get_sessions() -> Result<SessionsData, String> {
    storage::load_sessions().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_session(session: Session) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions().map_err(|e| e.to_string())?;
    if let Some(existing) = data.sessions.iter_mut().find(|s| s.id == session.id) {
        *existing = session;
    } else {
        data.sessions.push(session);
    }
    storage::save_sessions(&data).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn delete_session(session_id: String) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions().map_err(|e| e.to_string())?;
    data.sessions.retain(|s| s.id != session_id);
    storage::save_sessions(&data).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn save_folder(folder: Folder) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions().map_err(|e| e.to_string())?;
    if let Some(existing) = data.folders.iter_mut().find(|f| f.id == folder.id) {
        *existing = folder;
    } else {
        data.folders.push(folder);
    }
    storage::save_sessions(&data).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn delete_folder(folder_id: String) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions().map_err(|e| e.to_string())?;
    data.folders.retain(|f| f.id != folder_id);
    // Move sessions in this folder to root
    for session in data.sessions.iter_mut() {
        if session.folder_id.as_deref() == Some(&folder_id) {
            session.folder_id = None;
        }
    }
    storage::save_sessions(&data).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn move_session_to_folder(session_id: String, folder_id: Option<String>) -> Result<SessionsData, String> {
    let mut data = storage::load_sessions().map_err(|e| e.to_string())?;
    if let Some(session) = data.sessions.iter_mut().find(|s| s.id == session_id) {
        session.folder_id = folder_id;
    }
    storage::save_sessions(&data).map_err(|e| e.to_string())?;
    Ok(data)
}

#[tauri::command]
pub fn export_sessions_file(path: String) -> Result<(), String> {
    let data = storage::load_sessions().map_err(|e| e.to_string())?;
    storage::export_sessions(&data, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_sessions_file(path: String) -> Result<SessionsData, String> {
    let imported = storage::import_sessions(&path).map_err(|e| e.to_string())?;
    let mut current = storage::load_sessions().map_err(|e| e.to_string())?;
    // Merge imported into current (add, don't overwrite existing IDs)
    for folder in imported.folders {
        if !current.folders.iter().any(|f| f.id == folder.id) {
            current.folders.push(folder);
        }
    }
    for session in imported.sessions {
        if !current.sessions.iter().any(|s| s.id == session.id) {
            current.sessions.push(session);
        }
    }
    storage::save_sessions(&current).map_err(|e| e.to_string())?;
    Ok(current)
}
```

- [ ] **Step 4: Create module entry and register in lib.rs**

Create `src-tauri/src/sessions/mod.rs`:

```rust
pub mod commands;
pub mod storage;
pub mod types;
```

Update `src-tauri/src/lib.rs` — add the sessions module and register the commands:

```rust
mod sessions;
mod ssh;

use sessions::commands::*;
use ssh::commands::*;
use ssh::manager::SshManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SshManager::new())
        .invoke_handler(tauri::generate_handler![
            ssh_connect,
            ssh_write,
            ssh_resize,
            ssh_disconnect,
            get_sessions,
            save_session,
            delete_session,
            save_folder,
            delete_folder,
            move_session_to_folder,
            export_sessions_file,
            import_sessions_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Verify it compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add session/folder CRUD with JSON storage and import/export"
```

---

### Task 9: Session Sidebar UI

**Files:**
- Create: `src/stores/sessionStore.ts`
- Create: `src/components/sessions/SessionSidebar.tsx`
- Create: `src/components/sessions/SessionSidebar.module.css`
- Create: `src/components/sessions/SessionDialog.tsx`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the session store**

Create `src/stores/sessionStore.ts`:

```ts
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Session {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
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

interface SessionState {
  sessions: Session[];
  folders: Folder[];
  loading: boolean;
  loadSessions: () => Promise<void>;
  saveSession: (session: Session) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  saveFolder: (folder: Folder) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveSession: (sessionId: string, folderId: string | null) => Promise<void>;
  toggleFolder: (id: string) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  folders: [],
  loading: false,

  loadSessions: async () => {
    set({ loading: true });
    try {
      const data: { sessions: Session[]; folders: Folder[] } = await invoke('get_sessions');
      set({ sessions: data.sessions, folders: data.folders });
    } catch (e) {
      console.error('Failed to load sessions:', e);
    } finally {
      set({ loading: false });
    }
  },

  saveSession: async (session) => {
    const data: { sessions: Session[]; folders: Folder[] } = await invoke('save_session', { session });
    set({ sessions: data.sessions, folders: data.folders });
  },

  deleteSession: async (id) => {
    const data: { sessions: Session[]; folders: Folder[] } = await invoke('delete_session', { sessionId: id });
    set({ sessions: data.sessions, folders: data.folders });
  },

  saveFolder: async (folder) => {
    const data: { sessions: Session[]; folders: Folder[] } = await invoke('save_folder', { folder });
    set({ sessions: data.sessions, folders: data.folders });
  },

  deleteFolder: async (id) => {
    const data: { sessions: Session[]; folders: Folder[] } = await invoke('delete_folder', { folderId: id });
    set({ sessions: data.sessions, folders: data.folders });
  },

  moveSession: async (sessionId, folderId) => {
    const data: { sessions: Session[]; folders: Folder[] } = await invoke('move_session_to_folder', { sessionId, folderId });
    set({ sessions: data.sessions, folders: data.folders });
  },

  toggleFolder: (id) => {
    set((s) => ({
      folders: s.folders.map((f) => f.id === id ? { ...f, expanded: !f.expanded } : f),
    }));
  },
}));
```

- [ ] **Step 2: Create the session dialog**

Create `src/components/sessions/SessionDialog.tsx`:

```tsx
import { useState, useEffect } from 'react';
import type { Session } from '../../stores/sessionStore';

interface SessionDialogProps {
  open: boolean;
  session?: Session | null;
  onClose: () => void;
  onSave: (session: Session) => void;
}

export function SessionDialog({ open, session, onClose, onSave }: SessionDialogProps) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'privateKey'>('password');
  const [keyPath, setKeyPath] = useState('');

  useEffect(() => {
    if (session) {
      setName(session.name);
      setHostname(session.hostname);
      setPort(String(session.port));
      setUsername(session.username);
      setAuthMethod(session.authMethod);
      setKeyPath(session.privateKeyPath || '');
    } else {
      setName(''); setHostname(''); setPort('22');
      setUsername(''); setAuthMethod('password'); setKeyPath('');
    }
  }, [session, open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    onSave({
      id: session?.id || crypto.randomUUID(),
      name: name || hostname,
      hostname,
      port: parseInt(port),
      username,
      authMethod,
      privateKeyPath: authMethod === 'privateKey' ? keyPath : undefined,
      folderId: session?.folderId,
      colorLabel: session?.colorLabel,
      notes: session?.notes,
      lastConnected: session?.lastConnected,
      createdAt: session?.createdAt || now,
      sortOrder: session?.sortOrder || 0,
    });
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 24, width: 400,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <h3 style={{ color: 'var(--cyan)', fontFamily: 'var(--font-mono)', margin: 0 }}>
          {session ? 'Edit Session' : 'New Session'}
        </h3>
        <input placeholder="Session Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Hostname" value={hostname} onChange={(e) => setHostname(e.target.value)} required />
        <input placeholder="Port" value={port} onChange={(e) => setPort(e.target.value)} />
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ color: 'var(--text-secondary)', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" checked={authMethod === 'password'} onChange={() => setAuthMethod('password')} />
            Password
          </label>
          <label style={{ color: 'var(--text-secondary)', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="radio" checked={authMethod === 'privateKey'} onChange={() => setAuthMethod('privateKey')} />
            Private Key
          </label>
        </div>
        {authMethod === 'privateKey' && (
          <input placeholder="Path to private key" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
        )}
        <button type="submit" style={{
          background: 'var(--cyan-glow)', border: '1px solid var(--cyan-dim)',
          color: 'var(--cyan)', padding: '8px 16px', borderRadius: 6,
          fontFamily: 'var(--font-mono)', fontWeight: 600,
        }}>
          {session ? 'Save' : 'Create Session'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create the session sidebar component**

Create `src/components/sessions/SessionSidebar.module.css`:

```css
.container {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 4px;
}

.folder {
  margin-bottom: 2px;
}

.folderHeader {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  color: var(--purple);
  font-size: 12px;
  cursor: pointer;
  border-radius: 4px;
}

.folderHeader:hover {
  background: var(--bg-elevated);
}

.arrow {
  font-size: 10px;
  transition: transform var(--transition-fast);
}

.arrow.expanded {
  transform: rotate(90deg);
}

.sessionItem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 20px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  border-left: 2px solid transparent;
}

.sessionItem:hover {
  background: var(--cyan-glow);
  color: var(--text-primary);
}

.sessionItem.root {
  padding-left: 8px;
}

.statusDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-disconnected);
  flex-shrink: 0;
}

.actions {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.actionBtn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 12px;
  color: var(--cyan-dim);
  cursor: pointer;
  border-radius: 4px;
}

.actionBtn:hover {
  color: var(--cyan);
  background: var(--cyan-glow);
}
```

Create `src/components/sessions/SessionSidebar.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useSessionStore, Session } from '../../stores/sessionStore';
import { SessionDialog } from './SessionDialog';
import styles from './SessionSidebar.module.css';

interface SessionSidebarProps {
  onConnect: (session: Session) => void;
  connectedSessionIds: Set<string>;
}

export function SessionSidebar({ onConnect, connectedSessionIds }: SessionSidebarProps) {
  const { sessions, folders, loadSessions, saveSession, deleteSession, saveFolder, deleteFolder, toggleFolder } = useSessionStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const rootSessions = sessions.filter((s) => !s.folderId);

  const handleDoubleClickSession = (session: Session) => {
    onConnect(session);
  };

  const handleDoubleClickFolder = (folderId: string) => {
    const folderSessions = sessions.filter((s) => s.folderId === folderId);
    folderSessions.forEach((session) => onConnect(session));
  };

  const handleNewFolder = () => {
    const name = prompt('Folder name:');
    if (name) {
      saveFolder({ id: crypto.randomUUID(), name, sortOrder: 0, expanded: true });
    }
  };

  const handleSaveSession = (session: Session) => {
    saveSession(session);
  };

  return (
    <div className={styles.container}>
      {folders.map((folder) => {
        const folderSessions = sessions.filter((s) => s.folderId === folder.id);
        return (
          <div key={folder.id} className={styles.folder}>
            <div
              className={styles.folderHeader}
              onClick={() => toggleFolder(folder.id)}
              onDoubleClick={() => handleDoubleClickFolder(folder.id)}
            >
              <span className={`${styles.arrow} ${folder.expanded ? styles.expanded : ''}`}>▸</span>
              <span>{folder.name}</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 10, marginLeft: 'auto' }}>
                {folderSessions.length}
              </span>
            </div>
            {folder.expanded && folderSessions.map((session) => (
              <div
                key={session.id}
                className={styles.sessionItem}
                onDoubleClick={() => handleDoubleClickSession(session)}
              >
                <span
                  className={styles.statusDot}
                  style={connectedSessionIds.has(session.id) ? { background: 'var(--status-connected)', boxShadow: '0 0 6px var(--cyan-glow)' } : {}}
                />
                <span>{session.name}</span>
              </div>
            ))}
          </div>
        );
      })}

      {rootSessions.map((session) => (
        <div
          key={session.id}
          className={`${styles.sessionItem} ${styles.root}`}
          onDoubleClick={() => handleDoubleClickSession(session)}
        >
          <span
            className={styles.statusDot}
            style={connectedSessionIds.has(session.id) ? { background: 'var(--status-connected)', boxShadow: '0 0 6px var(--cyan-glow)' } : {}}
          />
          <span>{session.name}</span>
        </div>
      ))}

      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={() => { setEditingSession(null); setDialogOpen(true); }}>
          + New Session
        </button>
        <button className={styles.actionBtn} onClick={handleNewFolder}>
          + New Folder
        </button>
      </div>

      <SessionDialog
        open={dialogOpen}
        session={editingSession}
        onClose={() => setDialogOpen(false)}
        onSave={handleSaveSession}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire SessionSidebar into the Sidebar component**

Update `src/components/layout/Sidebar.tsx` to render the SessionSidebar when the sessions panel is active. The Sidebar needs to accept `onConnect` and `connectedSessionIds` props from AppLayout, and pass them through when `sidebarPanel === 'sessions'`.

- [ ] **Step 5: Update AppLayout to pass session connection handlers to Sidebar**

Update AppLayout to:
- Track connected session IDs
- Pass an `onConnect` callback that creates a tab and initiates an SSH connection
- Remove the old QuickConnect dialog (sessions are now created via the sidebar)

- [ ] **Step 6: Test session management**

```bash
npm run tauri dev
```

Expected:
1. Sessions panel shows in sidebar
2. Click "+ New Session" to create a session
3. Session appears in the sidebar
4. Double-click session to connect
5. Create a folder, sessions can be organized
6. Double-click a folder to batch-open all sessions inside
7. Sessions persist after restart

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add session management UI with folders, CRUD, and double-click connect"
```

---

### Task 10: Command Palette

**Files:**
- Create: `src/components/command-palette/CommandPalette.tsx`
- Create: `src/components/command-palette/CommandPalette.module.css`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create the command palette component**

Create `src/components/command-palette/CommandPalette.module.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  padding-top: 80px;
  z-index: 200;
}

.palette {
  width: 500px;
  max-height: 400px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
}

.searchInput {
  width: 100%;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  padding: 14px 16px;
  font-size: 14px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  outline: none;
}

.results {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.item:hover, .item.selected {
  background: var(--cyan-glow);
}

.itemName {
  color: var(--text-primary);
}

.itemMeta {
  color: var(--text-dim);
  font-size: 11px;
  margin-left: auto;
  font-family: var(--font-mono);
}

.statusDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--status-disconnected);
  flex-shrink: 0;
}

.empty {
  padding: 20px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}
```

Create `src/components/command-palette/CommandPalette.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import { useSessionStore, Session } from '../../stores/sessionStore';
import styles from './CommandPalette.module.css';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectSession: (session: Session) => void;
  connectedSessionIds: Set<string>;
}

export function CommandPalette({ open, onClose, onSelectSession, connectedSessionIds }: CommandPaletteProps) {
  const { sessions } = useSessionStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    s.hostname.toLowerCase().includes(query.toLowerCase()) ||
    s.username.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => { setSelectedIndex(0); }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      onSelectSession(filtered[selectedIndex]);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.palette} onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Search sessions..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className={styles.results}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No sessions found</div>
          ) : (
            filtered.map((session, i) => (
              <div
                key={session.id}
                className={`${styles.item} ${i === selectedIndex ? styles.selected : ''}`}
                onClick={() => { onSelectSession(session); onClose(); }}
              >
                <span
                  className={styles.statusDot}
                  style={connectedSessionIds.has(session.id)
                    ? { background: 'var(--status-connected)' }
                    : {}
                  }
                />
                <span className={styles.itemName}>{session.name}</span>
                <span className={styles.itemMeta}>{session.username}@{session.hostname}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire command palette into AppLayout**

Add to AppLayout:
- State: `const [showPalette, setShowPalette] = useState(false);`
- Pass `onSearchClick={() => setShowPalette(true)}` to TitleBar
- Add global keyboard listener for Cmd+K / Ctrl+K to open palette
- Render `<CommandPalette>` component with session connection handler

- [ ] **Step 3: Test the command palette**

```bash
npm run tauri dev
```

Expected: Press Cmd+K (or Ctrl+K on Windows/Linux). Palette opens. Type a session name. Arrow keys to navigate. Enter to connect. Escape to close.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add command palette with fuzzy session search (Cmd+K)"
```

---

## Phase 4: SFTP File Browser

### Task 11: SFTP Backend (Rust)

**Files:**
- Create: `src-tauri/src/sftp/mod.rs`
- Create: `src-tauri/src/sftp/types.rs`
- Create: `src-tauri/src/sftp/manager.rs`
- Create: `src-tauri/src/sftp/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create SFTP types**

Create `src-tauri/src/sftp/types.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub permissions: Option<String>,
}
```

- [ ] **Step 2: Create SFTP manager**

Create `src-tauri/src/sftp/manager.rs` — holds SFTP sessions keyed by SSH session ID. Opens an SFTP subsystem channel on the existing SSH connection. Provides methods for `list_dir`, `download`, `upload`, `delete`, `rename`, `mkdir`.

The SFTP session is created by opening a new channel on the existing `client::Handle`, requesting the "sftp" subsystem, and wrapping it with `russh_sftp::client::SftpSession`.

- [ ] **Step 3: Create SFTP Tauri commands**

Create `src-tauri/src/sftp/commands.rs` with commands:
- `sftp_list_dir(session_id, path)` -> `Vec<FileEntry>`
- `sftp_download(session_id, remote_path, local_path)`
- `sftp_upload(session_id, local_path, remote_path)`
- `sftp_delete(session_id, path)`
- `sftp_rename(session_id, old_path, new_path)`
- `sftp_mkdir(session_id, path)`

- [ ] **Step 4: Register SFTP commands in lib.rs**

- [ ] **Step 5: Verify it compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add SFTP backend with file operations over existing SSH connections"
```

---

### Task 12: SFTP File Browser UI

**Files:**
- Create: `src/components/files/FileBrowser.tsx`
- Create: `src/components/files/FileBrowser.module.css`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the FileBrowser component**

The file browser shows:
- Breadcrumb path bar at top
- File/folder list with icons, names, sizes
- Right-click context menu for download/upload/delete/rename/mkdir
- Click folder to enter, breadcrumb to go up
- Drag-and-drop from desktop to upload (use Tauri's file drop event)

Style with cyberpunk colors — folders in purple, files in gray, path bar in cyan.

- [ ] **Step 2: Wire FileBrowser into Sidebar**

Show FileBrowser when `sidebarPanel === 'files'` and there's an active connected tab. Pass the active tab's session ID.

- [ ] **Step 3: Test file browser**

```bash
npm run tauri dev
```

Expected: Connect to a server. Click the Files icon in activity bar. File browser shows remote filesystem. Navigate folders. Download/upload files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add SFTP file browser UI with navigation and file operations"
```

---

## Phase 5: System Monitoring

### Task 13: Monitoring Backend (Rust)

**Files:**
- Create: `src-tauri/src/monitoring/mod.rs`
- Create: `src-tauri/src/monitoring/collector.rs`
- Create: `src-tauri/src/monitoring/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create the monitoring collector**

Create `src-tauri/src/monitoring/collector.rs` — collects system metrics by executing commands over the existing SSH channel:

- **CPU:** Parse `/proc/stat` (calculate from two samples 1s apart)
- **RAM:** Parse `/proc/meminfo` (MemTotal, MemAvailable)
- **Network:** Parse `/proc/net/dev` (two samples for rate calculation)
- **Disk:** Run `df -h /` and parse
- **Uptime:** Read `/proc/uptime`
- **Hostname:** Run `hostname`

Combine all into a single SSH command: `cat /proc/stat /proc/meminfo /proc/net/dev /proc/uptime && df -h / && hostname`

Run this command every 3 seconds on a background tokio task. Send results via a Tauri Channel.

- [ ] **Step 2: Create monitoring types and commands**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorData {
    pub cpu: f64,
    pub ram: f64,
    pub ram_used: String,
    pub ram_total: String,
    pub network_up: String,
    pub network_down: String,
    pub disk: f64,
    pub disk_used: String,
    pub disk_total: String,
    pub uptime: String,
    pub hostname: String,
}
```

Commands:
- `start_monitoring(session_id, on_event: Channel<MonitorData>)` — starts the polling loop
- `stop_monitoring(session_id)` — stops polling

- [ ] **Step 3: Register monitoring commands in lib.rs**

- [ ] **Step 4: Verify it compiles**

```bash
cd src-tauri && cargo check
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add system monitoring backend collecting CPU/RAM/network/disk/uptime"
```

---

### Task 14: Wire Monitoring Bar to Live Data

**Files:**
- Create: `src/hooks/useMonitoring.ts`
- Modify: `src/components/layout/MonitorBar.tsx` (already built, just needs data)
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create the monitoring hook**

Create `src/hooks/useMonitoring.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { invoke, Channel } from '@tauri-apps/api/core';
import type { MonitorData } from '../components/layout/MonitorBar';

export function useMonitoring(sessionId: string | null) {
  const [data, setData] = useState<MonitorData | null>(null);
  const activeSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setData(null);
      return;
    }

    if (activeSessionRef.current === sessionId) return;

    // Stop previous monitoring
    if (activeSessionRef.current) {
      invoke('stop_monitoring', { sessionId: activeSessionRef.current }).catch(() => {});
    }

    activeSessionRef.current = sessionId;

    const onEvent = new Channel<MonitorData>();
    onEvent.onmessage = (msg) => setData(msg);

    invoke('start_monitoring', { sessionId, onEvent }).catch((e) => {
      console.error('Monitoring failed:', e);
    });

    return () => {
      if (activeSessionRef.current === sessionId) {
        invoke('stop_monitoring', { sessionId }).catch(() => {});
        activeSessionRef.current = null;
      }
    };
  }, [sessionId]);

  return data;
}
```

- [ ] **Step 2: Wire into AppLayout**

In AppLayout, use the hook:
```ts
const activeTab = tabs.find(t => t.id === activeTabId);
const monitorData = useMonitoring(activeTab?.connected ? activeTab.sessionId : null);
```

Pass `monitorData` to `<MonitorBar data={monitorData} />`.

- [ ] **Step 3: Test monitoring**

```bash
npm run tauri dev
```

Expected: Connect to a Linux server. Monitor bar at bottom shows live CPU, RAM, Network, Disk, and Uptime data with the cyberpunk block bars updating every ~3 seconds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire live system monitoring data to the monitor bar UI"
```

---

## Phase 6: Polish & Distribution

### Task 15: Split Terminal

**Files:**
- Create: `src/components/terminal/SplitTerminal.tsx`
- Create: `src/components/terminal/SplitTerminal.module.css`
- Create: `src/stores/splitStore.ts`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Create split store**

Track split layout per tab: `'single' | 'horizontal-2' | 'vertical-2' | 'quad'`. Each pane holds a session ID (can be the same session or different).

- [ ] **Step 2: Create SplitTerminal component**

Renders 1, 2, or 4 XTerminal instances in a CSS flexbox/grid layout with draggable dividers. Each pane is an independent XTerminal with its own SSH connection. Use ResizeObserver to call fitAddon.fit() when panes resize.

- [ ] **Step 3: Wire split button in TabBar to cycle through layouts**

- [ ] **Step 4: Test split view**

Expected: Click Split button. Terminal splits. Each pane works independently. Drag divider to resize.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add split terminal support with 2/4 pane layouts"
```

---

### Task 16: Reconnection + Tab Notifications

**Files:**
- Modify: `src/hooks/useSshConnection.ts`
- Modify: `src/components/layout/TabBar.tsx`
- Modify: `src/stores/tabStore.ts`

- [ ] **Step 1: Add reconnection support**

When an SSH connection disconnects:
1. Write a styled message to the terminal: "Connection lost. [Reconnect]"
2. Store the original connection params in the tab store
3. Add a `reconnect(tabId)` function that re-establishes the connection using stored params

- [ ] **Step 2: Add tab activity notifications**

In the tab store, add a `hasActivity` boolean per tab. When data arrives on a background tab (not the active tab), set `hasActivity = true`. Clear it when the tab becomes active.

In TabBar, render a pulsing glow animation on tabs with `hasActivity`:

```css
@keyframes tabPulse {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 8px var(--cyan-glow); }
}

.tab.hasActivity {
  animation: tabPulse 2s infinite;
}
```

- [ ] **Step 3: Test reconnection and notifications**

Expected: Disconnect a server (e.g., `exit` command). Terminal shows reconnect option. Background tabs pulse when they have new output.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add SSH reconnection and tab activity notifications"
```

---

### Task 17: Settings Panel

**Files:**
- Create: `src/components/settings/SettingsPanel.tsx`
- Create: `src/components/settings/SettingsPanel.module.css`
- Create: `src/stores/settingsStore.ts`
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create settings store**

Store user preferences in a JSON file (similar to sessions). Settings include:
- Terminal: fontFamily, fontSize, lineHeight, scrollbackLines, cursorStyle, cursorBlink
- Monitoring: enabled, refreshInterval
- General: autoReconnect, reconnectDelay, selectToCopy

- [ ] **Step 2: Create Rust commands for settings persistence**

`get_settings()`, `save_settings(settings)` — stored at `~/.config/zenith/settings.json`.

- [ ] **Step 3: Create SettingsPanel component**

Renders a form for each setting group. Changes save immediately. Cyberpunk-styled form controls.

- [ ] **Step 4: Wire into Sidebar when panel is 'settings'**

- [ ] **Step 5: Apply settings to terminal instances**

When settings change, update xterm.js options on all active terminals.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add settings panel with terminal and general preferences"
```

---

### Task 18: Credential Storage (Keyring)

**Files:**
- Create: `src-tauri/src/credentials/mod.rs`
- Create: `src-tauri/src/credentials/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/hooks/useSshConnection.ts`
- Modify: `src/components/sessions/SessionDialog.tsx`

- [ ] **Step 1: Create credential commands using keyring plugin**

Register the keyring plugin in `lib.rs`: `.plugin(tauri_plugin_keyring::init())`

Create commands:
- `save_credential(session_id, password)` — stores in OS keychain
- `get_credential(session_id)` -> `Option<String>`
- `delete_credential(session_id)`

Use service name `"zenith-ssh"` and the session ID as the account.

- [ ] **Step 2: Update SessionDialog to offer "Save password" checkbox**

When creating/editing a session with password auth, add a checkbox: "Save password securely". If checked, call `save_credential` after saving the session.

- [ ] **Step 3: Update connection flow to use saved credentials**

When connecting via double-click, check for a saved credential. If found, use it. If not, prompt for password.

- [ ] **Step 4: Test credential storage**

Expected: Save a session with "Save password" checked. Close and reopen the app. Double-click the session — connects without asking for password.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add secure credential storage via OS keychain"
```

---

### Task 19: Session Import/Export UI

**Files:**
- Modify: `src/components/sessions/SessionSidebar.tsx`
- Modify: `src/components/layout/AppLayout.tsx`

- [ ] **Step 1: Add export/import buttons to session sidebar**

Add two buttons in the sidebar actions area:
- "Export Sessions" — opens a save dialog (via `@tauri-apps/plugin-dialog`), saves all sessions to chosen path
- "Import Sessions" — opens a file dialog, imports sessions from chosen file

```ts
import { save, open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

const handleExport = async () => {
  const path = await save({ filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (path) await invoke('export_sessions_file', { path });
};

const handleImport = async () => {
  const path = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (path) {
    await invoke('import_sessions_file', { path });
    await loadSessions();
  }
};
```

- [ ] **Step 2: Test import/export**

Expected: Export sessions to a file. Delete sessions. Import the file. Sessions restored.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add session import/export via file dialogs"
```

---

### Task 20: Cross-Platform CI/CD (GitHub Actions)

**Files:**
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml` — runs on every push and PR. Builds on all three platforms. Runs `cargo test` and `npm run build`.

```yaml
name: CI
on: [push, pull_request]

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - name: Install deps (Ubuntu)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - uses: actions/setup-node@v4
        with: { node-version: 'lts/*', cache: 'npm' }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - run: npm install
      - run: npm run tauri build -- ${{ matrix.args }}
```

- [ ] **Step 2: Create release workflow**

Create `.github/workflows/release.yml` — triggered on version tags. Builds all platforms and creates a GitHub Release with the installers.

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target aarch64-apple-darwin'
          - platform: macos-latest
            args: '--target x86_64-apple-darwin'
          - platform: ubuntu-22.04
            args: ''
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4
      - name: Install deps (Ubuntu)
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
      - uses: actions/setup-node@v4
        with: { node-version: 'lts/*', cache: 'npm' }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - run: npm install
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Zenith ${{ github.ref_name }}'
          releaseBody: 'Download the installer for your platform below.'
          releaseDraft: true
          args: ${{ matrix.args }}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add GitHub Actions CI/CD for cross-platform builds and releases"
```

---

## Final Verification

- [ ] **Step 1: Full end-to-end test**

Run `npm run tauri dev` and verify all features:
1. App opens with cyberpunk theme
2. Create sessions and folders
3. Double-click session to connect
4. Double-click folder to batch-open
5. Terminal works — type commands, see output
6. Copy/paste works (select to copy, Cmd+V to paste)
7. Command palette (Cmd+K) finds sessions
8. File browser shows remote files
9. Monitor bar shows live CPU/RAM/Network/Disk/Uptime
10. Split terminal works
11. Tab notifications pulse on background activity
12. Settings persist
13. Sessions persist after restart
14. Export/Import sessions works
15. Credentials saved in keychain

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "feat: Zenith v0.1.0 — cross-platform SSH terminal with cyberpunk aesthetic"
git tag v0.1.0
```
