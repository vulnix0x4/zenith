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
