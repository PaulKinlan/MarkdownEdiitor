// Extension storage (editor.storage) lives in IndexedDB under
// `extension:<id>:<key>`, and is copied to the agent server so what an
// extension saves, such as snippets and extension settings, follows the
// author to another browser.

import { get as idbGet, set as idbSet, keys as idbKeys } from "idb-keyval";
import type { AgentSettings } from "../lib/agent-client";

// The sync code loads on first use, to keep it out of the boot bundle.
const synced = () => import("../lib/synced");

const FEATURE = "extension-data";
const PREFIX = "extension:";
/** When each key last changed here, by key. */
const TIMES_KEY = "md-editor:extension-data:times";

interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  keys(): Promise<IDBValidKey[]>;
}

const idb: KV = { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v), keys: () => idbKeys() };

export class SyncedExtensionStorage {
  constructor(
    private server: () => AgentSettings | undefined,
    private kv: KV = idb,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get(key: string): Promise<unknown> {
    return this.kv.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.kv.set(key, value);
    const updatedAt = Date.now();
    const times = ((await this.kv.get(TIMES_KEY)) ?? {}) as Record<string, number>;
    await this.kv.set(TIMES_KEY, { ...times, [key]: updatedAt });
    const server = this.server();
    if (server) await synced().then((m) => m.pushEntry(server, FEATURE, key, { value, updatedAt }, this.fetchImpl)).catch(() => undefined);
  }

  /** Merges this browser's extension data with the server's. Returns the keys that changed here. */
  async sync(settings: AgentSettings): Promise<string[]> {
    return (await synced()).syncKeyValues(settings, FEATURE, PREFIX, TIMES_KEY, this.kv, this.fetchImpl);
  }
}
