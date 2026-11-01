import { apiUrl, type AgentSettings } from "./agent-client";

// Things the author saves in one browser (snippets, custom quick edits,
// extension data) are kept in that browser and copied to the agent server's
// FeatureStore (/api/features/<feature>/global/<key>), so a new machine gets
// them back. Each key carries the time it last changed; the newer side wins,
// and removals are kept as tombstones so they travel too.

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

/** Uploads one entry. */
export function pushEntry(settings: AgentSettings, feature: string, key: string, entry: SyncedEntry, fetchImpl: Fetch = fetch) {
  return call(settings, featurePath(feature, key), { method: "PUT", body: JSON.stringify(entry) }, fetchImpl);
}

function isEntry(v: unknown): v is SyncedEntry {
  return !!v && typeof v === "object" && typeof (v as SyncedEntry).updatedAt === "number";
}

/**
 * Brings local entries and the server's together. For each key the newer
 * change wins; keys that are newer here (or only here) are uploaded.
 * Returns the merged entries and the keys whose local copy changed.
 */
export async function syncEntries<T>(
  settings: AgentSettings,
  feature: string,
  local: SyncedEntries<T>,
  fetchImpl: Fetch = fetch,
): Promise<{ entries: SyncedEntries<T>; changed: string[] }> {
  const keys = await call<{ key: string }[]>(settings, featurePath(feature), {}, fetchImpl);
  const server = new Map<string, SyncedEntry<T>>();
  await Promise.all(
    keys.map(async ({ key }) => {
      const got = await call<{ value: unknown }>(settings, featurePath(feature, key), {}, fetchImpl).catch(() => undefined);
      if (got && isEntry(got.value)) server.set(key, got.value as SyncedEntry<T>);
    }),
  );
  const entries: SyncedEntries<T> = { ...local };
  const changed: string[] = [];
  for (const [key, theirs] of server) {
    const mine = local[key];
    if (mine ? mine.updatedAt < theirs.updatedAt : !theirs.deleted) {
      entries[key] = theirs;
      changed.push(key);
    }
  }
  await Promise.all(
    Object.entries(local).map(([key, mine]) => {
      const theirs = server.get(key);
      if (!theirs || theirs.updatedAt < mine.updatedAt) return pushEntry(settings, feature, key, mine, fetchImpl).catch(() => undefined);
    }),
  );
  return { entries, changed };
}

interface KeyValues {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  keys(): Promise<IDBValidKey[]>;
}

/**
 * Syncs the keys starting with `prefix` in a key/value store, whose change
 * times are kept under `timesKey`. Returns the keys that changed here.
 */
export async function syncKeyValues(settings: AgentSettings, feature: string, prefix: string, timesKey: string, kv: KeyValues, fetchImpl: Fetch = fetch): Promise<string[]> {
  const times = ((await kv.get(timesKey)) ?? {}) as Record<string, number>;
  const local: SyncedEntries = {};
  for (const k of await kv.keys()) {
    if (typeof k !== "string" || !k.startsWith(prefix)) continue;
    // Data saved before syncing existed has no time; 0 uploads it without overriding anything newer.
    local[k] = { value: await kv.get(k), updatedAt: times[k] ?? 0 };
  }
  const { entries, changed } = await syncEntries(settings, feature, local, fetchImpl);
  const keep = changed.filter((k) => k.startsWith(prefix));
  if (!keep.length) return [];
  for (const k of keep) await kv.set(k, entries[k].value);
  await kv.set(timesKey, { ...times, ...Object.fromEntries(keep.map((k) => [k, entries[k].updatedAt])) });
  return keep;
}

/** Notes when a key changed here and, when a server is given, uploads it. */
export async function recordChange(kv: KeyValues, timesKey: string, key: string, value: unknown, settings: AgentSettings | undefined, feature: string, fetchImpl: Fetch = fetch) {
  const updatedAt = Date.now();
  const times = ((await kv.get(timesKey)) ?? {}) as Record<string, number>;
  await kv.set(timesKey, { ...times, [key]: updatedAt });
  if (settings) await pushEntry(settings, feature, key, { value, updatedAt }, fetchImpl).catch(() => undefined);
}
