import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { fingerprint, percentile, type ReportEvent, type Severity } from "./ingest";

/** Events one client IP can add per minute; the rest are dropped. */
const RATE_PER_MINUTE = 120;

export interface StoredEvent {
  seq: number;
  type: string;
  severity: Severity;
  route: string;
  detail: unknown;
  commit: string;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}

/**
 * The one store for browser reports and Web Vitals (a single instance, named
 * "global"). Events are de-duplicated as they are written: a repeat of the
 * same problem bumps `occurrences` and `last_seen` instead of adding a row, so
 * a flood can't push out distinct history. Vitals keep every sample, so
 * percentiles can be compared across deploys.
 */
export class Observability extends DurableObject<Env> {
  private sql: SqlStorage;
  private rate = new Map<string, { minute: number; count: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, type TEXT NOT NULL, severity TEXT NOT NULL,
      route TEXT NOT NULL, detail TEXT NOT NULL, commit_sha TEXT NOT NULL, occurrences INTEGER NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS vitals (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, value REAL NOT NULL, route TEXT NOT NULL,
      commit_sha TEXT NOT NULL, at INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS vitals_at ON vitals (at)");
  }

  /** Stores a batch from one client. Returns how many were accepted. */
  async record(events: ReportEvent[], client: string, commit: string): Promise<number> {
    const minute = Math.floor(Date.now() / 60_000);
    const bucket = this.rate.get(client);
    const used = bucket?.minute === minute ? bucket.count : 0;
    const accepted = events.slice(0, Math.max(0, RATE_PER_MINUTE - used));
    this.rate.set(client, { minute, count: used + accepted.length });
    if (this.rate.size > 1000) for (const [k, v] of this.rate) if (v.minute !== minute) this.rate.delete(k);

    const now = Date.now();
    for (const e of accepted) {
      if (e.vital) {
        this.sql.exec("INSERT INTO vitals (name, value, route, commit_sha, at) VALUES (?, ?, ?, ?, ?)", e.vital.name, e.vital.value, e.route, commit, now);
      }
      // Good vitals are only samples; the rest are also worth seeing in the error feed.
      if (e.vital && e.severity === "info") continue;
      const fp = await fingerprint(e);
      this.sql.exec(
        `INSERT INTO events (fingerprint, type, severity, route, detail, commit_sha, occurrences, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (fingerprint) DO UPDATE SET occurrences = occurrences + 1, last_seen = excluded.last_seen,
           detail = excluded.detail, commit_sha = excluded.commit_sha`,
        fp, e.type, e.severity, e.route, JSON.stringify(e.detail), commit, now, now,
      );
    }
    return accepted.length;
  }

  /** Events after `since` (a seq cursor), oldest first. */
  errors(since: number, limit = 100): StoredEvent[] {
    return this.sql
      .exec<Record<string, string | number>>("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?", since, Math.min(limit, 500))
      .toArray()
      .map((r) => ({
        seq: r.seq as number,
        type: r.type as string,
        severity: r.severity as Severity,
        route: r.route as string,
        detail: JSON.parse(r.detail as string),
        commit: r.commit_sha as string,
        occurrences: r.occurrences as number,
        firstSeen: new Date(r.first_seen as number).toISOString(),
        lastSeen: new Date(r.last_seen as number).toISOString(),
      }));
  }

  /** Counts by severity over the last day, and Vitals percentiles over the last week and per deploy. */
  summary() {
    const day = Date.now() - 86_400_000;
    const week = Date.now() - 7 * 86_400_000;
    const severities = this.sql
      .exec<{ severity: string; events: number; occurrences: number }>(
        "SELECT severity, COUNT(*) AS events, SUM(occurrences) AS occurrences FROM events WHERE last_seen >= ? GROUP BY severity",
        day,
      )
      .toArray();
    const rows = this.sql.exec<{ name: string; value: number; commit_sha: string }>("SELECT name, value, commit_sha FROM vitals WHERE at >= ? ORDER BY value LIMIT 100000", week).toArray();
    const group = (key: (r: (typeof rows)[number]) => string) => {
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = key(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r.value);
      }
      return Object.fromEntries(
        [...groups].map(([k, values]) => [k, { count: values.length, p50: percentile(values, 50), p75: percentile(values, 75), p95: percentile(values, 95), p99: percentile(values, 99) }]),
      );
    };
    const latest = this.sql.exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").one().seq;
    return { latestSeq: latest, lastDay: severities, vitals: group((r) => r.name), vitalsByCommit: group((r) => `${r.commit_sha.slice(0, 7)} ${r.name}`) };
  }
}
