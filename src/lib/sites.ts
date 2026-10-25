import { get, set } from "idb-keyval";

export interface SiteRecord {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  /** Where the local `hugo server` for this site is running. */
  previewOrigin: string;
}

const KEY = "sites";

// Directory handles are structured-cloneable, so they survive in IndexedDB
// across sessions. Permission does not: it has to be re-granted (Chrome can
// make it persistent once the user picks "Allow on every visit").
export async function loadSites(): Promise<SiteRecord[]> {
  return (await get<SiteRecord[]>(KEY)) ?? [];
}

export async function saveSites(sites: SiteRecord[]): Promise<void> {
  await set(KEY, sites);
}

export async function hasPermission(handle: FileSystemHandle): Promise<boolean> {
  // Browsers with only the origin private file system (the sample site) have no permission API, and need none.
  if (!("queryPermission" in handle)) return true;
  return (await handle.queryPermission({ mode: "readwrite" })) === "granted";
}

/** Must be called from a user gesture when permission is in the "prompt" state. */
export async function requestPermission(handle: FileSystemHandle): Promise<boolean> {
  if (await hasPermission(handle)) return true;
  if (!("requestPermission" in handle)) return false;
  return (await handle.requestPermission({ mode: "readwrite" })) === "granted";
}

export async function findExistingSite(sites: SiteRecord[], handle: FileSystemDirectoryHandle): Promise<SiteRecord | undefined> {
  for (const site of sites) if (await site.handle.isSameEntry(handle)) return site;
  return undefined;
}
