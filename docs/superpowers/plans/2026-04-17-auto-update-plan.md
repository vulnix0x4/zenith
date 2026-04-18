# Zenith auto-update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "Update available" pill to the title bar and an Updates section to the settings panel that together let a user detect and install a new Zenith release from GitHub in one click.

**Architecture:** Frontend queries `api.github.com/repos/vulnix0x4/zenith/releases/latest` directly — no Tauri updater plugin, no signing keys, no manifest. On click, a Rust Tauri command downloads the platform-matching installer asset to a temp dir and spawns it; the app exits so the installer can replace the binary. CI is a tag-triggered GitHub Actions matrix using `tauri-apps/tauri-action` with no secrets beyond the auto-provided `GITHUB_TOKEN`.

**Tech Stack:** Tauri v2, React 19, Zustand, TypeScript, Vite 7, Rust (`reqwest`), `@tauri-apps/plugin-os`, `@tauri-apps/plugin-opener`, Vitest (added for pure-logic tests).

**Reference:** See [`docs/superpowers/specs/2026-04-17-auto-update-design.md`](../specs/2026-04-17-auto-update-design.md) for design rationale.

---

## Phase 1 — Foundations

Pure plumbing. No user-visible changes yet.

### Task 1: Install `@tauri-apps/plugin-os`

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Add the frontend package**

Run: `npm install @tauri-apps/plugin-os@^2`

Expected: `package.json` gains `"@tauri-apps/plugin-os": "^2.x.x"` in `dependencies`.

**Step 2: Add the Rust crate**

Add to `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tauri-plugin-os = "2"
```

**Step 3: Register the plugin in Rust**

In `src-tauri/src/lib.rs`, add `.plugin(tauri_plugin_os::init())` to the Builder chain (alongside the existing `tauri_plugin_opener` and `tauri_plugin_dialog` plugins):

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_os::init())   // <-- add this line
    // ... rest unchanged
```

**Step 4: Grant the permission**

In `src-tauri/capabilities/default.json`, add `"os:default"` to the `permissions` array:

```json
"permissions": [
  "core:default",
  "opener:default",
  "dialog:default",
  "os:default"
]
```

**Step 5: Verify build**

Run: `npm run tauri build --debug` (or `npm run tauri dev` briefly, then quit)

Expected: Build succeeds without errors. No behavioral change.

**Step 6: Commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "chore: add @tauri-apps/plugin-os for platform detection"
```

---

### Task 2: Inject `VITE_APP_VERSION` at build time

**Files:**
- Modify: `vite.config.ts`
- Create: `src/vite-env.d.ts` (or modify if exists)

**Step 1: Read `package.json` version in Vite config**

Replace `vite.config.ts` with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8")
) as { version: string };

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

**Step 2: Add type for the env var**

The file `src/vite-env.d.ts` already exists. Append to it:

```ts
interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No errors.

**Step 4: Commit**

```bash
git add vite.config.ts src/vite-env.d.ts
git commit -m "feat: inject VITE_APP_VERSION from package.json at build time"
```

---

### Task 3: Add vitest for pure-logic unit tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

**Step 1: Install vitest**

Run: `npm install --save-dev vitest@^2`

**Step 2: Add a test script**

In `package.json`, add under `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
```

**Step 4: Verify test command works (with zero tests)**

Run: `npm test`

Expected: vitest runs, reports "no test files found" or similar, exits 0.

**Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for unit tests"
```

---

## Phase 2 — Pure update logic (TDD)

Two pure functions drive the whole feature: version comparison and asset selection. These are the only things where subtle bugs hide (off-by-one in version parsing, wrong asset matched, etc), so they get unit tests.

### Task 4: `compareVersions` — write the failing test

**Files:**
- Create: `src/updater/versions.test.ts`

**Step 1: Write the test file**

```ts
import { describe, it, expect } from "vitest";
import { compareVersions } from "./versions";

describe("compareVersions", () => {
  it("returns 0 for identical versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("strips leading 'v' from either side", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.3", "v1.2.3")).toBe(0);
    expect(compareVersions("v1.2.3", "v1.2.3")).toBe(0);
  });

  it("returns negative when a is older", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "1.3.0")).toBeLessThan(0);
    expect(compareVersions("1.2.3", "2.0.0")).toBeLessThan(0);
  });

  it("returns positive when a is newer", () => {
    expect(compareVersions("1.2.4", "1.2.3")).toBeGreaterThan(0);
    expect(compareVersions("1.3.0", "1.2.99")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  });

  it("compares major before minor before patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.1.99")).toBeGreaterThan(0);
  });

  it("throws on malformed version strings", () => {
    expect(() => compareVersions("1.2", "1.2.3")).toThrow();
    expect(() => compareVersions("abc", "1.2.3")).toThrow();
    expect(() => compareVersions("", "1.2.3")).toThrow();
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test`

Expected: FAIL — module `./versions` doesn't exist.

---

### Task 5: `compareVersions` — implement

**Files:**
- Create: `src/updater/versions.ts`

**Step 1: Write the implementation**

```ts
/**
 * Compare two version strings (major.minor.patch, optional leading 'v').
 * Returns negative if a < b, 0 if equal, positive if a > b.
 * Throws on malformed input.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const stripped = v.startsWith("v") ? v.slice(1) : v;
    const parts = stripped.split(".");
    if (parts.length !== 3) {
      throw new Error(`Invalid version: ${v}`);
    }
    const nums = parts.map((p) => {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid version: ${v}`);
      }
      return n;
    });
    return [nums[0], nums[1], nums[2]];
  };
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}

/** Returns true if `remote` is strictly newer than `local`. */
export function isNewerVersion(remote: string, local: string): boolean {
  return compareVersions(remote, local) > 0;
}
```

**Step 2: Run tests**

Run: `npm test`

Expected: all `compareVersions` tests PASS.

**Step 3: Commit**

```bash
git add src/updater/versions.ts src/updater/versions.test.ts
git commit -m "feat(updater): add compareVersions and isNewerVersion"
```

---

### Task 6: `selectAsset` — write the failing test

**Files:**
- Create: `src/updater/assets.test.ts`

**Step 1: Write the test file**

```ts
import { describe, it, expect } from "vitest";
import { selectAsset, type GithubAsset } from "./assets";

const mk = (name: string): GithubAsset => ({
  name,
  browser_download_url: `https://example.com/${name}`,
});

const assetsV020: GithubAsset[] = [
  mk("Zenith_0.2.0_x64-setup.exe"),
  mk("Zenith_0.2.0_x64.dmg"),
  mk("Zenith_0.2.0_aarch64.dmg"),
  mk("Zenith_0.2.0_amd64.AppImage"),
  mk("Zenith_0.2.0_amd64.deb"),
  mk("Zenith_0.2.0_x86_64.rpm"),
  mk("Zenith_0.2.0_aarch64.app.tar.gz"),
];

describe("selectAsset", () => {
  it("picks NSIS setup on Windows", () => {
    const a = selectAsset(assetsV020, { platform: "windows", arch: "x86_64" });
    expect(a?.name).toBe("Zenith_0.2.0_x64-setup.exe");
  });

  it("picks aarch64 DMG on macOS Apple Silicon", () => {
    const a = selectAsset(assetsV020, { platform: "macos", arch: "aarch64" });
    expect(a?.name).toBe("Zenith_0.2.0_aarch64.dmg");
  });

  it("picks x64 DMG on macOS Intel", () => {
    const a = selectAsset(assetsV020, { platform: "macos", arch: "x86_64" });
    expect(a?.name).toBe("Zenith_0.2.0_x64.dmg");
  });

  it("picks AppImage on Linux", () => {
    const a = selectAsset(assetsV020, { platform: "linux", arch: "x86_64" });
    expect(a?.name).toBe("Zenith_0.2.0_amd64.AppImage");
  });

  it("returns null when no matching asset exists", () => {
    const a = selectAsset([mk("Zenith_0.2.0_x64.dmg")], {
      platform: "windows",
      arch: "x86_64",
    });
    expect(a).toBeNull();
  });

  it("ignores unrelated files", () => {
    const noise = [
      mk("latest.json"),
      mk("Zenith_0.2.0_x64-setup.exe.sig"),
      mk("Zenith_0.2.0_x64-setup.exe"),
    ];
    const a = selectAsset(noise, { platform: "windows", arch: "x86_64" });
    expect(a?.name).toBe("Zenith_0.2.0_x64-setup.exe");
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test`

Expected: FAIL — module `./assets` doesn't exist.

---

### Task 7: `selectAsset` — implement

**Files:**
- Create: `src/updater/assets.ts`

**Step 1: Write the implementation**

```ts
export interface GithubAsset {
  name: string;
  browser_download_url: string;
}

export type Platform = "windows" | "macos" | "linux";
export type Arch = "x86_64" | "aarch64";

export interface HostInfo {
  platform: Platform;
  arch: Arch;
}

/**
 * Pick the installer asset matching the current host from a GitHub release's
 * `assets` array. Returns null if no suitable asset is present.
 *
 * Asset-naming conventions follow tauri-action defaults for Tauri v2:
 *   Windows x64:     Zenith_<ver>_x64-setup.exe
 *   macOS x64:       Zenith_<ver>_x64.dmg
 *   macOS aarch64:   Zenith_<ver>_aarch64.dmg
 *   Linux x64:       Zenith_<ver>_amd64.AppImage
 */
export function selectAsset(
  assets: GithubAsset[],
  host: HostInfo
): GithubAsset | null {
  const matches = (name: string): boolean => {
    // Exclude signature sidecar files defensively.
    if (name.endsWith(".sig")) return false;

    if (host.platform === "windows") {
      return name.endsWith("-setup.exe");
    }
    if (host.platform === "macos") {
      // Only DMG for the main install path; skip .app.tar.gz.
      if (!name.endsWith(".dmg")) return false;
      if (host.arch === "aarch64") return name.includes("_aarch64.");
      return name.includes("_x64.");
    }
    // linux
    return name.endsWith(".AppImage");
  };

  return assets.find((a) => matches(a.name)) ?? null;
}
```

**Step 2: Run tests**

Run: `npm test`

Expected: all `selectAsset` tests PASS. All previous `compareVersions` tests still PASS.

**Step 3: Commit**

```bash
git add src/updater/assets.ts src/updater/assets.test.ts
git commit -m "feat(updater): add selectAsset for platform-specific asset matching"
```

---

## Phase 3 — Zustand store and hook

State lives here, glued to the pure functions from Phase 2.

### Task 8: `updaterStore`

**Files:**
- Create: `src/stores/updaterStore.ts`

**Step 1: Write the store**

```ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { platform, arch } from "@tauri-apps/plugin-os";
import { type as osType } from "@tauri-apps/plugin-os";
import { isNewerVersion } from "../updater/versions";
import { selectAsset, type GithubAsset, type HostInfo, type Platform, type Arch } from "../updater/assets";

type Status =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterState {
  status: Status;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes: string | null;
  releaseUrl: string | null;
  error: string | null;

  checkForUpdate: (opts?: { silent?: boolean }) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismissError: () => void;
}

const RELEASES_URL =
  "https://api.github.com/repos/vulnix0x4/zenith/releases/latest";

const mapPlatform = (p: string): Platform | null => {
  if (p === "windows") return "windows";
  if (p === "macos") return "macos";
  if (p === "linux") return "linux";
  return null;
};

const mapArch = (a: string): Arch | null => {
  if (a === "x86_64") return "x86_64";
  if (a === "aarch64" || a === "arm64") return "aarch64";
  return null;
};

let lastSelectedAsset: GithubAsset | null = null;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  currentVersion: import.meta.env.VITE_APP_VERSION,
  latestVersion: null,
  releaseNotes: null,
  releaseUrl: null,
  error: null,

  checkForUpdate: async (opts) => {
    const silent = opts?.silent ?? false;
    if (get().status === "checking" || get().status === "downloading") return;

    set({ status: "checking", error: null });

    try {
      const res = await fetch(RELEASES_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const data = (await res.json()) as {
        tag_name: string;
        name?: string;
        body?: string;
        html_url: string;
        assets: GithubAsset[];
      };

      const local = get().currentVersion;
      const remote = data.tag_name;

      if (!isNewerVersion(remote, local)) {
        set({ status: "idle" });
        return;
      }

      const plat = mapPlatform(platform());
      const ar = mapArch(arch());
      if (!plat || !ar) {
        set({
          status: silent ? "idle" : "error",
          error: silent ? null : `Unsupported platform: ${platform()}/${arch()}`,
          releaseUrl: data.html_url,
        });
        return;
      }

      const host: HostInfo = { platform: plat, arch: ar };
      const asset = selectAsset(data.assets, host);
      if (!asset) {
        set({
          status: silent ? "idle" : "error",
          error: silent
            ? null
            : `No download available for your platform. View the release on GitHub.`,
          latestVersion: remote,
          releaseUrl: data.html_url,
        });
        return;
      }

      lastSelectedAsset = asset;
      set({
        status: "available",
        latestVersion: remote,
        releaseNotes: data.body ?? null,
        releaseUrl: data.html_url,
        error: null,
      });
    } catch (err) {
      if (silent) {
        set({ status: "idle" });
        return;
      }
      set({
        status: "error",
        error: err instanceof Error ? err.message : "Update check failed",
      });
    }
  },

  downloadAndInstall: async () => {
    if (get().status !== "available") return;
    const asset = lastSelectedAsset;
    if (!asset) {
      set({ status: "error", error: "No asset selected" });
      return;
    }

    set({ status: "downloading", error: null });
    try {
      await invoke("download_and_install_update", {
        url: asset.browser_download_url,
        filename: asset.name,
      });
      // On Windows, the Rust command spawns the installer and the app will
      // exit. On macOS/Linux, control returns here.
      const p = mapPlatform(platform());
      if (p === "windows") {
        // The app will be terminated imminently; leave status as 'downloading'.
        return;
      }
      set({ status: "ready" });
    } catch (err) {
      set({
        status: "error",
        error:
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Install failed",
      });
    }
  },

  dismissError: () => set({ status: "idle", error: null }),
}));

// For testing / introspection.
export function _resetUpdaterTestState() {
  lastSelectedAsset = null;
  useUpdaterStore.setState({
    status: "idle",
    latestVersion: null,
    releaseNotes: null,
    releaseUrl: null,
    error: null,
  });
}

// Use os.type() once at import time is not safe (async). Platform calls above are sync-by-wrapper but plugin-os exposes them as async in some versions — adjust at implementation time if types disagree.
export { osType };
```

**Step 2: Reconcile plugin-os async signatures**

> **Note for implementer:** `@tauri-apps/plugin-os` exposes `platform()` and `arch()` as synchronous in v2, but double-check the installed version's type signatures. If they're async, `await` the calls and rearrange the `checkForUpdate` body accordingly. The trailing `osType` export in the file above is a placeholder reminder — delete it when done verifying.

**Step 3: Verify types compile**

Run: `npx tsc --noEmit`

Expected: No errors. If there are errors about `platform()`/`arch()` being async, adjust as noted in step 2.

**Step 4: Commit**

```bash
git add src/stores/updaterStore.ts
git commit -m "feat(updater): add Zustand store for update state machine"
```

---

## Phase 4 — Rust download and install command

The Rust side does two things: download the installer, spawn it.

### Task 9: Add `reqwest` dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add reqwest**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
futures-util = "0.3"
```

(We already have `tokio` with the features we need.)

**Step 2: Verify build**

Run: `cd src-tauri && cargo check`

Expected: compiles without errors.

**Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: add reqwest for update downloads"
```

---

### Task 10: Write the updater module — download half

**Files:**
- Create: `src-tauri/src/updater.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod updater;`)

**Step 1: Create the module skeleton with the download function**

```rust
// src-tauri/src/updater.rs
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;

#[derive(thiserror::Error, Debug)]
pub enum UpdateError {
    #[error("download failed: {0}")]
    Download(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("install spawn failed: {0}")]
    Spawn(String),
}

impl serde::Serialize for UpdateError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

async fn download_to_temp(url: &str, filename: &str) -> Result<PathBuf, UpdateError> {
    let dest = std::env::temp_dir().join(filename);

    let client = reqwest::Client::builder()
        .user_agent(concat!("Zenith/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| UpdateError::Download(e.to_string()))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| UpdateError::Download(e.to_string()))?;

    if !response.status().is_success() {
        return Err(UpdateError::Download(format!(
            "HTTP {}",
            response.status()
        )));
    }

    let mut file = tokio::fs::File::create(&dest).await?;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| UpdateError::Download(e.to_string()))?;
        file.write_all(&bytes).await?;
    }
    file.flush().await?;
    Ok(dest)
}

#[tauri::command]
pub async fn download_and_install_update(
    url: String,
    filename: String,
) -> Result<(), UpdateError> {
    let path = download_to_temp(&url, &filename).await?;
    spawn_installer(&path).await?;
    Ok(())
}

// Platform-specific installer spawn — implemented in the next task.
#[cfg(target_os = "windows")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    let _ = path;
    unimplemented!("filled in next task")
}
#[cfg(target_os = "macos")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    let _ = path;
    unimplemented!("filled in next task")
}
#[cfg(target_os = "linux")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    let _ = path;
    unimplemented!("filled in next task")
}
```

**Step 2: Register the module and command**

In `src-tauri/src/lib.rs`:

Add `mod updater;` at the top with the other `mod` declarations.

Add `use updater::download_and_install_update;` with the other `use` lines.

Add `download_and_install_update,` inside the `tauri::generate_handler![...]` macro.

**Step 3: Verify build**

Run: `cd src-tauri && cargo check`

Expected: compiles (the `unimplemented!()` doesn't trigger at compile time).

**Step 4: Commit**

```bash
git add src-tauri/src/updater.rs src-tauri/src/lib.rs
git commit -m "feat(updater): add Rust module with download_to_temp"
```

---

### Task 11: Implement per-platform installer spawn

**Files:**
- Modify: `src-tauri/src/updater.rs`

**Step 1: Replace the three `spawn_installer` stubs with real implementations**

```rust
#[cfg(target_os = "windows")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    // Detached spawn; the app will exit immediately after this returns so the
    // installer can replace the locked binary. Tauri's NSIS template tries to
    // terminate the running instance, but has known race bugs — exiting the app
    // ourselves sidesteps that path.
    //
    // CREATE_NO_WINDOW + DETACHED_PROCESS so the installer survives our exit.
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

    std::process::Command::new(path)
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .spawn()
        .map_err(|e| UpdateError::Spawn(e.to_string()))?;
    Ok(())
}

#[cfg(target_os = "macos")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    // `open` mounts the DMG in Finder; user drags to /Applications. Not fully
    // automatic — see design doc for rationale.
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map_err(|e| UpdateError::Spawn(e.to_string()))?;
    Ok(())
}

#[cfg(target_os = "linux")]
async fn spawn_installer(path: &std::path::Path) -> Result<(), UpdateError> {
    // For AppImage: overwrite the currently-running binary file (Linux keeps
    // the inode alive) and chmod +x. User relaunches to pick up the new version.
    let current_exe = std::env::current_exe()
        .map_err(|e| UpdateError::Spawn(format!("current_exe: {e}")))?;

    // Only self-replace if we're running as an AppImage (APPIMAGE env var set).
    let appimage_path = std::env::var("APPIMAGE")
        .ok()
        .map(std::path::PathBuf::from)
        .unwrap_or(current_exe);

    tokio::fs::copy(path, &appimage_path).await?;

    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&appimage_path)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&appimage_path, perms)?;
    Ok(())
}
```

**Step 2: Frontend side — on Windows, exit the app after the command returns**

Add to `src/stores/updaterStore.ts`, in the `downloadAndInstall` action's Windows branch, after `invoke(...)` returns:

```ts
const { exit } = await import("@tauri-apps/plugin-process");
// Give the installer a moment to start before we exit
await new Promise((r) => setTimeout(r, 500));
await exit(0);
```

And install the process plugin:

Run: `npm install @tauri-apps/plugin-process@^2`

Add to `src-tauri/Cargo.toml`:

```toml
tauri-plugin-process = "2"
```

Register in `src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_process::init())
```

Add permission in `src-tauri/capabilities/default.json`:

```json
"process:default",
"process:allow-exit"
```

**Step 3: Verify build**

Run: `cd src-tauri && cargo check && cd .. && npx tsc --noEmit`

Expected: both pass.

**Step 4: Commit**

```bash
git add src-tauri/src/updater.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json src/stores/updaterStore.ts
git commit -m "feat(updater): implement per-platform installer spawn"
```

---

## Phase 5 — UI components

### Task 12: `UpdateIndicator` pill

**Files:**
- Create: `src/components/layout/UpdateIndicator.tsx`
- Create: `src/components/layout/UpdateIndicator.module.css`
- Modify: `src/components/layout/TitleBar.tsx`

**Step 1: Create the component**

```tsx
// src/components/layout/UpdateIndicator.tsx
import { useUpdaterStore } from "../../stores/updaterStore";
import styles from "./UpdateIndicator.module.css";

interface Props {
  onOpenSettings?: () => void;
}

export default function UpdateIndicator({ onOpenSettings }: Props) {
  const status = useUpdaterStore((s) => s.status);

  if (status === "idle" || status === "checking" || status === "error") {
    return null;
  }

  if (status === "available") {
    return (
      <button
        className={styles.pill}
        onClick={onOpenSettings}
        title="A new version of Zenith is available"
      >
        <span className={styles.dot} />
        Update available
      </button>
    );
  }

  if (status === "downloading") {
    return (
      <div className={styles.pill} aria-live="polite">
        Updating…
      </div>
    );
  }

  // ready (macOS / Linux)
  return (
    <button
      className={styles.pillReady}
      onClick={onOpenSettings}
      title="Restart Zenith to finish applying the update"
    >
      Restart to apply
    </button>
  );
}
```

**Step 2: Create the styles**

```css
/* src/components/layout/UpdateIndicator.module.css */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  margin-right: 8px;
  border: 1px solid var(--accent, #4a9eff);
  background: transparent;
  color: var(--accent, #4a9eff);
  border-radius: 999px;
  font-size: 12px;
  cursor: pointer;
  animation: fadeIn 180ms ease-out;
}
.pillReady {
  composes: pill;
  background: var(--accent, #4a9eff);
  color: #fff;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
```

**Step 3: Mount in `TitleBar.tsx`**

Replace the current `TitleBar.tsx`:

```tsx
import UpdateIndicator from "./UpdateIndicator";
import styles from "./TitleBar.module.css";

interface TitleBarProps {
  onSearchClick?: () => void;
  onOpenUpdates?: () => void;
}

export default function TitleBar({ onSearchClick, onOpenUpdates }: TitleBarProps) {
  return (
    <div className={styles.titleBar}>
      <div className={styles.logo}>ZENITH</div>
      <div className={styles.searchBar} onClick={onSearchClick}>
        <span className={styles.searchPlaceholder}>Search sessions, commands...</span>
        <span className={styles.searchShortcut}>&#x2318;K</span>
      </div>
      <div className={styles.spacer} />
      <UpdateIndicator onOpenSettings={onOpenUpdates} />
    </div>
  );
}
```

**Step 4: Verify build and type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

**Step 5: Commit**

```bash
git add src/components/layout/UpdateIndicator.tsx src/components/layout/UpdateIndicator.module.css src/components/layout/TitleBar.tsx
git commit -m "feat(updater): add title-bar UpdateIndicator pill"
```

---

### Task 13: `UpdatesSection` in settings

**Files:**
- Create: `src/components/settings/UpdatesSection.tsx`
- Create: `src/components/settings/UpdatesSection.module.css`
- Modify: `src/components/settings/SettingsPanel.tsx`

**Step 1: Create the section component**

```tsx
// src/components/settings/UpdatesSection.tsx
import { openUrl } from "@tauri-apps/plugin-opener";
import { useUpdaterStore } from "../../stores/updaterStore";
import settingsStyles from "./SettingsPanel.module.css";
import styles from "./UpdatesSection.module.css";

export default function UpdatesSection() {
  const {
    status,
    currentVersion,
    latestVersion,
    releaseNotes,
    releaseUrl,
    error,
    checkForUpdate,
    downloadAndInstall,
    dismissError,
  } = useUpdaterStore();

  const busy = status === "checking" || status === "downloading";

  return (
    <div className={settingsStyles.section} id="updates-section">
      <div className={settingsStyles.sectionTitle}>Updates</div>

      <div className={settingsStyles.row}>
        <span className={settingsStyles.label}>Current version</span>
        <span className={styles.value}>v{currentVersion}</span>
      </div>

      {status === "available" && latestVersion && (
        <div className={settingsStyles.row}>
          <span className={settingsStyles.label}>Latest version</span>
          <span className={styles.value}>{latestVersion}</span>
        </div>
      )}

      {releaseNotes && (status === "available" || status === "ready") && (
        <div className={styles.notes}>
          <div className={styles.notesTitle}>Release notes</div>
          <pre className={styles.notesBody}>{releaseNotes}</pre>
        </div>
      )}

      {status === "downloading" && (
        <div className={styles.row}>Downloading…</div>
      )}

      {status === "error" && error && (
        <div className={styles.errorBox}>
          <div>{error}</div>
          <button className={styles.btn} onClick={dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <div className={styles.actionRow}>
        <button
          className={styles.btn}
          onClick={() => checkForUpdate({ silent: false })}
          disabled={busy}
        >
          {status === "checking" ? "Checking…" : "Check for updates"}
        </button>

        {status === "available" && (
          <button
            className={styles.btnPrimary}
            onClick={downloadAndInstall}
            disabled={busy}
          >
            Download &amp; install
          </button>
        )}

        {releaseUrl && (
          <button
            className={styles.btnLink}
            onClick={() => {
              void openUrl(releaseUrl);
            }}
          >
            View on GitHub
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create the styles**

```css
/* src/components/settings/UpdatesSection.module.css */
.value {
  font-family: var(--mono, monospace);
  font-size: 12px;
  color: var(--fg-muted, #aaa);
}
.notes {
  margin: 8px 0;
}
.notesTitle {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted, #aaa);
  margin-bottom: 4px;
}
.notesBody {
  font-family: inherit;
  white-space: pre-wrap;
  font-size: 12px;
  max-height: 240px;
  overflow: auto;
  padding: 8px;
  background: var(--bg-subtle, rgba(255,255,255,0.03));
  border-radius: 4px;
  margin: 0;
}
.errorBox {
  padding: 8px;
  border-radius: 4px;
  background: rgba(255, 80, 80, 0.08);
  color: #ff8080;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
}
.actionRow {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}
.btn, .btnPrimary, .btnLink {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid var(--border, #333);
  background: transparent;
  color: inherit;
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btnPrimary {
  background: var(--accent, #4a9eff);
  border-color: var(--accent, #4a9eff);
  color: #fff;
}
.btnLink {
  border-color: transparent;
  text-decoration: underline;
}
```

**Step 3: Mount in `SettingsPanel.tsx`**

Add the import at the top:

```tsx
import UpdatesSection from "./UpdatesSection";
```

Add `<UpdatesSection />` as the first section inside the `container` div (before the General section):

```tsx
return (
  <div className={styles.container}>
    <UpdatesSection />
    {/* General Settings */}
    ...existing sections
  </div>
);
```

**Step 4: Verify type-check**

Run: `npx tsc --noEmit`

Expected: no errors.

**Step 5: Commit**

```bash
git add src/components/settings/UpdatesSection.tsx src/components/settings/UpdatesSection.module.css src/components/settings/SettingsPanel.tsx
git commit -m "feat(updater): add Updates section in settings panel"
```

---

### Task 14: Boot hook + wire up TitleBar → settings navigation

**Files:**
- Modify: `src/components/layout/AppLayout.tsx`

**Step 1: Read the current AppLayout**

Read: `src/components/layout/AppLayout.tsx` to understand how settings panel visibility is currently toggled and how `TitleBar`'s `onSearchClick` is wired.

**Step 2: Add the startup check**

At the top of the component body:

```tsx
import { useEffect } from "react";
import { useUpdaterStore } from "../../stores/updaterStore";

// ...inside the component:
const checkForUpdate = useUpdaterStore((s) => s.checkForUpdate);
useEffect(() => {
  void checkForUpdate({ silent: true });
}, [checkForUpdate]);
```

**Step 3: Wire `onOpenUpdates` to whatever opens the settings panel**

Pass an `onOpenUpdates` prop to `TitleBar` that both opens the settings panel and (optionally) scrolls to the Updates section via `document.getElementById("updates-section")?.scrollIntoView()`. Exact wiring depends on the current settings-panel open-state mechanism in `AppLayout`.

**Step 4: Verify type-check and run dev**

```bash
npx tsc --noEmit
npm run tauri dev
```

Quit after confirming the app launches cleanly. If there are no releases yet, the pill should not appear and settings → Updates should show "Current version: v0.1.0" + a "Check for updates" button that returns "idle" status.

**Step 5: Commit**

```bash
git add src/components/layout/AppLayout.tsx
git commit -m "feat(updater): check for updates on app launch + open settings from pill"
```

---

## Phase 6 — CI release pipeline

### Task 15: Add the release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Write the workflow**

```yaml
name: Release

on:
  push:
    tags:
      - "v*"

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest }
          - { os: macos-latest }        # ARM64
          - { os: macos-15-intel }      # Intel (macos-13 retired Dec 2025)
          - { os: ubuntu-22.04 }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - uses: dtolnay/rust-toolchain@stable

      - name: Install Linux build deps
        if: matrix.os == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libayatana-appindicator3-dev \
            librsvg2-dev \
            patchelf

      - run: npm ci

      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "Zenith ${{ github.ref_name }}"
          releaseDraft: true
          prerelease: false
```

**Step 2: Verify YAML parses**

Run: `npx js-yaml .github/workflows/release.yml > /dev/null 2>&1 && echo ok || echo "bad yaml"`

Expected: `ok`. (If `js-yaml` isn't installed, eyeball the indentation — tabs vs spaces cause more problems here than anything else.)

**Step 3: Commit and push**

```bash
git add .github/workflows/release.yml
git commit -m "ci: tag-triggered release workflow for all 3 platforms"
git push
```

---

## Phase 7 — Bootstrap and end-to-end smoke test

These steps take 30–60 minutes of elapsed time because of CI build time. Block them out.

### Task 16: Delete the stale `v0.1.0` draft release

**Step 1: Check existing releases**

Run: `gh release list`

Expected: one draft `v0.1.0` exists from 2026-04-15.

**Step 2: Delete it**

Run: `gh release delete v0.1.0 --yes`

Expected: deleted. No associated git tag yet (it was draft, never tagged).

---

### Task 17: Cut the baseline `v0.1.0` through the new pipeline

**Step 1: Confirm version is `0.1.0` in all three manifests**

Check: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`. All should say `0.1.0`. If any drifted, fix and commit a separate "chore: sync version to 0.1.0" commit.

**Step 2: Tag and push**

```bash
git tag v0.1.0
git push --tags
```

**Step 3: Wait for CI**

Open `https://github.com/vulnix0x4/zenith/actions` and watch the matrix run. Expected duration: 15–25 min. Expected outcome: all 4 jobs succeed.

**Step 4: Publish the draft**

When the draft release appears at `https://github.com/vulnix0x4/zenith/releases`:
1. Click the draft.
2. Confirm all expected assets are attached (Windows `.exe`, two Mac `.dmg`, Linux `.AppImage`/`.deb`/`.rpm`).
3. Add brief release notes (e.g., "Initial release with auto-update.").
4. Click **Publish release**.

**Step 5: Install locally from the published release**

Download the installer for your current OS from the release page, run it, confirm Zenith launches as `v0.1.0`.

---

### Task 18: Cut a `v0.1.1` for end-to-end verification

**Step 1: Make a trivial change**

Modify `README.md` or add a changelog entry — anything to justify a version bump.

**Step 2: Bump version in all three files**

- `package.json`: `"version": "0.1.1"`
- `src-tauri/tauri.conf.json`: `"version": "0.1.1"`
- `src-tauri/Cargo.toml`: `version = "0.1.1"`

**Step 3: Commit, tag, push**

```bash
git commit -am "Release v0.1.1"
git tag v0.1.1
git push && git push --tags
```

**Step 4: Wait for CI, publish the draft**

Same as Task 17 steps 3–4.

**Step 5: Smoke test the update**

With the locally-installed `v0.1.0` still installed:

1. Open Zenith.
2. Open settings → Updates. Confirm "Current version: v0.1.0".
3. Click **Check for updates**. Confirm the store transitions to `available`, the pill appears in the title bar, "Latest version: v0.1.1" shows in settings, release notes render.
4. Click **Download & install**.
5. On Windows: installer UI appears, Zenith quits, installer replaces + relaunches, new Zenith reads `v0.1.1`. ✅
6. On macOS: DMG mounts in Finder, drag to Applications, open, new Zenith reads `v0.1.1`. ✅
7. On Linux: pill turns to "Restart to apply", quit + relaunch the AppImage, new version reads `v0.1.1`. ✅

If all three pass on the platforms you actually use, the mechanism is reliable.

---

### Task 19: Merge the branch

Once the smoke test passes, open a PR from `claude/serene-ptolemy-b36364` → `main`, give it a skim, merge.

```bash
gh pr create --title "feat: in-app updater with one-click GitHub Releases download" \
  --body "$(cat <<'EOF'
## Summary
- Adds title-bar "Update available" pill + Settings → Updates section
- Queries GitHub Releases API directly, downloads matching installer per platform
- Tag-triggered GitHub Actions workflow produces signed-by-GitHub (but not Ed25519-signed) artifacts for all 3 platforms

## Test plan
- [x] Bootstrap v0.1.0 released through new pipeline
- [x] v0.1.1 released and smoke-tested end-to-end on at least one platform
- [ ] Further testing on macOS and Linux if possible

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the implementer

- **Trust the tests in Phase 2.** `compareVersions` and `selectAsset` are the only places a subtle bug would ship silently. Everything else is either visible in the UI or fails at build time.
- **The `lastSelectedAsset` module-level variable in the store** is intentional — we need to preserve the selected asset between the `checkForUpdate` call and `downloadAndInstall`, without exposing it as reactive state (it's not user-facing). If you want to make it per-instance, move it onto the store state.
- **`@tauri-apps/plugin-os`'s `platform()` / `arch()`** may be async in the version you install. If so, adjust the store's `checkForUpdate` to `await` them. Compile errors will guide you.
- **Don't add `plugins.updater.pubkey` to `tauri.conf.json`.** If you do, `tauri-action` will refuse to build without a matching private-key secret. We're intentionally not using the Tauri updater plugin.
- **Committing between tasks matters** — the plan is structured so every commit leaves the repo green (tests pass, build works). Preserve that when you commit.
