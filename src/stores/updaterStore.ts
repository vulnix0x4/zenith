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
