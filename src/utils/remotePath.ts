/** Remote-path helpers for SFTP operations.
 *
 *  Remote paths use POSIX semantics regardless of the local OS, so we never
 *  produce backslashes here. Callers pass arbitrary user input
 *  (current dir, filenames from a drop) so the helpers are written to be
 *  forgiving about leading / trailing slashes. */

/** Join a parent dir and a child segment with exactly one `/` between them.
 *  Trims trailing slashes off the parent and leading slashes off the child
 *  so accidental double slashes don't poison the result. */
export function joinRemote(parent: string, child: string): string {
  const left = parent.replace(/\/+$/, '');
  const right = child.replace(/^\/+/, '');
  if (!left) return '/' + right;
  return `${left}/${right}`;
}

/** Last path segment of a path that might use either `/` (remote, drop
 *  relative path) or `\` (Windows local file dialog return value). Returns
 *  the input unchanged if no separator is found, which matches POSIX
 *  basename's behavior on bare filenames. */
export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const m = trimmed.match(/[^\\/]+$/);
  return m ? m[0] : trimmed;
}
