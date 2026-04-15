# Zenith — Design Spec

**A cross-platform, open-source SSH terminal with built-in session management, SFTP file browsing, and real-time system monitoring. Cyberpunk aesthetic.**

## Overview

Zenith is a MobaXterm-inspired terminal application that runs on macOS, Windows, and Linux. It focuses on doing SSH exceptionally well rather than supporting every protocol. The architecture is designed so additional protocols (RDP, VNC, Serial, etc.) can be added later by the community as plugins.

**Target audience:** Developers, sysadmins, DevOps engineers, and anyone who manages remote servers via SSH.

**Name:** Zenith — "the highest point."

## Technology Stack

### Tauri + React/TypeScript

- **Rust backend (Tauri core):**
  - SSH connections via `russh` (pure Rust SSH2 library)
  - SFTP file operations (built into russh)
  - System monitoring data collection (runs commands over the SSH channel)
  - Session storage (encrypted JSON in OS app data directory)
  - Credential security via OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service/libsecret)
  - All networking and crypto lives in Rust — no Node.js runtime dependency

- **React frontend (TypeScript):**
  - Terminal rendering via `xterm.js` (same library VS Code's terminal uses)
  - UI framework: React 18+ with a modern CSS approach (CSS modules or Tailwind)
  - State management: Zustand (lightweight, minimal boilerplate)
  - All UI components: sidebar, tabs, command palette, monitoring bar, file browser, session dialogs

- **IPC bridge:**
  - Frontend communicates with Rust backend via Tauri's typed IPC commands
  - SSH data streams over Tauri event channels for real-time terminal output

### Why This Stack

- **Tauri vs Electron:** ~10-15MB bundle vs ~150MB+. Lower RAM per window. Rust backend is faster and more secure for SSH/crypto. Modern choice that attracts open-source contributors.
- **russh vs system SSH:** No dependency on the user's installed SSH binary. Consistent behavior across platforms. Full control over connection lifecycle, reconnection, and SFTP.
- **xterm.js:** Battle-tested terminal emulator used by VS Code, Hyper, and many others. Supports ligatures, Unicode, true color, GPU-accelerated rendering.

## Visual Design

### Cyberpunk / Neon Aesthetic

- **Background:** Deep blacks (#0a0a0f, #0d0d1a, #07070d)
- **Primary accent:** Neon cyan (#00ffc8) — used for active elements, primary user, CPU metrics
- **Secondary accent:** Electric purple (#7B61FF) — used for hostnames, RAM metrics, folder headers
- **Tertiary accent:** Hot pink (#ff6b9d) — used for network metrics, alerts, staging indicators
- **Quaternary accent:** Ocean blue (#00b4d8) — used for disk metrics, info elements
- **Text:** Light gray (#e0e0e0) for primary, dim gray (#666) for secondary
- **Subtle grid background** on certain panels (rgba lines at 20px intervals) for the cyberpunk grid effect
- **Glowing effects:** Active tabs and selected sessions have subtle glow/border effects using accent colors
- **Dark everywhere:** No light mode for v1. The aesthetic is the identity.

### Typography

- **Terminal font:** JetBrains Mono (ships with the app, supports ligatures)
- **UI font:** Inter or system font stack
- **Monospace everywhere in the terminal**, proportional in the UI chrome

## Layout

### Hybrid Layout (Activity Bar + Collapsible Panel + Command Palette)

```
┌─────────────────────────────────────────────────────────────────┐
│ [●●●]  Zenith              [⌘K Search sessions, commands...]   │
├──┬──────────┬───────────────────────────────────────────────────┤
│  │ Sessions │                                                   │
│⌂ │          │  [web-01] [db-master] [staging] [+]     [⫼ Split]│
│  │ ▾ Prod   │ ┌─────────────────────────────────────────────┐  │
│📁│  ● web-01│ │ vulnix@web-01 ~ $                           │  │
│  │  ○ db-ms │ │                                             │  │
│📊│ ▸ Staging│ │          Terminal Area                      │  │
│  │ ▸ Personal│ │         (xterm.js)                         │  │
│  │          │ │                                             │  │
│⚙ │ + New    │ └─────────────────────────────────────────────┘  │
│  │ Session  │ [CPU ▮▮▮▮▮▮░░░░ 58%] [RAM ▮▮▮▮▮▮▮░░░ 72%]      │
│  │          │ [↑2.1 ↓8.4 MB/s] [DISK 45%] [UP 42d · web-01]  │
├──┴──────────┴───────────────────────────────────────────────────┘
```

**Components:**

1. **Title bar:** App name, window controls, command palette search bar (⌘K / Ctrl+K)
2. **Activity bar (far left, ~36px):** Icon strip that toggles sidebar panels — Sessions (⌂), Files (📁), Monitoring (📊), Settings (⚙). Active panel has a left accent border.
3. **Sidebar panel (~24% width, collapsible):** Shows content for the selected activity bar icon. Collapses to maximize terminal space. Resizable via drag.
4. **Tab bar:** Each open connection is a tab. Shows connection status dot (green = connected, dim = disconnected). Active tab has accent border. [+] button for new tab. Split button on the right.
5. **Terminal area:** xterm.js terminal. Supports split view (2 horizontal, 2 vertical, or 4 quadrant).
6. **Monitoring bar (bottom):** Fixed bar showing real-time server metrics for the active tab's connection.

## Features

### 1. SSH Terminal

- Full terminal emulation via xterm.js
- SSH2 connections via russh (password and private key authentication)
- True color support (16 million colors)
- Unicode and emoji support
- GPU-accelerated rendering via WebGL
- Configurable font family, size, and line height
- Scrollback buffer (configurable length, default 10,000 lines)
- Search in scrollback (⌘F / Ctrl+F)
- Zoom with ⌘+/- or Ctrl+/-

### 2. Copy/Paste

- **Select text** in terminal → automatically copied to clipboard (no extra shortcut needed)
- **Right-click** → paste
- **⌘C / Ctrl+C** with text selected → copy (without selection, sends SIGINT as normal)
- **⌘V / Ctrl+V** → paste
- **Copies as clean plain text** — all ANSI escape codes and color formatting stripped automatically
- No garbled characters, no invisible formatting — what you see is what you paste

### 3. Session Management

#### Creating Sessions
- Simple dialog: name, hostname, port (default 22), username, auth method (password or private key), optional private key file path
- Optional: assign a color label, add notes/description
- Save and optionally connect immediately

#### Organizing Sessions
- Hierarchical folder structure in the sidebar
- **Drag and drop** sessions between folders, reorder within folders
- **Double-click a session** → connect and open in a new tab
- **Double-click a folder** → batch-open ALL sessions inside as tabs simultaneously
- **Right-click context menu:** Edit, Duplicate, Delete, Move to Folder, Connect
- Connection status dots next to each session (● connected, ○ saved)
- Folders show count of sessions inside

#### Quick Access
- **Command palette (⌘K / Ctrl+K):** Fuzzy search across all sessions by name, hostname, or folder. Select to connect instantly.
- Recent sessions shown at the top of the session list

#### Session Backup & Restore
- **Export:** One-click export all sessions (names, hosts, usernames, folder structure, settings) to a JSON file. Passwords/keys are NOT included in exports for security.
- **Import:** Load a session export file to restore or migrate sessions to another machine.
- Session data stored in OS-standard app data directory:
  - macOS: `~/Library/Application Support/zenith/`
  - Windows: `%APPDATA%/zenith/`
  - Linux: `~/.config/zenith/`

### 4. SFTP File Browser

- Accessible via the Files icon (📁) in the activity bar
- **Auto-activates** when an SSH session connects — switches sidebar to file browser showing the remote server's filesystem
- Starts at the user's home directory
- **Directory sync:** Follows the terminal's current working directory as you `cd`
- **Navigation:** Click to enter directories, breadcrumb path bar at top for quick jumps, back button
- **Download:** Right-click a file → Download, or drag from browser to local desktop/Finder/Explorer
- **Upload:** Drag files from desktop into the file browser, or right-click → Upload
- **File operations:** Right-click context menu for rename, delete, new folder, permissions (chmod)
- File icons by type, file sizes in human-readable format
- Shows hidden files toggle (dotfiles)

### 5. System Monitoring Bar

Fixed bar at the bottom of the terminal area, visible when connected to a server.

**Metrics displayed:**
- **CPU usage:** Block bar + percentage, colored cyan (#00ffc8)
- **RAM usage:** Block bar + percentage, colored purple (#7B61FF)
- **Network:** Upload and download speed (MB/s or KB/s), colored pink (#ff6b9d)
- **Disk usage:** Percentage of primary partition, colored blue (#00b4d8)
- **Uptime:** Server uptime in human-readable format (e.g., "42d 3h")
- **Hostname:** Shows which server these metrics belong to

**Implementation:**
- Metrics collected by running lightweight commands over the existing SSH channel (e.g., reading `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`, `df`, `uptime`)
- Updates every 3 seconds (configurable)
- Minimal overhead — reuses the existing SSH connection, no additional processes
- Graceful degradation — if a metric can't be read (e.g., non-Linux server), that metric is hidden rather than showing an error
- Bar collapses/hides for connections where monitoring isn't supported

### 6. Tab Management

- Each connection opens in its own tab
- Tabs show: connection status dot + session name
- **Inactive tab notification:** When output occurs on a background tab, the tab pulses/glows to indicate activity
- Close tab with X button or ⌘W / Ctrl+W
- Reorder tabs via drag and drop
- Tab context menu: Close, Close Others, Close All, Duplicate Session

### 7. Split Terminal

- Split the current tab into multiple terminal panes
- Supported layouts: 2 horizontal, 2 vertical, 4 quadrant
- Each pane can be a different session or the same session
- Resize panes by dragging the divider
- Toggle via the Split button in the tab bar or keyboard shortcut

### 8. Reconnection

- When an SSH connection drops, Zenith shows a notification banner in the terminal
- One-click "Reconnect" button to re-establish the session
- Optional: auto-reconnect after a configurable delay (default: off, to avoid reconnect storms)

### 9. Additional Polish

- **Tab title:** Shows session name + hostname
- **Long-running command notification:** Background tabs pulse/glow when output is detected
- **Keyboard shortcuts:** Fully configurable, sensible defaults for all major actions
- **Settings panel:** Accessible via ⚙ in the activity bar. Configure terminal appearance, default SSH settings, monitoring refresh rate, keyboard shortcuts, session defaults.

## Data Model

### Session

```
{
  id: string (UUID)
  name: string
  hostname: string
  port: number (default: 22)
  username: string
  authMethod: "password" | "privateKey"
  privateKeyPath?: string
  folderId?: string (null = root level)
  colorLabel?: string (hex color)
  notes?: string
  lastConnected?: timestamp
  createdAt: timestamp
  sortOrder: number
}
```

### Folder

```
{
  id: string (UUID)
  name: string
  parentId?: string (null = root level, supports nesting)
  colorLabel?: string
  sortOrder: number
  expanded: boolean
}
```

### App Settings

```
{
  terminal: {
    fontFamily: string (default: "JetBrains Mono")
    fontSize: number (default: 14)
    lineHeight: number (default: 1.4)
    scrollbackLines: number (default: 10000)
    cursorStyle: "block" | "underline" | "bar"
    cursorBlink: boolean
  }
  monitoring: {
    enabled: boolean (default: true)
    refreshInterval: number (default: 3 seconds)
  }
  general: {
    autoReconnect: boolean (default: false)
    reconnectDelay: number (default: 5 seconds)
    confirmOnClose: boolean (default: true)
    selectToCopy: boolean (default: true)
  }
}
```

## Cross-Platform Distribution

- **macOS:** `.dmg` installer
- **Windows:** `.msi` installer + portable `.exe`
- **Linux:** `.deb`, `.rpm`, and `.AppImage`
- **CI/CD:** GitHub Actions workflow builds all platforms on every release tag
- **Auto-update:** Tauri's built-in updater for seamless updates (optional, can be disabled)

## Out of Scope (v1)

These are explicitly NOT in v1 but are designed to be addable later:
- RDP, VNC, Telnet, Serial, Mosh protocols (pluggable architecture supports future addition)
- X11 forwarding
- SSH tunneling / port forwarding UI
- Multi-execution (type in all terminals simultaneously)
- Macro recording and playback
- Local terminal / shell (non-SSH)
- Plugin/extension system
- Cloud sync of sessions
- Themes beyond the default cyberpunk theme
- Light mode
