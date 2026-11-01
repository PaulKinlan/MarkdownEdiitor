import { apiUrl, type AgentSettings } from "./agent-client";

// Things the author saves in one browser (snippets, custom quick edits,
// extension data) are kept in that browser and copied to the agent server's
// FeatureStore (/api/features/<feature>/global/<key>), so a new machine gets
// them back. Each key carries the time it last changed; the newer side wins,
// on the server too (?ifNewer), and removals are kept as tombstones so they
// travel as well.

export interface SyncedEntry<T = unknown> {
  value?: T;
  updatedAt: number;
  deleted?: boolean;
}

export type SyncedEntries<T = unknown> = Record<string, SyncedEntry<T>>;

type Fetch = typeof fetch;

function featurePath(feature: string, key?: string) {
  return `/api/features/${feature}/global${key === undefined ? "" : `/${encodeURIComponent(key)}`}`;
}

async function call<T>(settings: AgentSettings, path: string, init: RequestInit = {}, fetchImpl: Fetch = fetch): Promise<T> {
  const res = await fetchImpl(apiUrl(settings, path), {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${path}: ${res.status}`);
  return body;
}

/** Uploads one entry, unless the server already holds a change at least as new. */
export function pushEntry(settings: AgentSettings, feature: string, key: string, entry: SyncedEntry, fetchImpl: Fetch = fetch) {
  return call(settings, `${featurePath(feature, key)}?ifNewer=1`, { method: "PUT", body: JSON.stringify(entry) }, fetchImpl);
}

function isEntry(v: unknown): v is SyncedEntry {
  return !!v && typeof v === "object" && typeof (v as SyncedEntry).updatedAt === "number";
}

/**
 * Brings local entries and the server's together. For each key the newer
 * change wins; keys that are newer here (or only here) are uploaded. If any
 * server entry can't be read, nothing is uploaded or changed. Returns the
 * server entries that are newer than the local ones.
 */
export async function syncEntries<T>(settings: AgentSettings, feature: string, local: SyncedEntries<T>, fetchImpl: Fetch = fetch): Promise<SyncedEntries<T>> {
  const keys = await call<{ key: string }[]>(settings, featurePath(feature), {}, fetchImpl);
  const server = new Map<string, SyncedEntry<T>>();
  await Promise.all(
    keys.map(async ({ key }) => {
      const got = await call<{ value: unknown }>(settings, featurePath(feature, key), {}, fetchImpl);
      if (isEntry(got.value)) server.set(key, got.value as SyncedEntry<T>);
    }),
  );
  const newer: SyncedEntries<T> = {};
  for (const [key, theirs] of server) {
    const mine = local[key];
    if (mine ? mine.updatedAt < theirs.updatedAt : !theirs.deleted) newer[key] = theirs;
  }
  await Promise.all(
    Object.entries(local).map(([key, mine]) => {
      const theirs = server.get(key);
      if (!theirs || theirs.updatedAt < mine.updatedAt) return pushEntry(settings, feature, key, mine, fetchImpl).catch(() => undefined);
    }),
  );
  return newer;
}

interface KeyValues {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  keys(): Promise<IDBValidKey[]>;
}

/** Where a key's change time is kept: its own entry, so saves of different keys never race. */
const timeKey = (timesPrefix: string, key: string) => `${timesPrefix}${key}`;
/** When a key last changed here; undefined if it never has since syncing existed. */
const timeOf = async (kv: KeyValues, timesPrefix: string, key: string) => {
  const t = await kv.get(timeKey(timesPrefix, key));
  return typeof t === "number" ? t : undefined;
};

/**
 * Syncs the keys starting with `prefix` in a key/value store, with each
 * key's change time under `timesPrefix + key`. Returns the keys that changed here.
 */
export async function syncKeyValues(settings: AgentSettings, feature: string, prefix: string, timesPrefix: string, kv: KeyValues, fetchImpl: Fetch = fetch): Promise<string[]> {
  const local: SyncedEntries = {};
  for (const k of await kv.keys()) {
    if (typeof k !== "string" || !k.startsWith(prefix)) continue;
    // Data saved before syncing existed has no time; 0 uploads it without overriding anything newer.
    local[k] = { value: await kv.get(k), updatedAt: (await timeOf(kv, timesPrefix, k)) ?? 0 };
  }
  const newer = await syncEntries(settings, feature, local, fetchImpl);
  const applied: string[] = [];
  for (const [k, entry] of Object.entries(newer)) {
    if (!k.startsWith(prefix) || entry.deleted) continue;
    // A save made while the sync was on the network wins over what it downloaded.
    if (((await timeOf(kv, timesPrefix, k)) ?? -1) >= entry.updatedAt) continue;
    await kv.set(k, entry.value);
    await kv.set(timeKey(timesPrefix, k), entry.updatedAt);
    applied.push(k);
  }
  return applied;
}

/**
 * Saves a key here, noting when it changed, and uploads it when a server is
 * given. The time is written first, so a sync running meanwhile can't put an
 * older download over it.
 */
export async function recordChange(kv: KeyValues, timesPrefix: string, key: string, value: unknown, settings: AgentSettings | undefined, feature: string, fetchImpl: Fetch = fetch) {
  const updatedAt = Date.now();
  await kv.set(timeKey(timesPrefix, key), updatedAt);
  await kv.set(key, value);
  if (settings) await pushEntry(settings, feature, key, { value, updatedAt }, fetchImpl).catch(() => undefined);
}
