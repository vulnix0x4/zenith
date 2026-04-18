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
