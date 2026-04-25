/** HTML5 drag-and-drop traversal helpers.
 *
 *  When the user drops files / folders onto the file browser, the webview
 *  hands us either a `FileList` (flat -- legacy or no folders) or a
 *  `DataTransferItemList` from which we can pull `FileSystemEntry`s via
 *  `webkitGetAsEntry()`. The directory entries let us walk into folders
 *  and recover the relative path of every contained file so we can mirror
 *  the structure on the remote.
 *
 *  We resolve to a flat `DroppedFile[]`: each element is one file plus the
 *  relative path it had inside the drop (e.g. `proj/src/index.ts`). Empty
 *  directories are not surfaced -- the caller still ensures every parent
 *  dir exists before uploading. */

export interface DroppedFile {
  file: File;
  /** POSIX-style path relative to the drop root. For a flat-file drop this
   *  is just `file.name`. For a folder drop it includes the top-level
   *  folder, e.g. `myFolder/sub/file.txt`. */
  relativePath: string;
}

/** Browser quirk: `FileSystemDirectoryReader.readEntries` only returns up
 *  to ~100 entries per call. Keep calling until it returns an empty array. */
function readAllEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
          } else {
            all.push(...batch);
            pump();
          }
        },
        (err) => reject(err)
      );
    };
    pump();
  });
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  relativeBase: string,
  out: DroppedFile[]
): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    try {
      const file = await entryFile(fileEntry);
      out.push({
        file,
        relativePath: relativeBase ? `${relativeBase}/${entry.name}` : entry.name,
      });
    } catch {
      // Inaccessible files (sandbox restrictions, permission errors) get
      // skipped quietly -- the user gets the rest of the drop instead of an
      // all-or-nothing failure.
    }
    return;
  }
  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry;
    const reader = dirEntry.createReader();
    const childRelative = relativeBase
      ? `${relativeBase}/${entry.name}`
      : entry.name;
    let children: FileSystemEntry[] = [];
    try {
      children = await readAllEntries(reader);
    } catch {
      return;
    }
    for (const child of children) {
      await walkEntry(child, childRelative, out);
    }
  }
}

/** Flatten a drop into the list of files we want to upload, with each
 *  file's path relative to the drop root preserved.
 *
 *  Accepts either a `DataTransferItemList` (preferred -- supports folder
 *  traversal via `webkitGetAsEntry`) or a `FileList` (fallback for
 *  environments without the entry API; folders are silently dropped). */
export async function collectDroppedItems(
  items: DataTransferItemList | FileList
): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];

  if (isDataTransferItemList(items)) {
    // Snapshot up-front: `DataTransferItemList` is invalidated when the
    // drop event handler returns, but we hold `FileSystemEntry` references
    // which remain valid for traversal.
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function'
        ? item.webkitGetAsEntry()
        : null;
      if (entry) {
        entries.push(entry);
      } else {
        // No entry API -- fall back to the plain File so at least flat
        // drops still work.
        const f = item.getAsFile();
        if (f) out.push({ file: f, relativePath: f.name });
      }
    }
    for (const entry of entries) {
      await walkEntry(entry, '', out);
    }
    return out;
  }

  // FileList path (no folder support).
  for (let i = 0; i < items.length; i++) {
    const f = items[i];
    out.push({ file: f, relativePath: f.name });
  }
  return out;
}

function isDataTransferItemList(
  v: DataTransferItemList | FileList
): v is DataTransferItemList {
  // FileList items are `File`s; DataTransferItemList items are
  // `DataTransferItem`s with a `kind` field. Sniffing on the first item
  // avoids relying on `instanceof` (which can break across realms).
  if (v.length === 0) return 'add' in v && 'remove' in v;
  const first = (v as DataTransferItemList)[0];
  return typeof (first as unknown as { kind?: unknown }).kind === 'string';
}
