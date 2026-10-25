// Thin helpers over the File System Access API. Paths are POSIX-style and
// relative to a site's root directory handle.

export async function getDir(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemDirectoryHandle | undefined> {
  let dir = root;
  for (const part of path.split("/").filter(Boolean)) {
    try {
      dir = await dir.getDirectoryHandle(part, { create });
    } catch (e) {
      if (isNotFound(e)) return undefined;
      throw e;
    }
  }
  return dir;
}

export async function getFile(
  root: FileSystemDirectoryHandle,
  path: string,
  create = false,
): Promise<FileSystemFileHandle | undefined> {
  const parts = path.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name) return undefined;
  const dir = await getDir(root, parts.join("/"), create);
  if (!dir) return undefined;
  try {
    return await dir.getFileHandle(name, { create });
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

export async function readText(root: FileSystemDirectoryHandle, path: string): Promise<string | undefined> {
  const handle = await getFile(root, path);
  return handle ? (await handle.getFile()).text() : undefined;
}

export async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  contents: string | Blob,
): Promise<File> {
  const handle = await getFile(root, path, true);
  if (!handle) throw new Error(`Cannot write ${path}`);
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
  return handle.getFile();
}

export async function exists(root: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  return (await getFile(root, path)) !== undefined || (await getDir(root, path)) !== undefined;
}

export interface WalkEntry {
  path: string;
  handle: FileSystemFileHandle;
}

/** Recursively lists files under `path` whose names pass `filter`. */
export async function walk(
  root: FileSystemDirectoryHandle,
  path: string,
  filter: (name: string) => boolean,
): Promise<WalkEntry[]> {
  const start = await getDir(root, path);
  if (!start) return [];
  const out: WalkEntry[] = [];
  const visit = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const entry of dir.values()) {
      const p = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") await visit(entry, p);
      } else if (filter(entry.name)) {
        out.push({ path: p, handle: entry });
      }
    }
  };
  await visit(start, path.replace(/\/$/, ""));
  return out;
}

export async function listNames(root: FileSystemDirectoryHandle, path: string, kind: FileSystemHandleKind): Promise<string[]> {
  const dir = await getDir(root, path);
  if (!dir) return [];
  const names: string[] = [];
  for await (const entry of dir.values()) if (entry.kind === kind) names.push(entry.name);
  return names.sort();
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError");
}
