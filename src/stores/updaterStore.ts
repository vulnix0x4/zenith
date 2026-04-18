import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { platform, arch } from "@tauri-apps/plugin-os";
import { isNewerVersion } from "../updater/versions";
import {
  selectAsset,
  type GithubAsset,
  type HostInfo,
  type Platform,
  type Arch,
} from "../updater/assets";

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
  /**
   * Set to true after a non-silent check that confirms the installed
   * version is the latest. Cleared on the next check. Drives a
   * transient "You're on the latest version" message in the UI.
   */
  upToDate: boolean;

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

// Stored outside Zustand state because it's an opaque handle, not UI
// state — keeping it out of the store saves a needless subscriber wakeup.
let lastSelectedAsset: GithubAsset | null = null;

// Cache GitHub API responses for silent (boot-time) checks to avoid
// burning through the 60 req/hr unauthenticated rate limit when the
// dev-loop reopens the app rapidly.
interface CachedResponse {
  at: number; // Date.now()
  data: {
    tag_name: string;
    body: string | null;
    html_url: string;
    assets: GithubAsset[];
  };
}
let cachedResponse: CachedResponse | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: "idle",
  currentVersion: import.meta.env.VITE_APP_VERSION,
  latestVersion: null,
  releaseNotes: null,
  releaseUrl: null,
  error: null,
  upToDate: false,

  checkForUpdate: async (opts) => {
    const silent = opts?.silent ?? false;
    if (get().status === "checking" || get().status === "downloading") return;

    set({ status: "checking", error: null, upToDate: false });

    try {
      // Manual "Check for updates" always wants a fresh result.
      if (!silent) cachedResponse = null;

      let data: CachedResponse["data"];
      if (
        cachedResponse &&
        Date.now() - cachedResponse.at < CACHE_TTL_MS
      ) {
        data = cachedResponse.data;
      } else {
        const res = await fetch(RELEASES_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
        const raw = (await res.json()) as {
          tag_name: string;
          name?: string;
          body?: string;
          html_url: string;
          assets: GithubAsset[];
        };
        if (
          typeof raw.tag_name !== "string" ||
          typeof raw.html_url !== "string" ||
          !Array.isArray(raw.assets)
        ) {
          throw new Error("Unexpected GitHub response shape");
        }
        data = {
          tag_name: raw.tag_name,
          body: raw.body ?? null,
          html_url: raw.html_url,
          assets: raw.assets,
        };
        cachedResponse = { at: Date.now(), data };
      }

      const local = get().currentVersion;
      const remote = data.tag_name;

      if (!isNewerVersion(remote, local)) {
        set({ status: "idle", upToDate: !silent });
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
        releaseNotes: data.body,
        releaseUrl: data.html_url,
        error: null,
      });
    } catch (err) {
      console.error("updater:", err);
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
        const { exit } = await import("@tauri-apps/plugin-process");
        // Give the installer a moment to start before we exit
        await new Promise((r) => setTimeout(r, 500));
        await exit(0);
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

  dismissError: () => {
    if (get().status !== "error") return;
    set({ status: "idle", error: null });
  },
}));

// For testing / introspection.
export function _resetUpdaterTestState() {
  lastSelectedAsset = null;
  cachedResponse = null;
  useUpdaterStore.setState({
    status: "idle",
    latestVersion: null,
    releaseNotes: null,
    releaseUrl: null,
    error: null,
    upToDate: false,
  });
}
