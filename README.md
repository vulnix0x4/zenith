# Zenith

A cross-platform SSH and SFTP terminal client built with Tauri, React, and Rust. Tabbed sessions, split panes, live host monitoring, and a sane folder-based session organizer — wrapped in a neon-cyberpunk theme.

> **Status:** alpha. Active development; expect rough edges. In-app updates ship from GitHub Releases.

---

## Features

**Sessions and folders**
- Save SSH sessions with password or private-key auth
- Group sessions into folders — drag with multi-select (Ctrl/Cmd-click, Shift-click for range), drag in or out
- Right-click a folder to rename inline; new folders auto-enter rename mode
- Import / export your session list as JSON (credentials stay in the OS keyring)

**Terminal**
- Tabbed terminals with drag-to-split (horizontal or vertical panes)
- Command palette (Ctrl/Cmd + K) for fast session switching
- Large-paste guard so you can't accidentally flood a remote shell
- Cyberpunk theme, JetBrains Mono / Cascadia Code / Fira Code fallbacks

**SFTP file browser**
- Browse remote filesystems alongside your terminals
- Upload / download with overwrite confirmation
- Symlinks rendered distinctly
- Live transfer indicator
- Human-readable error messages (no raw SFTP status codes)

**Monitoring**
- Live CPU / memory / network metrics for the active session
- Polling pauses automatically on disconnect; never piles up on slow links

**Reliability**
- SSH host-key TOFU with mismatch detection (genuine MITM warning, not a silent trust-all)
- Auto-reconnect with exponential backoff, capped at 20 attempts and 5 minutes between tries
- Configurable SSH keepalive (default 30s) so corporate firewalls don't drop idle sessions
- Dead-tab visual state with one-click reconnect when a session drops

**Persistence**
- Atomic writes for settings and session storage (no truncation on power cut)
- Corrupted JSON gets backed up and replaced with defaults instead of crashing
- Window size and position remembered across launches

**Credentials**
- Passwords stored in the OS keyring (Keychain / Credential Manager / libsecret)
- Falls back gracefully to in-memory storage when no keyring service is available, with an in-app notice

**Updates**
- One-click in-app updates: title-bar pill appears when a new release is available, click and install
- All update traffic goes directly to GitHub Releases — no telemetry, no third-party update server
- HTTPS-only, host allowlist (`github.com` + `*.githubusercontent.com`), atomic download with size cap

---

## Install

Download the installer for your platform from the [latest release](https://github.com/vulnix0x4/zenith/releases/latest):

| Platform | Asset |
| --- | --- |
| Windows | `Zenith_<version>_x64-setup.exe` (NSIS) or `Zenith_<version>_x64_en-US.msi` |
| macOS — Apple Silicon | `Zenith_<version>_aarch64.dmg` |
| macOS — Intel | `Zenith_<version>_x64.dmg` |
| Linux — AppImage | `Zenith_<version>_amd64.AppImage` |
| Linux — Debian / Ubuntu | `Zenith_<version>_amd64.deb` |
| Linux — Fedora / RHEL | `Zenith-<version>-1.x86_64.rpm` |

Zenith is not yet code-signed. On first install:

- **Windows** SmartScreen will warn — click "More info" → "Run anyway."
- **macOS** Gatekeeper will refuse the first launch — right-click the app → Open.
- **Linux** has no equivalent prompt.

This affects the first install only; subsequent in-app updates run silently.

### Linux note

In-app auto-update is supported for the AppImage build only. `.deb` and `.rpm` installs should be updated through your package manager. The AppImage requires `libwebkit2gtk-4.1-0` and `libayatana-appindicator3-1` at runtime.

---

## Build from source

You'll need:
- **Node.js 20+** and **npm**
- **Rust stable** (via [rustup](https://rustup.rs/))
- Platform build deps for [Tauri v2](https://v2.tauri.app/start/prerequisites/)

```bash
git clone https://github.com/vulnix0x4/zenith.git
cd zenith
npm install
npm run tauri dev    # development with HMR
npm run tauri build  # production installers in src-tauri/target/release/bundle
```

### Tests

```bash
npm test                                            # frontend (vitest)
cargo test --manifest-path src-tauri/Cargo.toml    # backend (cargo)
```

### Releases

Cut a new release by tagging:

```bash
git tag v0.x.y
git push --tags
```

The [`Release` workflow](.github/workflows/release.yml) builds installers across Windows, macOS (Intel + ARM64), and Linux on a 4-runner matrix, then drafts a GitHub Release with all artifacts attached. Edit the draft to add release notes, then publish.

Remember to bump the version in three places before tagging:
- `package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

---

## Stack

- **Shell:** [Tauri 2](https://v2.tauri.app/) (Rust + WebView)
- **Frontend:** [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite 7](https://vite.dev/)
- **State:** [Zustand](https://github.com/pmndrs/zustand)
- **Terminal:** [xterm.js](https://xtermjs.org/) with WebGL renderer
- **SSH:** [`russh`](https://crates.io/crates/russh) and [`russh-sftp`](https://crates.io/crates/russh-sftp)
- **Credentials:** [`keyring`](https://crates.io/crates/keyring) (OS-native) with in-memory fallback
- **Updates:** direct GitHub Releases API + native installer spawn (no Tauri updater plugin, no signing keys to manage)

---

## Repository layout

```
zenith/
├── src/                  # React frontend
│   ├── components/       # Layout, terminal, sessions, files, settings, palette
│   ├── stores/           # Zustand stores (layout, sessions, settings, tabs, sftp, updater)
│   ├── hooks/            # SSH, SFTP, monitoring hooks
│   ├── lib/              # Shared utilities (logger)
│   └── updater/          # Pure update helpers (version compare, asset selection)
├── src-tauri/            # Rust backend
│   └── src/
│       ├── ssh/          # russh wrapper, host-key TOFU, reconnect
│       ├── sftp/         # russh-sftp wrapper, error humanization
│       ├── sessions/     # JSON storage with atomic writes + dedupe
│       ├── settings/     # JSON storage with corruption fallback + clamps
│       ├── credentials/  # Keyring with in-memory fallback
│       ├── monitoring/   # Per-session metric collection
│       ├── updater.rs    # Download + install command
│       └── storage_util.rs  # Atomic write helper
├── docs/superpowers/     # Design + implementation specs
└── .github/workflows/    # CI (every push) + Release (tag-triggered)
```

---

## Reporting issues

[Open an issue](https://github.com/vulnix0x4/zenith/issues) with the failing platform, the Zenith version (Settings → Updates → Current version), and as much repro detail as you can. SSH and SFTP bugs benefit from `RUST_LOG=debug` output if you can run from source.
