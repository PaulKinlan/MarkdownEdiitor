import { DurableObject } from "cloudflare:workers";
import type { IndexedPost } from "../../src/shared/protocol";
import type { SearchHit } from "./writing";
import type { Env } from "../env";
import { countTerms, filterPosts, grepFiles, type GrepResult, type ListFilter, type PostListing } from "./site-data";

/**
 * One site's posts, so agents can search, list and read past articles. The
 * editor keeps it in sync: it sends a manifest of paths and modification
 * times, then uploads only the posts that changed.
 */
export class SiteIndex extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS posts (
      path TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL, date TEXT, last_modified INTEGER NOT NULL, body TEXT NOT NULL
    )`);
    // Added for the site-wide assistant. Rows from before have NULL text and are re-uploaded by sync().
    const columns = new Set(this.sql.exec<{ name: string }>("PRAGMA table_info(posts)").toArray().map((c) => c.name));
    if (!columns.has("text")) this.sql.exec("ALTER TABLE posts ADD COLUMN text TEXT");
    if (!columns.has("draft")) this.sql.exec("ALTER TABLE posts ADD COLUMN draft INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("front_matter")) this.sql.exec("ALTER TABLE posts ADD COLUMN front_matter TEXT NOT NULL DEFAULT '{}'");
    this.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(path UNINDEXED, title, body, tokenize = 'porter unicode61')`);
  }

  /** Removes posts no longer on disk and returns the paths that need uploading. */
  sync(manifest: { path: string; lastModified: number }[]): string[] {
    const known = new Map<string, number>();
    for (const row of this.sql.exec<{ path: string; last_modified: number; complete: number }>("SELECT path, last_modified, text IS NOT NULL AS complete FROM posts")) {
      known.set(row.path, row.complete ? row.last_modified : -1);
    }
    const present = new Set(manifest.map((m) => m.path));
    for (const path of known.keys()) if (!present.has(path)) this.remove(path);
    return manifest.filter((m) => known.get(m.path) !== m.lastModified).map((m) => m.path);
  }

  upsert(posts: IndexedPost[]): number {
    for (const p of posts) {
      this.remove(p.path);
      this.sql.exec(
        "INSERT INTO posts (path, title, url, date, last_modified, body, text, draft, front_matter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        p.path,
        p.title,
        p.url,
        p.date ?? null,
        p.lastModified,
        p.body,
        p.text ?? null,
        p.draft ? 1 : 0,
        JSON.stringify(p.frontMatter ?? {}),
      );
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

  /** The whole file as last uploaded, front matter included. */
  file(path: string): { title: string; url: string; text: string } | undefined {
    const row = this.sql.exec<{ title: string; url: string; text: string | null }>("SELECT title, url, text FROM posts WHERE path = ?", path).toArray()[0];
    return row?.text == null ? undefined : { title: row.title, url: row.url, text: row.text };
  }

  /** Posts matching the filter, newest first. */
  list(contentDir: string, filter: ListFilter = {}): PostListing[] {
    return filterPosts(this.listings(), contentDir, filter);
  }

  /** How often each value of a list-like front matter key (tags, categories, series…) is used, most used first. */
  terms(key: string): { term: string; count: number }[] {
    return countTerms(this.listings(), key);
  }

  /** Lines matching a pattern across every file. Stops collecting after `limit` lines but keeps counting. */
  grep(pattern: string, options: { regex?: boolean; caseSensitive?: boolean; limit?: number } = {}): GrepResult {
    return grepFiles(this.sql.exec<{ path: string; text: string }>("SELECT path, text FROM posts WHERE text IS NOT NULL ORDER BY path"), pattern, options);
  }

  private listings(): PostListing[] {
    return this.sql
      .exec<{ path: string; title: string; url: string; date: string | null; draft: number; front_matter: string; words: number }>(
        // Word count approximated from spaces: cheap, and close enough for "short posts" style questions.
        "SELECT path, title, url, date, draft, front_matter, length(body) - length(replace(body, ' ', '')) + 1 AS words FROM posts",
      )
      .toArray()
      .map((r) => ({ path: r.path, title: r.title, url: r.url, date: r.date ?? undefined, draft: r.draft === 1, frontMatter: safeJson(r.front_matter), words: r.words }));
  }

  private remove(path: string) {
    this.sql.exec("DELETE FROM posts WHERE path = ?", path);
    this.sql.exec("DELETE FROM posts_fts WHERE path = ?", path);
  }
}

function safeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Quotes each word so user text can't inject FTS syntax, and ORs them so partial matches still rank. */
export function toFtsQuery(query: string): string {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
}
