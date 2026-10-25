import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/** Feature and scope names: lowercase letters, digits and dashes (scopes may also hold a site id). */
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const SCOPE = /^[\w-]{1,100}$/;
const MAX_KEY = 512;
/** Durable Object SQLite rows top out at 2 MB; leave room. */
export const MAX_VALUE_BYTES = 1_000_000;

export interface FeatureEntry {
  key: string;
  value: unknown;
  updatedAt: number;
}

/**
 * Storage for any feature, so a new feature never needs a Durable Object
 * class, binding or migration of its own. Each feature gets its own instance
 * per scope (`featureStore(env, "git", siteId)`), holding JSON values by key.
 */
export class FeatureStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  }

  get(key: string): FeatureEntry | null {
    checkKey(key);
    const row = this.sql.exec<{ value: string; updated_at: number }>("SELECT value, updated_at FROM entries WHERE key = ?", key).toArray()[0];
    return row ? { key, value: JSON.parse(row.value), updatedAt: row.updated_at } : null;
  }

  put(key: string, value: unknown): FeatureEntry {
    checkKey(key);
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("The value must be JSON.");
    if (new TextEncoder().encode(json).length > MAX_VALUE_BYTES) throw new Error(`The value is over ${MAX_VALUE_BYTES / 1_000_000} MB.`);
    const updatedAt = Date.now();
    this.sql.exec(
      "INSERT INTO entries (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      key,
      json,
      updatedAt,
    );
    return { key, value, updatedAt };
  }

  delete(key: string): boolean {
    checkKey(key);
    return this.sql.exec("DELETE FROM entries WHERE key = ?", key).rowsWritten > 0;
  }

  /** Keys (and update times) starting with `prefix`, in key order. */
  list(prefix = "", limit = 1000): { key: string; updatedAt: number }[] {
    return this.sql
      .exec<{ key: string; updated_at: number }>(
        "SELECT key, updated_at FROM entries WHERE substr(key, 1, ?) = ? ORDER BY key LIMIT ?",
        prefix.length,
        prefix,
        Math.max(1, Math.min(limit, 1000)),
      )
      .toArray()
      .map((r) => ({ key: r.key, updatedAt: r.updated_at }));
  }
}

function checkKey(key: string) {
  if (typeof key !== "string" || !key || key.length > MAX_KEY) throw new Error(`Keys are 1 to ${MAX_KEY} characters.`);
}

/** Whether a feature name and scope can name a FeatureStore instance. */
export function validFeatureName(feature: string, scope: string): boolean {
  return NAME.test(feature) && SCOPE.test(scope);
}

/** The FeatureStore instance for one feature and scope ("global" for editor-wide data). */
export function featureStore(env: Env, feature: string, scope = "global") {
  if (!validFeatureName(feature, scope)) throw new Error(`Bad feature store name ${feature}:${scope}.`);
  return env.FEATURE_STORE.get(env.FEATURE_STORE.idFromName(`${feature}:${scope}`));
}
