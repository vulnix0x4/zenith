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
