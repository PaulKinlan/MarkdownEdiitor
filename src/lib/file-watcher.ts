// Watches a site folder with FileSystemObserver (Chrome 133), so edits made
// outside the editor (git, another app, an agent working through the local
// helper) show up straight away instead of on the next window focus.

export interface FolderChanges {
  /** Paths (relative to the site root) that changed, appeared or disappeared. Moves list both ends. */
  paths: Set<string>;
  /** The browser lost track (overflow or error): treat everything as changed. */
  rescan: boolean;
}

export function canWatch(): boolean {
  return typeof FileSystemObserver !== "undefined";
}

/** Folds a batch of records into the set of paths that changed. Ignores dot-folders (.git) and build output. */
export function collectChanges(records: readonly Pick<FileSystemChangeRecord, "type" | "relativePathComponents" | "relativePathMovedFrom">[]): FolderChanges {
  const changes: FolderChanges = { paths: new Set(), rescan: false };
  for (const record of records) {
    if (record.type === "unknown" || record.type === "errored") {
      changes.rescan = true;
      continue;
    }
    for (const parts of [record.relativePathComponents, record.relativePathMovedFrom]) {
      if (parts?.length && !ignored(parts)) changes.paths.add(parts.join("/"));
    }
  }
  return changes;
}

const IGNORED_DIRS = new Set(["public", "resources", "node_modules"]);

function ignored(parts: readonly string[]): boolean {
  return parts.some((p) => p.startsWith(".")) || IGNORED_DIRS.has(parts[0]);
}

/**
 * Observes `root` recursively and calls `onChange` with changes batched over
 * `delay` ms, since a save or a checkout arrives as a burst of records.
 * Returns a function that stops watching, or undefined when the browser can't watch.
 */
export async function watchFolder(root: FileSystemDirectoryHandle, onChange: (changes: FolderChanges) => void, delay = 250): Promise<(() => void) | undefined> {
  if (typeof FileSystemObserver === "undefined") return undefined;
  let pending: FolderChanges = { paths: new Set(), rescan: false };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new FileSystemObserver((records) => {
    const batch = collectChanges(records);
    batch.paths.forEach((p) => pending.paths.add(p));
    pending.rescan ||= batch.rescan;
    if (!pending.paths.size && !pending.rescan) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changes = pending;
      pending = { paths: new Set(), rescan: false };
      onChange(changes);
    }, delay);
  });
  try {
    await observer.observe(root, { recursive: true });
  } catch (e) {
    console.warn("Can't watch the site folder for changes", e);
    observer.disconnect();
    return undefined;
  }
  return () => {
    clearTimeout(timer);
    observer.disconnect();
  };
}
