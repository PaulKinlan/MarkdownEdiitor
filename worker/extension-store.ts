import { DurableObject } from "cloudflare:workers";
import { parseExtension } from "../src/extensions/loader";
import type { Env } from "./env";

export interface StoredExtension {
  id: string;
  source: string;
  from?: string;
  updatedAt: number;
}

/**
 * The editor's own library of extensions: ones installed from a URL or a
 * file, and ones the assistant wrote. Kept here so every browser the author
 * uses sees the same set. One instance ("library") holds them all.
 */
export class ExtensionStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS extensions (id TEXT PRIMARY KEY, source TEXT NOT NULL, from_url TEXT, updated_at INTEGER NOT NULL)");
  }

  list(): StoredExtension[] {
    return [...this.sql.exec<{ id: string; source: string; from_url: string | null; updated_at: number }>("SELECT id, source, from_url, updated_at FROM extensions ORDER BY id")].map(
      (r) => ({ id: r.id, source: r.source, ...(r.from_url ? { from: r.from_url } : {}), updatedAt: r.updated_at }),
    );
  }

  /** Saves an extension. Its id comes from its manifest; a mismatched `id` is refused. */
  put(id: string, source: string, from?: string): StoredExtension {
    const { manifest } = parseExtension(source);
    if (manifest.id !== id) throw new Error(`The manifest id is ${manifest.id}, not ${id}.`);
    const updatedAt = Date.now();
    this.sql.exec(
      "INSERT INTO extensions (id, source, from_url, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET source = excluded.source, from_url = excluded.from_url, updated_at = excluded.updated_at",
      id,
      source,
      from ?? null,
      updatedAt,
    );
    return { id, source, ...(from ? { from } : {}), updatedAt };
  }

  remove(id: string): boolean {
    return this.sql.exec("DELETE FROM extensions WHERE id = ?", id).rowsWritten > 0;
  }
}
