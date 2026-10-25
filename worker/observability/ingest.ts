// Parsing for POST /api/reports. Browsers send three shapes there: Reporting
// API batches (application/reports+json), legacy CSP reports
// (application/csp-report), and the editor's own client events
// (application/json, the same {type, url, body} shape as the Reporting API).
// Everything here is pure, so it is tested without a Worker.

/** The collector reads at most this much of a request body. */
export const MAX_BODY_BYTES = 64 * 1024;

export type Severity = "error" | "warn" | "info";

export interface ReportEvent {
  type: string;
  severity: Severity;
  /** Path of the page that sent it, without the query (which can hold a token). */
  route: string;
  /** The part of the report that tells one problem from another, used for de-duplication. */
  key: string;
  detail: Record<string, unknown>;
  /** The build that sent it (the page's own events say); otherwise the receiving Worker's. */
  commit?: string;
  /** Set for Web Vitals: the metric's name and value, kept for percentiles. */
  vital?: { name: string; value: number };
}

/** Reads a body up to `max` bytes. Returns null when it is longer, without reading the rest. */
export async function readLimited(request: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const POLLUTING_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** JSON.parse that drops keys which could pollute prototypes further down. */
export function safeParse(text: string): unknown {
  return JSON.parse(text, (key, value) => (POLLUTING_KEYS.has(key) ? undefined : value));
}

/** Turns any accepted body into events. Unknown shapes give an empty list. */
export function parseReports(text: string, contentType: string): ReportEvent[] {
  let data: unknown;
  try {
    data = safeParse(text);
  } catch {
    return [];
  }
  const raw: { type: string; url: string; body: Record<string, unknown>; commit?: string }[] = [];
  if (contentType.includes("application/csp-report")) {
    const r = (data as { "csp-report"?: Record<string, unknown> })?.["csp-report"];
    if (r && typeof r === "object") {
      raw.push({
        type: "csp-violation",
        url: str(r["document-uri"]),
        body: {
          effectiveDirective: r["effective-directive"] ?? r["violated-directive"],
          blockedURL: r["blocked-uri"],
          sourceFile: r["source-file"],
          lineNumber: r["line-number"],
          disposition: r["disposition"],
          sample: r["script-sample"],
        },
      });
    }
  } else {
    for (const r of Array.isArray(data) ? data : [data]) {
      if (!r || typeof r !== "object") continue;
      const { type, url, body, commit } = r as Record<string, unknown>;
      if (typeof type !== "string" || !/^[\w-]{1,40}$/.test(type)) continue;
      raw.push({
        type,
        url: str(url),
        body: body && typeof body === "object" ? (body as Record<string, unknown>) : {},
        commit: typeof commit === "string" && /^([0-9a-f]{7,40}|dev)$/.test(commit) ? commit : undefined,
      });
    }
  }
  // A batch can't flood the store with one request.
  return raw.slice(0, 50).map(({ type, url, body, commit }) => ({ ...toEvent(type, url, redactDeep(body) as Record<string, unknown>), commit }));
}

function toEvent(type: string, url: string, detail: Record<string, unknown>): ReportEvent {
  const route = routeOf(url);
  if (type === "web-vital") {
    const name = str(detail.name).slice(0, 10);
    const value = Number(detail.value);
    const severity = vitalSeverity(name, value);
    return { type, severity, route, key: `${name}:${severity}`, detail, vital: Number.isFinite(value) ? { name, value } : undefined };
  }
  return { type, severity: severityOf(type, detail), route, key: keyOf(type, detail), detail };
}

/** Severity bands from the Reporting API report type. */
export function severityOf(type: string, detail: Record<string, unknown> = {}): Severity {
  switch (type) {
    case "crash":
    case "error":
    case "unhandledrejection":
      return "error";
    case "csp-violation":
    case "permissions-policy-violation":
    case "coep":
    case "coop":
    case "network-error":
      return "warn";
    case "long-animation-frame":
      return Number(detail.duration) > 200 ? "warn" : "info";
    default:
      // deprecation, intervention, and anything new.
      return "info";
  }
}

/** Good / needs improvement / poor, from the standard Web Vitals thresholds. */
const THRESHOLDS: Record<string, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800] };

export function vitalSeverity(name: string, value: number): Severity {
  const t = THRESHOLDS[name];
  if (!t || !Number.isFinite(value)) return "info";
  return value <= t[0] ? "info" : value <= t[1] ? "warn" : "error";
}

function keyOf(type: string, d: Record<string, unknown>): string {
  switch (type) {
    case "csp-violation":
      return `${str(d.effectiveDirective)} ${originOf(str(d.blockedURL))}`;
    case "error":
    case "unhandledrejection":
      return `${str(d.message).slice(0, 200)} @ ${str(d.sourceFile)}:${str(d.lineNumber)}`;
    case "long-animation-frame":
      return `${str(d.sourceURL)} ${str(d.sourceFunctionName)}`;
    default:
      return str(d.id ?? d.message ?? d.featureId ?? d.reason ?? d.type).slice(0, 200);
  }
}

function routeOf(url: string): string {
  try {
    return new URL(url).pathname.slice(0, 200);
  } catch {
    return "";
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    // CSP uses keywords like "inline" and "eval" for these.
    return url.slice(0, 100);
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(token|key|secret|password|auth|authorization|code)=([^&\s"']+)/gi, "$1=[redacted]"],
  [/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]"],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{10,}/g, "[redacted]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]"],
];

/** Masks things that look like credentials: query tokens, bearer tokens, API keys. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redact(value).slice(0, 2000);
  if (value == null || typeof value !== "object") return value;
  // Deeper than this is dropped, not kept as is: unredacted strings could hide in it.
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = redactDeep(v, depth + 1);
  return out;
}

/** SHA-256 of what makes two events the same problem. */
export async function fingerprint(e: Pick<ReportEvent, "type" | "severity" | "route" | "key">): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([e.type, e.severity, e.route, e.key]));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Zero-based index of the nearest-rank `p`th percentile in an ascending list of `count` values. */
export function rank(count: number, p: number): number {
  return Math.min(count - 1, Math.max(0, Math.ceil((p / 100) * count) - 1));
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: number[], p: number): number | null {
  return sorted.length ? sorted[rank(sorted.length, p)] : null;
}
