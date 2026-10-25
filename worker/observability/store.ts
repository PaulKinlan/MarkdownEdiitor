import { DurableObject } from "cloudflare:workers";
import type { Env } from "../env";
import { fingerprint, rank, type ReportEvent, type Severity } from "./ingest";

/** Events one client IP can add per minute; the rest are dropped. */
const RATE_PER_MINUTE = 120;

interface Percentiles {
  count: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  p99: number | null;
}

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
 * a flood can't push out distinct history. A repeat also moves the row to the
 * next `seq`, so a reader following the `since` cursor sees it come back.
 * Per-hour counts give occurrences within a window. Vitals keep every
 * sample, so percentiles can be compared across deploys.
 */
export class Observability extends DurableObject<Env> {
  private sql: SqlStorage;
  private rate = new Map<string, { minute: number; count: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, type TEXT NOT NULL, severity TEXT NOT NULL,
      route TEXT NOT NULL, detail TEXT NOT NULL, commit_sha TEXT NOT NULL, occurrences INTEGER NOT NULL,
      first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL
    )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS vitals (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, value REAL NOT NULL, route TEXT NOT NULL,
      commit_sha TEXT NOT NULL, at INTEGER NOT NULL
    )`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS vitals_name ON vitals (name, at, value)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS vitals_commit ON vitals (commit_sha, name, at, value)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS event_hours (
      fingerprint TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (fingerprint, hour)
    )`);
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
    const hour = Math.floor(now / 3_600_000);
    for (const e of accepted) {
      // The page says which build it runs; it can be older than this Worker.
      const from = e.commit ?? commit;
      if (e.vital) {
        this.sql.exec("INSERT INTO vitals (name, value, route, commit_sha, at) VALUES (?, ?, ?, ?, ?)", e.vital.name, e.vital.value, e.route, from, now);
      }
      // Good vitals are only samples; the rest are also worth seeing in the error feed.
      if (e.vital && e.severity === "info") continue;
      const fp = await fingerprint(e);
      // seq is the cursor: new rows and repeats both take the next value.
      const next = this.sql.exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events").one().seq;
      this.sql.exec(
        `INSERT INTO events (seq, fingerprint, type, severity, route, detail, commit_sha, occurrences, first_seen, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (fingerprint) DO UPDATE SET seq = excluded.seq, occurrences = occurrences + 1, last_seen = excluded.last_seen,
           detail = excluded.detail, commit_sha = excluded.commit_sha`,
        next, fp, e.type, e.severity, e.route, JSON.stringify(e.detail), from, now, now,
      );
      this.sql.exec(
        "INSERT INTO event_hours (fingerprint, hour, count) VALUES (?, ?, 1) ON CONFLICT (fingerprint, hour) DO UPDATE SET count = count + 1",
        fp, hour,
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

  /** Counts by severity over the last day, and Vitals percentiles over the last week, per metric and per deploy. */
  summary() {
    const dayHour = Math.floor(Date.now() / 3_600_000) - 24;
    const week = Date.now() - 7 * 86_400_000;
    const lastDay = this.sql
      .exec<{ severity: string; events: number; occurrences: number }>(
        `SELECT e.severity, COUNT(DISTINCT e.fingerprint) AS events, SUM(h.count) AS occurrences
         FROM event_hours h JOIN events e ON e.fingerprint = h.fingerprint WHERE h.hour > ? GROUP BY e.severity`,
        dayHour,
      )
      .toArray();
    const vitals: Record<string, Percentiles> = {};
    for (const { name } of this.sql.exec<{ name: string }>("SELECT DISTINCT name FROM vitals WHERE at >= ?", week)) {
      vitals[name] = this.percentiles("name = ? AND at >= ?", [name, week]);
    }
    // The ten most recent deploys that sent samples this week.
    const commits = this.sql
      .exec<{ commit_sha: string }>("SELECT commit_sha FROM vitals WHERE at >= ? GROUP BY commit_sha ORDER BY MAX(at) DESC LIMIT 10", week)
      .toArray();
    const vitalsByCommit: Record<string, Percentiles> = {};
    for (const { commit_sha } of commits) {
      for (const { name } of this.sql.exec<{ name: string }>("SELECT DISTINCT name FROM vitals WHERE commit_sha = ? AND at >= ?", commit_sha, week)) {
        vitalsByCommit[`${commit_sha.slice(0, 7)} ${name}`] = this.percentiles("commit_sha = ? AND name = ? AND at >= ?", [commit_sha, name, week]);
      }
    }
    const latestSeq = this.sql.exec<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM events").one().seq;
    return { latestSeq, lastDay, vitals, vitalsByCommit };
  }

  /** Nearest-rank percentiles over every sample matching `where`, read by offset so none are left out. */
  private percentiles(where: string, params: (string | number)[]): Percentiles {
    const count = this.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM vitals WHERE ${where}`, ...params).one().n;
    const at = (p: number) =>
      this.sql.exec<{ value: number }>(`SELECT value FROM vitals WHERE ${where} ORDER BY value LIMIT 1 OFFSET ?`, ...params, rank(count, p)).toArray()[0]?.value ?? null;
    return { count, p50: at(50), p75: at(75), p95: at(95), p99: at(99) };
  }
}
