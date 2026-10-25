import { DurableObject } from "cloudflare:workers";
import type { IndexedPost } from "../../src/shared/protocol";
import type { SearchHit } from "./writing";
import type { Env } from "../env";

/**
 * Full-text index of one site's posts, so agents can search and read past
 * articles. The editor keeps it in sync: it sends a manifest of paths and
 * modification times, then uploads only the posts that changed.
 */
export class SiteIndex extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS posts (
      path TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT, last_modified INTEGER NOT NULL, body TEXT NOT NULL
    )`);
    this.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(path UNINDEXED, title, body, tokenize = 'porter unicode61')`);
  }

  /** Removes posts no longer on disk and returns the paths that need uploading. */
  sync(manifest: { path: string; lastModified: number }[]): string[] {
    const known = new Map<string, number>();
    for (const row of this.sql.exec<{ path: string; last_modified: number }>("SELECT path, last_modified FROM posts")) {
      known.set(row.path, row.last_modified);
    }
    const present = new Set(manifest.map((m) => m.path));
    for (const path of known.keys()) if (!present.has(path)) this.remove(path);
    return manifest.filter((m) => known.get(m.path) !== m.lastModified).map((m) => m.path);
  }

  upsert(posts: IndexedPost[]): number {
    for (const p of posts) {
      this.remove(p.path);
      this.sql.exec("INSERT INTO posts (path, title, url, date, last_modified, body) VALUES (?, ?, ?, ?, ?, ?)", p.path, p.title, p.url, p.date ?? null, p.lastModified, p.body);
      this.sql.exec("INSERT INTO posts_fts (path, title, body) VALUES (?, ?, ?)", p.path, p.title, p.body);
    }
    return this.count();
  }

  count(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM posts").one().n;
  }

  search(query: string, limit = 8): SearchHit[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    return [
      ...this.sql.exec<{ path: string; title: string; url: string; date: string | null; snippet: string }>(
        `SELECT p.path, p.title, p.url, p.date, snippet(posts_fts, 2, '', '', '…', 24) AS snippet
         FROM posts_fts JOIN posts p ON p.path = posts_fts.path
         WHERE posts_fts MATCH ? ORDER BY bm25(posts_fts, 0, 5, 1) LIMIT ?`,
        match,
        limit,
      ),
    ].map((r) => ({ path: r.path, title: r.title, url: r.url, date: r.date ?? undefined, snippet: r.snippet.replace(/\s+/g, " ") }));
  }

  get(path: string): { title: string; url: string; body: string } | undefined {
    return this.sql.exec<{ title: string; url: string; body: string }>("SELECT title, url, body FROM posts WHERE path = ?", path).toArray()[0];
  }

  private remove(path: string) {
    this.sql.exec("DELETE FROM posts WHERE path = ?", path);
    this.sql.exec("DELETE FROM posts_fts WHERE path = ?", path);
  }
}

/** Quotes each word so user text can't inject FTS syntax, and ORs them so partial matches still rank. */
export function toFtsQuery(query: string): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
}
