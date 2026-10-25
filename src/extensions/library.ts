// Where extensions come from, and which ones the author has allowed to run.
//
// - Built-in: shipped with the editor, on unless turned off.
// - Site: `.editor/extensions/<id>.js` or `.editor/extensions/<id>/index.js`
//   in the open site's folder, so they travel with the blog's repo.
// - Installed: from a URL, a file, or written by the assistant. Kept in
//   IndexedDB and, when the agent server is reachable, in its ExtensionStore
//   Durable Object, so every browser sees the same library.
//
// Nothing but a built-in runs until the author has approved its permissions.
// An update that asks for more permissions waits for approval again.

import { get, set } from "idb-keyval";
import { apiUrl, type AgentSettings } from "../lib/agent-client";
import { getDir } from "../lib/fs";
import { builtinExtensions } from "./builtin";
import { parseExtension } from "./loader";
import type { ExtensionRecord, Permission } from "./types";

const INSTALLED_KEY = "md-editor:extensions:installed";
const APPROVALS_KEY = "md-editor:extensions:approvals";
export const SITE_EXTENSIONS_DIR = ".editor/extensions";

export interface LibraryEntry extends ExtensionRecord {
  /** Approval key: "builtin:<id>", "installed:<id>" or "site:<siteId>:<id>". */
  key: string;
  enabled: boolean;
  /** Permissions the manifest asks for that the author hasn't approved. */
  unapproved: Permission[];
  updatedAt?: number;
  /** Set when a site file couldn't be parsed. */
  error?: string;
}

interface Approvals {
  /** Approved permissions by approval key; absent means never approved. */
  approved: Record<string, Permission[]>;
  /** Keys the author turned off. */
  disabled: string[];
}

interface Installed {
  id: string;
  /** Empty once removed. */
  source: string;
  from?: string;
  updatedAt: number;
  /** A removal, kept so syncing removes it everywhere instead of bringing it back. */
  deleted?: boolean;
}

async function loadApprovals(): Promise<Approvals> {
  return { approved: {}, disabled: [], ...((await get<Approvals>(APPROVALS_KEY)) ?? {}) };
}

async function loadInstalled(): Promise<Installed[]> {
  return (await get<Installed[]>(INSTALLED_KEY)) ?? [];
}

function entry(record: ExtensionRecord, key: string, approvals: Approvals, extra: Partial<LibraryEntry> = {}): LibraryEntry {
  const approved = record.origin === "builtin" ? record.manifest.permissions : (approvals.approved[key] ?? []);
  const unapproved = record.manifest.permissions.filter((p) => !approved.includes(p));
  const everApproved = record.origin === "builtin" || key in approvals.approved;
  return { ...record, key, unapproved, enabled: everApproved && !unapproved.length && !approvals.disabled.includes(key), ...extra };
}

/** Every known extension for this site, with whether it may run. */
export async function listExtensions(site?: { id: string; handle: FileSystemDirectoryHandle }): Promise<LibraryEntry[]> {
  const approvals = await loadApprovals();
  const out: LibraryEntry[] = builtinExtensions().map((r) => entry(r, `builtin:${r.manifest.id}`, approvals));
  for (const item of await loadInstalled()) {
    if (item.deleted) continue;
    try {
      out.push(entry({ ...parseExtension(item.source), origin: "installed", from: item.from }, `installed:${item.id}`, approvals, { updatedAt: item.updatedAt }));
    } catch {
      // A stored extension that no longer parses is skipped; reinstalling replaces it.
    }
  }
  if (site) out.push(...(await siteExtensions(site.id, site.handle, approvals)));
  // One id runs once: built-in, then installed, then site.
  const seen = new Set<string>();
  return out.map((e) => {
    if (e.error) return e;
    if (seen.has(e.manifest.id)) return { ...e, enabled: false, error: `Another extension already uses the id ${e.manifest.id}.` };
    seen.add(e.manifest.id);
    return e;
  });
}

async function siteExtensions(siteId: string, root: FileSystemDirectoryHandle, approvals: Approvals): Promise<LibraryEntry[]> {
  const dir = await getDir(root, SITE_EXTENSIONS_DIR);
  if (!dir) return [];
  const out: LibraryEntry[] = [];
  for await (const handle of dir.values()) {
    let file: FileSystemFileHandle | undefined;
    if (handle.kind === "file" && /\.m?js$/.test(handle.name)) file = handle;
    else if (handle.kind === "directory") file = await handle.getFileHandle("index.js").catch(() => undefined);
    if (!file) continue;
    const path = `${SITE_EXTENSIONS_DIR}/${handle.kind === "file" ? handle.name : `${handle.name}/index.js`}`;
    const source = await (await file.getFile()).text();
    try {
      const record: ExtensionRecord = { ...parseExtension(source), origin: "site", from: path };
      out.push(entry(record, `site:${siteId}:${record.manifest.id}`, approvals));
    } catch (e) {
      const id = handle.name.replace(/\.m?js$/, "");
      out.push({
        manifest: { id, name: id, permissions: [] },
        source,
        origin: "site",
        from: path,
        key: `site:${siteId}:${id}`,
        enabled: false,
        unapproved: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

/** Approves the extension's current permissions and turns it on. */
export async function approve(e: Pick<LibraryEntry, "key" | "manifest">) {
  const approvals = await loadApprovals();
  approvals.approved[e.key] = [...e.manifest.permissions];
  approvals.disabled = approvals.disabled.filter((k) => k !== e.key);
  await set(APPROVALS_KEY, approvals);
}

export async function setEnabled(key: string, enabled: boolean) {
  const approvals = await loadApprovals();
  approvals.disabled = approvals.disabled.filter((k) => k !== key);
  if (!enabled) approvals.disabled.push(key);
  await set(APPROVALS_KEY, approvals);
}

/**
 * Adds or replaces an installed extension, here and in the server's library.
 * Returns the parsed record; throws if the source has no valid manifest.
 */
export async function install(source: string, from: string | undefined, settings?: AgentSettings): Promise<ExtensionRecord> {
  const record = { ...parseExtension(source), origin: "installed" as const, ...(from ? { from } : {}) };
  const id = record.manifest.id;
  const builtin = builtinExtensions().some((b) => b.manifest.id === id);
  if (builtin) throw new Error(`${id} is the id of a built-in extension; pick another.`);
  const list = (await loadInstalled()).filter((i) => i.id !== id);
  const item: Installed = { id, source, ...(from ? { from } : {}), updatedAt: Date.now() };
  list.push(item);
  await set(INSTALLED_KEY, list);
  if (settings) await upload(settings, item).catch(() => undefined);
  return record;
}

export async function uninstall(id: string, settings?: AgentSettings) {
  const item: Installed = { id, source: "", updatedAt: Date.now(), deleted: true };
  await set(INSTALLED_KEY, [...(await loadInstalled()).filter((i) => i.id !== id), item]);
  if (settings) await upload(settings, item).catch(() => undefined);
}

function upload(settings: AgentSettings, item: Installed) {
  const path = `/api/extensions/${item.id}`;
  return item.deleted
    ? remote(settings, `${path}?at=${item.updatedAt}`, { method: "DELETE" })
    : remote(settings, path, { method: "PUT", body: JSON.stringify({ source: item.source, from: item.from, updatedAt: item.updatedAt }) });
}

/** Fetches an extension's source from a URL (it must be served with CORS if it's on another origin). */
export async function fetchSource(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.text();
}

/**
 * Brings this browser's installed extensions and the server's library together.
 * For each id the newer change wins, removals included, and changes only here
 * are uploaded. Returns true if anything here changed.
 */
export async function syncLibrary(settings: AgentSettings): Promise<boolean> {
  const server = await remote<Installed[]>(settings, "/api/extensions");
  const local = await loadInstalled();
  const byId = new Map(local.map((i) => [i.id, i]));
  let changed = false;
  for (const item of server) {
    const mine = byId.get(item.id);
    if (mine ? mine.updatedAt < item.updatedAt : !item.deleted) {
      byId.set(item.id, item);
      changed = true;
    }
  }
  const serverIds = new Map(server.map((s) => [s.id, s.updatedAt]));
  for (const item of local) {
    const theirs = serverIds.get(item.id);
    if (theirs === undefined || theirs < item.updatedAt) await upload(settings, item).catch(() => undefined);
  }
  if (changed) await set(INSTALLED_KEY, [...byId.values()]);
  return changed;
}

async function remote<T>(settings: AgentSettings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(settings, path), {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${path}: ${res.status}`);
  return body;
}
