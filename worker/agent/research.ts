import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

// Tools that don't depend on which post is open, for skills that check
// numbers and web platform facts. Both the post and the site assistants can
// install this extension.

export interface ResearchHost {
  /** Network access for browser_support; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export function createResearchExtension(host: ResearchHost = {}) {
  const fetcher = host.fetch ?? ((input, init) => fetch(input, init));

  const calc = defineTool({
    name: "calculate",
    description:
      "Evaluate arithmetic exactly instead of estimating. Supports + - * / % ^, parentheses, and abs, sqrt, round(x, digits), floor, ceil, min, max, log10, ln, exp, pow, pi, e. Pass several expressions to check many numbers at once.",
    parameters: Type.Object({ expressions: Type.Array(Type.String(), { minItems: 1, maxItems: 50 }) }),
    replay: "safe",
    execute: async (args) => {
      const lines = args.expressions.map((expr) => {
        try {
          return `${expr} = ${formatNumber(calculate(expr))}`;
        } catch (e) {
          return `${expr} → error: ${e instanceof Error ? e.message : String(e)}`;
        }
      });
      return { output: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  const stats = defineTool({
    name: "table_stats",
    description:
      "Parse a markdown table, CSV or TSV (copied from the post) and compute per-column statistics for numeric columns: count, sum, mean, median, min, max, standard deviation, and each row's share of the column total.",
    parameters: Type.Object({ data: Type.String({ description: "The table text, header row first" }) }),
    replay: "safe",
    execute: async (args) => {
      const table = parseTable(args.data);
      if (!table) return { output: [{ type: "text", text: "Could not find a table with a header and at least one row." }], isError: true };
      return { output: [{ type: "text", text: describeTable(table) }] };
    },
  });

  const support = defineTool({
    name: "browser_support",
    description:
      "Look up a web platform or Chrome feature (API, CSS property, HTML element) on Chrome Status and webstatus.dev: Chrome shipping milestone and status, origin trials, other browsers' positions, and Baseline status.",
    parameters: Type.Object({ feature: Type.String({ description: "Feature name or API, e.g. 'View Transitions' or 'showDirectoryPicker'" }) }),
    replay: "safe",
    execute: async (args) => ({ output: [{ type: "text", text: await browserSupport(args.feature, fetcher) }] }),
  });

  return defineExtension({ name: "research", tools: [calc, stats, support] });
}

// ---- calculate ----

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  log10: Math.log10,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  pow: Math.pow,
  round: (x, digits = 0) => {
    const f = 10 ** digits;
    return Math.round(x * f) / f;
  },
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/** Evaluates an arithmetic expression without eval. Throws on anything else. */
export function calculate(expression: string): number {
  // Thousands separators and a few look-alike characters writers use.
  const src = expression.replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/[−–]/g, "-").replace(/[×]/g, "*").replace(/[÷]/g, "/");
  const tokens = src.match(/\d*\.?\d+(?:e[-+]?\d+)?|[a-z_][a-z0-9_]*|\*\*|[-+*/%^(),]|\S/gi) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (expected?: string) => {
    const t = tokens[pos++];
    if (expected && t !== expected) throw new Error(`expected "${expected}"${t ? ` but found "${t}"` : " at the end"}`);
    if (t === undefined) throw new Error("unexpected end of expression");
    return t;
  };

  const expr = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") value = take() === "+" ? value + term() : value - term();
    return value;
  };
  const term = (): number => {
    let value = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = take();
      const rhs = unary();
      value = op === "*" ? value * rhs : op === "/" ? value / rhs : value % rhs;
    }
    return value;
  };
  const unary = (): number => {
    if (peek() === "-") return take(), -unary();
    if (peek() === "+") return take(), unary();
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (peek() === "^" || peek() === "**") {
      take();
      return base ** unary(); // right-associative, and binds tighter than unary minus on the left
    }
    return base;
  };
  const primary = (): number => {
    const t = take();
    if (t === "(") {
      const value = expr();
      take(")");
      return value;
    }
    if (/^\d*\.?\d/.test(t)) return Number(t);
    const name = t.toLowerCase();
    if (name in CONSTANTS) return CONSTANTS[name];
    const fn = FUNCTIONS[name];
    if (!fn) throw new Error(`unknown name "${t}"`);
    take("(");
    const args: number[] = [];
    if (peek() !== ")") {
      args.push(expr());
      while (peek() === ",") take(), args.push(expr());
    }
    take(")");
    return fn(...args);
  };

  if (!tokens.length) throw new Error("empty expression");
  const value = expr();
  if (pos < tokens.length) throw new Error(`unexpected "${tokens[pos]}"`);
  if (!Number.isFinite(value)) throw new Error(Number.isNaN(value) ? "not a number" : "division by zero or overflow");
  return value;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

// ---- table_stats ----

export interface Table {
  header: string[];
  rows: string[][];
}

/** Reads a markdown pipe table, or CSV/TSV, ignoring text around a markdown table. */
export function parseTable(text: string): Table | undefined {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pipe = lines.filter((l) => l.includes("|"));
  let cells: string[][];
  if (pipe.length >= 2) {
    cells = pipe
      .filter((l) => !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l))
      .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
  } else {
    const sep = lines[0]?.includes("\t") ? "\t" : lines[0]?.includes(";") && !lines[0].includes(",") ? ";" : ",";
    cells = lines.map((l) => splitDelimited(l, sep));
  }
  if (cells.length < 2) return undefined;
  const [header, ...rows] = cells;
  return { header, rows };
}

function splitDelimited(line: string, sep: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell.trim()) quoted = true;
    else if (c === sep) out.push(cell.trim()), (cell = "");
    else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/** "1,234", "$5.20", "12%", "(3.5)", "−4 ms" → numbers; anything else → undefined. */
export function parseCellNumber(cell: string): number | undefined {
  const m = cell
    .replace(/[*_`]/g, "")
    .trim()
    .match(/^(\()?\s*([-+−]?)\s*[$€£¥]?\s*(\d[\d,_]*(?:\.\d+)?|\.\d+)(?:e([-+]?\d+))?\s*(%|[a-zµ/]+)?\s*(\))?$/i);
  if (!m) return undefined;
  const value = Number(m[3].replace(/[,_]/g, "")) * 10 ** Number(m[4] ?? 0);
  const negative = m[2] === "-" || m[2] === "−" || (m[1] === "(" && m[6] === ")");
  return negative ? -value : value;
}

export function describeTable({ header, rows }: Table): string {
  const out = [`${rows.length} row(s), ${header.length} column(s): ${header.join(" | ")}`];
  const label = (r: string[]) => r[0] || "(blank)";
  for (const [col, name] of header.entries()) {
    const values = rows.map((r) => parseCellNumber(r[col] ?? ""));
    const nums = values.filter((v): v is number => v !== undefined);
    if (nums.length < Math.max(1, Math.ceil(rows.length / 2))) continue;
    const sorted = [...nums].sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    const mean = sum / nums.length;
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    const unit = rows.some((r) => /%\s*$/.test(r[col] ?? "")) ? " (values are percentages)" : "";
    out.push(
      "",
      `## ${name || `column ${col + 1}`}${unit}`,
      `count ${nums.length}${nums.length < rows.length ? ` (${rows.length - nums.length} non-numeric)` : ""}, sum ${formatNumber(sum)}, mean ${formatNumber(mean)}, median ${formatNumber(median)}, min ${formatNumber(sorted[0])}, max ${formatNumber(sorted[sorted.length - 1])}, std dev ${formatNumber(sd)}`,
    );
    if (col > 0 && rows.length <= 40 && sum !== 0) {
      out.push(
        "share of total: " +
          rows
            .map((r, i) => (values[i] === undefined ? undefined : `${label(r)} ${formatNumber(Math.round((values[i]! / sum) * 1000) / 10)}%`))
            .filter(Boolean)
            .join(", "),
      );
    }
  }
  if (out.length === 1) out.push("", "No numeric columns found.");
  return out.join("\n");
}

// ---- browser_support ----

interface ChromeStatusFeature {
  id: number;
  name: string;
  summary?: string;
  web_feature?: string | null;
  feature_type?: string;
  browsers?: {
    chrome?: { status?: { text?: string; milestone_str?: string }; desktop?: number | null; android?: number | null; origintrial?: boolean; flag?: boolean };
    ff?: { view?: { text?: string } };
    safari?: { view?: { text?: string } };
  };
}

interface WebStatusFeature {
  feature_id: string;
  name: string;
  baseline?: { status?: string; low_date?: string; high_date?: string };
  browser_implementations?: Record<string, { status?: string; date?: string; version?: string }>;
}

export async function browserSupport(query: string, fetcher: typeof fetch): Promise<string> {
  const [chrome, webStatus] = await Promise.all([
    chromeStatus(query, fetcher).catch((e: unknown) => `Chrome Status lookup failed: ${e instanceof Error ? e.message : String(e)}`),
    webStatusSearch(query, fetcher).catch((e: unknown) => `webstatus.dev lookup failed: ${e instanceof Error ? e.message : String(e)}`),
  ]);
  const sections: string[] = [];
  if (typeof chrome === "string") sections.push(chrome);
  else if (chrome.length) sections.push("# Chrome Status", ...chrome.map(formatChromeStatus));
  else sections.push("Chrome Status: no matching features.");

  // Features Chrome Status links to web-features ids, plus the name search.
  const ids = new Set(typeof webStatus === "string" ? [] : webStatus.map((f) => f.feature_id));
  const linked = typeof chrome === "string" ? [] : chrome.map((f) => f.web_feature).filter((id): id is string => !!id && !ids.has(id));
  const extra = await Promise.all([...new Set(linked)].slice(0, 3).map((id) => webStatusFeature(id, fetcher).catch(() => undefined)));
  const web = [...(typeof webStatus === "string" ? [] : webStatus), ...extra.filter((f): f is WebStatusFeature => !!f)];
  if (typeof webStatus === "string") sections.push("", webStatus);
  if (web.length) sections.push("", "# webstatus.dev (Baseline)", ...web.map(formatWebStatus));
  else if (typeof webStatus !== "string") sections.push("", "webstatus.dev: no matching features.");
  return sections.join("\n");
}

async function chromeStatus(query: string, fetcher: typeof fetch): Promise<ChromeStatusFeature[]> {
  const res = await fetcher(`https://chromestatus.com/api/v0/features?q=${encodeURIComponent(query)}&num=5`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  // The API prefixes its JSON with )]}' to stop it being run as a script.
  const data = JSON.parse((await res.text()).replace(/^\)\]\}'\s*/, "")) as { features?: ChromeStatusFeature[] };
  return data.features ?? [];
}

async function webStatusSearch(query: string, fetcher: typeof fetch): Promise<WebStatusFeature[]> {
  const q = `name:"${query.replace(/"/g, "")}"`;
  const res = await fetcher(`https://api.webstatus.dev/v1/features?q=${encodeURIComponent(q)}&page_size=5`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  return ((await res.json()) as { data?: WebStatusFeature[] }).data ?? [];
}

async function webStatusFeature(id: string, fetcher: typeof fetch): Promise<WebStatusFeature | undefined> {
  const res = await fetcher(`https://api.webstatus.dev/v1/features/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } });
  return res.ok ? ((await res.json()) as WebStatusFeature) : undefined;
}

function formatChromeStatus(f: ChromeStatusFeature): string {
  const c = f.browsers?.chrome;
  const shipped = [c?.desktop && `desktop ${c.desktop}`, c?.android && `Android ${c.android}`].filter(Boolean).join(", ");
  const parts = [
    `- ${f.name} (https://chromestatus.com/feature/${f.id})`,
    `  Chrome: ${c?.status?.text ?? "unknown"}${shipped ? `, shipped in ${shipped}` : c?.status?.milestone_str && c.status.milestone_str !== c.status.text ? ` (${c.status.milestone_str})` : ""}${c?.origintrial ? ", origin trial" : ""}${c?.flag ? ", behind a flag" : ""}`,
    `  Firefox: ${f.browsers?.ff?.view?.text ?? "unknown"}; Safari: ${f.browsers?.safari?.view?.text ?? "unknown"}${f.web_feature ? `; web-features id: ${f.web_feature}` : ""}`,
  ];
  if (f.summary) parts.push(`  ${f.summary.replace(/\s+/g, " ").slice(0, 300)}`);
  return parts.join("\n");
}

function formatWebStatus(f: WebStatusFeature): string {
  const b = f.baseline;
  const baseline =
    b?.status === "widely" ? `Baseline widely available${b.high_date ? ` since ${b.high_date}` : ""}`
    : b?.status === "newly" ? `Baseline newly available${b.low_date ? ` since ${b.low_date}` : ""}`
    : b?.status === "limited" ? "Limited availability (not Baseline)"
    : "Baseline status unknown";
  const impl = Object.entries(f.browser_implementations ?? {})
    .map(([browser, i]) => `${browser} ${i.status === "available" ? (i.version ?? "yes") : (i.status ?? "?")}`)
    .join(", ");
  return `- ${f.name} (https://webstatus.dev/features/${f.feature_id}): ${baseline}${impl ? `. ${impl}` : ""}`;
}
