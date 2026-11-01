// Extension storage (editor.storage) lives in IndexedDB under
// `extension:<id>:<key>`, and is copied to the agent server so what an
// extension saves, such as snippets and extension settings, follows the
// author to another browser. The sync code (../lib/synced) loads on first
// use, to keep it out of the boot bundle.

import { get, set, keys } from "idb-keyval";
import type { AgentSettings } from "../lib/agent-client";

const synced = () => import("../lib/synced");
interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  keys(): Promise<IDBValidKey[]>;
}

const kv: KV = { get: (k) => get(k), set: (k, v) => set(k, v), keys: () => keys() };
const FEATURE = "extension-data";
const PREFIX = "extension:";
/** When each key last changed here, by key. */
const TIMES_KEY = "md-editor:extension-data:times";

export class SyncedExtensionStorage {
  constructor(
    private server: () => AgentSettings | undefined,
    private store: KV = kv,
    private fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  get(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.store.set(key, value);
    await (await synced()).recordChange(this.store, TIMES_KEY, key, value, this.server(), FEATURE, this.fetchImpl);
  }

  /** Merges this browser's extension data with the server's. Returns the keys that changed here. */
  async sync(settings: AgentSettings): Promise<string[]> {
    return (await synced()).syncKeyValues(settings, FEATURE, PREFIX, TIMES_KEY, this.store, this.fetchImpl);
  }
}
