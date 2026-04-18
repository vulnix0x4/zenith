# Zenith auto-update — design

**Date:** 2026-04-17
**Status:** approved, ready for implementation plan
**Scope:** adds a one-click update mechanism driven by GitHub Releases, with an "Update available" pill in the title bar and an Updates section in the settings panel.

## Goal

From inside a running Zenith, the user can see when a newer version is available on GitHub, click once, and land on the new version. No external browser, no manual download, no hunting for the right file.

## Decisions

| | Choice |
|---|---|
| Update mechanism | **DIY** — query GitHub Releases API, download the matching installer asset, spawn it. No Tauri updater plugin, no signing keys, no update manifest |
| Platforms | Windows, macOS (Intel + ARM64), Linux |
| UI placement | Title-bar pill (primary) + Settings → Updates section (secondary) |
| Check cadence | Once on app launch + manual "Check for updates" button. No background polling |
| Click-to-install UX | Inline "Downloading…" state, then "Restart to apply" button; no modals, no mid-session forced restart |
| Release pipeline | Tag-triggered GitHub Actions using `tauri-apps/tauri-action`, 4-runner matrix, draft release for manual notes + publish |
| OS code-signing | Deferred (users see SmartScreen / Gatekeeper warnings on first install; updates unaffected) |

## Why DIY instead of Tauri's updater plugin

The official `tauri-plugin-updater` handles cross-platform install, progress events, and integrity verification out of the box. In exchange, it requires:

- An Ed25519 keypair generated via `tauri-cli signer generate`
- The private key + passphrase stored as GitHub Actions secrets
- The public key baked into `tauri.conf.json`
- A `latest.json` manifest hosted at a stable URL, listing every platform artifact with its signature

For a v0.1.0 indie project with one user (the author), that's an expensive hedge against threats that don't apply yet. HTTPS already guards against MITM, and if the attacker has write access to our GitHub repo, they can swap the public key too. The plugin is the right answer later; it's not the right answer now.

Revisit this decision if any of the following change:
- User base grows past "just me and a few friends"
- Release cadence becomes frequent enough that manual release notes are a bottleneck
- We start distributing through a channel (homebrew, winget, etc.) that expects signed binaries

## Architecture

Two layers of new code, plus CI infrastructure.

### Frontend

Directly queries `https://api.github.com/repos/vulnix0x4/zenith/releases/latest` and reads GitHub's standard response shape:

```json
{
  "tag_name": "v0.2.0",
  "name": "Zenith v0.2.0",
  "body": "markdown release notes…",
  "assets": [
    { "name": "Zenith_0.2.0_x64-setup.exe",   "browser_download_url": "…" },
    { "name": "Zenith_0.2.0_x64.dmg",         "browser_download_url": "…" },
    { "name": "Zenith_0.2.0_aarch64.dmg",     "browser_download_url": "…" },
    { "name": "Zenith_0.2.0_amd64.AppImage",  "browser_download_url": "…" }
  ]
}
```

`/releases/latest` automatically skips drafts and prereleases, so we never need to filter. Rate limit is 60 requests/hour per IP, unauthenticated — far more than we'll use (one check per app launch).

The frontend strips the leading `v` from `tag_name`, compares to the current version (injected at build time from `package.json`), and if newer, picks the right asset by filename pattern for the current OS via `@tauri-apps/plugin-os`.

CSP: `tauri.conf.json` already has `"csp": null`, so the webview's `fetch()` to `api.github.com` works without further configuration. We're using plain browser `fetch()`, not `@tauri-apps/plugin-http`, so no HTTP-plugin scope config is needed.

### Rust side

One Tauri command in `src-tauri/src/updater.rs`:

```rust
#[tauri::command]
async fn download_and_install_update(
    app: tauri::AppHandle,
    url: String,
    filename: String,
) -> Result<(), String>
```

Responsibilities:
1. Download the asset from `url` to the OS temp dir under `filename` via `reqwest`.
2. Spawn the installer appropriately for the current platform.
3. Return. The frontend calls `app.exit(0)` immediately after, so the installer can claim the binary.

Per-platform install:

| Platform | Asset filename | What we do |
|---|---|---|
| Windows | `*_x64-setup.exe` (NSIS) | Spawn detached via `std::process::Command`; app exits immediately. Installer UI appears, replaces Zenith, optionally relaunches. **Caveat:** Tauri's NSIS template tries to kill the running app itself but has [known race-condition bugs](https://github.com/tauri-apps/tauri/issues/12309). Exiting the app immediately sidesteps the bug path |
| macOS | `*_{x64|aarch64}.dmg` | `open` the DMG; Finder mounts it and the user drags to `/Applications`. **Not fully automatic** — macOS app-bundle replacement requires either the Tauri updater's `.app.tar.gz` swap trick or a helper process, neither of which we're building in v1 |
| Linux | `*_amd64.AppImage` | Download over the current AppImage path (Linux kernel keeps the running inode alive via file descriptor), `chmod +x`, show "Restart to apply" button. The user relaunches to pick up the new binary |

### Platform trade-off to acknowledge

Windows and Linux users get a genuine one-click experience. macOS users get "click → DMG opens → drag to Applications," which is the native install UX but is two extra clicks. Full macOS auto-replace is a future enhancement. If macOS polish becomes a priority, that's the moment to reconsider adopting the official Tauri updater plugin — it's the thing it does best.

## Components

### `useUpdaterStore` (Zustand)

File: `src/stores/updaterStore.ts`

State:

```ts
status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
currentVersion: string           // baked in at build time from package.json
latestVersion: string | null
releaseNotes: string | null      // markdown from GitHub release body
releaseUrl: string | null        // GitHub release page, used for fallback link
error: string | null
```

Actions:

```ts
checkForUpdate(opts?: { silent?: boolean }): Promise<void>
downloadAndInstall(): Promise<void>  // triggers download, then app.exit()
restart(): Promise<void>             // only for Linux/macOS "ready" state
dismissError(): void
```

State invariants:
- `latestVersion`, `releaseNotes`, `releaseUrl` only populated when `status ∈ {available, downloading, ready}`
- Only one `checkForUpdate()` can be in flight at a time (guarded by `status === 'checking'`)

### `useUpdater` hook

File: `src/hooks/useUpdater.ts`

Thin wrapper over the store. Encapsulates:
- The GitHub API fetch
- Semver-ish version comparison (strip `v` prefix, compare as `[major, minor, patch]` numerically — we're not shipping pre-releases, so no need for full semver)
- OS + asset selection via `@tauri-apps/plugin-os`'s `platform()` and the asset filename patterns from `tauri-action`
- Invoking the Rust command via `invoke('download_and_install_update', { url, filename })` — note: `invoke` imported from `@tauri-apps/api/core` (v2 moved it from `/tauri`)

### `UpdateIndicator` component

File: `src/components/layout/UpdateIndicator.tsx`

Rendered inside `TitleBar.tsx` at the far right. Renders null when `status ∈ {idle, checking, error}`. Three visible states:

| Status | Pill text | Click behavior |
|---|---|---|
| `available` | "Update available" + subtle dot | Opens settings panel, scrolled to Updates section |
| `downloading` | "Updating… " | No click handler |
| `ready` | "Restart to apply" | Calls `restart()` (Linux/macOS only — Windows doesn't reach this state; the installer handles relaunch) |

Styling: follows existing `TitleBar.module.css` patterns, subtle accent color, simple fade-in when mounting. No elaborate motion.

### `UpdatesSection` component

File: `src/components/settings/UpdatesSection.tsx`

Rendered inside `SettingsPanel.tsx` as a new section. Always visible. Layout:

- **Current version:** `v0.1.0` (always shown)
- **"Check for updates" button** — calls `checkForUpdate()`; disabled when `status ∈ {checking, downloading}`
- When `status === 'available'`:
  - "Latest version: v0.2.0"
  - Rendered release notes (minimal markdown-to-HTML — headings, lists, links, paragraphs; no heavy dependency, a 30-line renderer is fine)
  - **"Download & install"** button
  - **"View on GitHub"** link (always the fallback escape hatch)
- When `status === 'downloading'`: "Downloading…" text. No determinate progress bar in v1 — installers are ~10MB and download fast. Can add later.
- When `status === 'ready'`: "Restart to apply" button
- When `status === 'error'`:
  - Error message
  - "Retry" button (if recoverable)
  - "Download from GitHub" link (always shown on error — universal fallback)

### Boot hook

One `useEffect` in `AppLayout.tsx`:

```tsx
useEffect(() => { checkForUpdate({ silent: true }); }, []);
```

`silent: true` means "don't surface errors to the UI on this automatic check" — a failed startup check leaves `status: 'idle'`. Manual checks always surface errors.

## Data flow

### Happy path

```
App mounts
  └─> useEffect → checkForUpdate({ silent: true })
      └─> status: 'checking'
      └─> fetch(api.github.com/repos/vulnix0x4/zenith/releases/latest)
      └─> parse tag_name, strip 'v', compare to currentVersion
          ├─> not newer → status: 'idle'
          └─> newer → status: 'available'
              └─> UpdateIndicator pill appears in title bar

User clicks pill OR "Download & install" in settings
  └─> downloadAndInstall()
      └─> pick matching asset by OS + filename pattern
      └─> status: 'downloading'
      └─> invoke('download_and_install_update', { url, filename })
          ├─> Windows: Rust spawns installer detached; frontend calls app.exit()
          ├─> macOS:   Rust spawns `open <dmg>`; status: 'ready'; user sees Finder
          └─> Linux:   Rust overwrites AppImage in place; status: 'ready'

User clicks "Restart to apply" (macOS/Linux only)
  └─> restart() → calls app.exit(); user manually relaunches OR
      relaunch helper if we can use @tauri-apps/plugin-process
```

### Error handling

| Failure | Behavior | User-visible result |
|---|---|---|
| Network error on startup check | `silent: true` swallows it; `status: 'idle'` | Nothing shown — no false alarm |
| Network error on manual check | Surfaced to store | Settings: "Couldn't check for updates. Retry?" |
| GitHub API rate limited (429) | Treated as network error | Same as above; realistically unreachable |
| GitHub API returns unexpected JSON | `status: 'error'`, generic message | "Update check failed. [Download from GitHub]" fallback shown |
| No releases exist yet (404) | Treated as "no update" | `status: 'idle'` |
| Asset for current OS missing | `status: 'error'` | "No download available for your platform. [View release on GitHub]" |
| Download fails mid-stream | `status: 'error'`, message from reqwest | "Download failed. [Retry] [Download from GitHub]" |
| Installer spawn fails | `status: 'error'` | "Couldn't launch installer. [Download from GitHub]" |
| User is on a newer version than latest (dev build) | `tag_name` ≤ `currentVersion` | `status: 'idle'` |

The "Download from GitHub" link is the universal escape hatch — always present on any error state, opens the release page in the default browser via `@tauri-apps/plugin-opener` (already installed).

## Release pipeline

### GitHub Actions workflow

File: `.github/workflows/release.yml`

Tag-triggered, 4-runner matrix. No secrets beyond the auto-provided `GITHUB_TOKEN`.

```yaml
on:
  push:
    tags: ['v*']

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest }
          - { os: macos-latest }         # ARM64 (Apple Silicon)
          - { os: macos-15-intel }       # Intel (macos-13 was retired Dec 2025)
          - { os: ubuntu-22.04 }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
      - name: Linux deps
        if: matrix.os == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev \
            libayatana-appindicator3-dev librsvg2-dev
      - run: npm ci
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Zenith ${{ github.ref_name }}'
          releaseDraft: true
          prerelease: false
```

`tauri-action` produces (by Tauri v2 defaults, with no bundle overrides):
- Windows: `Zenith_<version>_x64-setup.exe` (NSIS; MSI is opt-in and we're not opting in)
- macOS ARM64: `Zenith_<version>_aarch64.dmg` + `Zenith_<version>_aarch64.app.tar.gz`
- macOS Intel: `Zenith_<version>_x64.dmg` + `Zenith_<version>_x64.app.tar.gz`
- Linux: `Zenith_<version>_amd64.AppImage` + `.deb` + `.rpm`

We target the `.exe` / `.dmg` / `.AppImage` assets. The others are ignored by the updater (but useful to have for users who prefer them).

**Key config note:** we must NOT set `plugins.updater.pubkey` in `tauri.conf.json`. If we do, `tauri-action` refuses to build without a matching `TAURI_SIGNING_PRIVATE_KEY` secret. Leaving that block absent tells `tauri-action` to skip signing silently. We're intentionally skipping signing.

### Release steps (manual side)

```
1. Bump version in three files:
   - package.json
   - src-tauri/tauri.conf.json
   - src-tauri/Cargo.toml
2. git commit -am "Release v0.2.0"
3. git tag v0.2.0 && git push --tags
4. Wait ~15–25 min for CI (4 runners, Rust compile)
5. GitHub → Releases → the draft that just appeared → paste notes → Publish
6. Users see the update on next app launch or next manual "Check for updates"
```

Nice-to-have (not blocking v1): `scripts/bump-version.mjs` that takes a version string and edits all three files. ~15 lines. Add when the manual edit becomes annoying.

## Bootstrap

The first release users install must include the updater UI (the pill + settings section) so they can receive subsequent updates. Steps:

1. Delete the existing draft `v0.1.0` release.
2. Implement the feature on `main`.
3. Cut a fresh `v0.1.0` (or `v0.2.0`, to signal a feature change — author's call) through the new CI workflow.
4. Install locally from the published release. This is now the "updatable" baseline.

Anyone running a pre-updater build has to install once more manually to join the updatable track. Currently that's just the author, so not an issue.

## End-to-end smoke test

Before trusting the mechanism:

1. Cut `v0.1.0` (or whatever the baseline version is) through the pipeline. Install locally from the published release.
2. Make any trivial change, bump to `v0.1.1`. Cut through the pipeline.
3. Open the installed v0.1.0. Open settings → Updates → click "Check for updates."
4. Confirm the pill appears, click "Download & install," watch the installer run (or the DMG mount, on Mac), relaunch, verify version reads `v0.1.1`.

If that round-trip works once per platform, the mechanism is reliable.

## Out of scope for v1

- Delta / binary-patch updates (full installer each time; fine for ~10MB app)
- Rollback / downgrade flow (fix-forward with a new release if a bad one ships)
- Pre-release / beta channel (single stable channel only)
- Background polling while the app is running
- Determinate progress bar during download
- Full macOS auto-replace (drag-to-Applications is acceptable for now)
- OS code-signing (Apple notarization, Windows Authenticode) — deferred until the user complains about SmartScreen/Gatekeeper warnings
- Automatic retry on transient failures (user clicks Retry)

## File touches summary

New files:
- `src/stores/updaterStore.ts`
- `src/hooks/useUpdater.ts`
- `src/components/layout/UpdateIndicator.tsx` + `.module.css`
- `src/components/settings/UpdatesSection.tsx` + `.module.css`
- `src-tauri/src/updater.rs`
- `.github/workflows/release.yml`

Modified files:
- `src/App.tsx` or `src/components/layout/AppLayout.tsx` (add boot hook)
- `src/components/layout/TitleBar.tsx` (mount `UpdateIndicator`)
- `src/components/settings/SettingsPanel.tsx` (mount `UpdatesSection`)
- `src-tauri/src/lib.rs` (register `download_and_install_update` command)
- `src-tauri/Cargo.toml` (add `reqwest` dependency)
- `package.json` (add `@tauri-apps/plugin-os`)
- `src-tauri/tauri.conf.json` (enable `plugin-os` permissions; do NOT add `plugins.updater.pubkey`)
- `vite.config.ts` (inject `VITE_APP_VERSION` from `package.json`)
