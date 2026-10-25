import { DurableObject } from "cloudflare:workers";
import { parseExtension } from "../src/extensions/loader";
import type { Env } from "./env";

export interface StoredExtension {
  id: string;
  /** Empty for a removed extension. */
  source: string;
  from?: string;
  updatedAt: number;
  /** Set when the extension was removed, so browsers that still have it remove it too. */
  deleted?: boolean;
}

/**
 * The editor's own library of extensions: ones installed from a URL or a
 * file, and ones the assistant wrote. Kept here so every browser the author
 * uses sees the same set. One instance ("library") holds them all. A removal
 * is kept as a tombstone, and the newer change to an id wins.
 */
export class ExtensionStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS extensions (id TEXT PRIMARY KEY, source TEXT NOT NULL, from_url TEXT, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)",
    );
    // Tables from before tombstones.
    try {
      this.sql.exec("ALTER TABLE extensions ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Already there.
    }
  }

  list(): StoredExtension[] {
    return [
      ...this.sql.exec<{ id: string; source: string; from_url: string | null; updated_at: number; deleted: number }>(
        "SELECT id, source, from_url, updated_at, deleted FROM extensions ORDER BY id",
      ),
    ].map((r) => ({ id: r.id, source: r.source, ...(r.from_url ? { from: r.from_url } : {}), updatedAt: r.updated_at, ...(r.deleted ? { deleted: true } : {}) }));
  }

  /** Saves an extension. Its id comes from its manifest; a mismatched `id` is refused. An older change than the stored one is ignored. */
  put(id: string, source: string, from?: string, at?: number): StoredExtension {
    const { manifest } = parseExtension(source);
    if (manifest.id !== id) throw new Error(`The manifest id is ${manifest.id}, not ${id}.`);
    return this.write({ id, source, ...(from ? { from } : {}), updatedAt: this.time(at) });
  }

  /** Removes an extension, leaving a tombstone. */
  remove(id: string, at?: number): StoredExtension {
    return this.write({ id, source: "", updatedAt: this.time(at), deleted: true });
  }

  private write(item: StoredExtension): StoredExtension {
    const current = this.list().find((e) => e.id === item.id);
    if (current && current.updatedAt > item.updatedAt) return current;
    this.sql.exec(
      "INSERT INTO extensions (id, source, from_url, updated_at, deleted) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET source = excluded.source, from_url = excluded.from_url, updated_at = excluded.updated_at, deleted = excluded.deleted",
      item.id,
      item.source,
      item.from ?? null,
      item.updatedAt,
      item.deleted ? 1 : 0,
    );
    return item;
  }

  /** The browser's time for a change, so offline changes keep their order; never in the future. */
  private time(at?: number): number {
    const now = Date.now();
    return typeof at === "number" && Number.isFinite(at) && at > 0 ? Math.min(at, now) : now;
  }
}
