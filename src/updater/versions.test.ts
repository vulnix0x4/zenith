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
