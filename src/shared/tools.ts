// Tools the author configures for every agent: remote MCP servers and plain
// HTTP APIs. Stored once on the agent server (ToolStore) and installed into
// every agent harness (post sessions, the site assistant, ...).

/** Stands in for a stored secret (header value) when settings go to the browser; sending it back keeps the stored value. */
export const SECRET_MASK = "••••••••";

/** Names the built-in writing tools use; configured tools may not take them. */
export const RESERVED_TOOL_NAMES = ["read_post", "propose_edits", "search_posts", "read_past_post", "web_search", "fetch_url", "web_fetch"];

/** One tool an MCP server offers, as tools/list described it. */
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpSource {
  id: string;
  kind: "mcp";
  /** Short name, used as the tool prefix: mcp__<name>__<tool>. */
  name: string;
  enabled: boolean;
  /** Streamable HTTP endpoint, e.g. https://example.com/mcp. */
  url: string;
  /** Sent with every request, e.g. Authorization: Bearer …. Values are secret. */
  headers: Record<string, string>;
  /** The server's tools as last discovered; only these are offered, so a session starts without a network round trip. */
  tools: McpToolInfo[];
  /** Tool names the author turned off. */
  disabled?: string[];
}

export interface HttpParam {
  name: string;
  description?: string;
  type: "string" | "number" | "boolean";
  required?: boolean;
  /** Where the value goes: a {name} placeholder in the URL path, the query string, or a JSON body field. */
  in: "path" | "query" | "body";
}

export interface HttpToolSource {
  id: string;
  kind: "http";
  /** The tool name the model sees, e.g. brave_search. */
  name: string;
  enabled: boolean;
  description: string;
  method: "GET" | "POST";
  /** May contain {param} placeholders for path parameters. */
  url: string;
  /** Values are secret, e.g. an API key header. */
  headers: Record<string, string>;
  params: HttpParam[];
  /** Fixed JSON body fields merged under the body parameters. */
  body?: Record<string, unknown>;
  /** Dotted path to the part of a JSON response worth keeping, e.g. web.results. */
  resultPath?: string;
  /** When the result is a list of objects, keep only these fields of each. */
  fields?: string[];
}

export type ToolSource = McpSource | HttpToolSource;

export interface ToolSettings {
  /** Use the model provider's own server-side web search and fetch (Claude, OpenAI) in place of web_search/fetch_url. */
  nativeWebTools: boolean;
  sources: ToolSource[];
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = { nativeWebTools: true, sources: [] };

/** Lowercase letters, digits and underscores; providers cap tool names at 64 characters. */
export function toolSlug(name: string, max = 40): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
}

export function mcpToolName(server: string, tool: string): string {
  return `mcp__${toolSlug(server, 20)}__${toolSlug(tool, 38)}`;
}

/** Problems that stop settings being saved, as sentences. */
export function validateToolSettings(settings: ToolSettings): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const s of settings.sources) {
    if (!s.name.trim()) problems.push("Every tool and server needs a name.");
    try {
      const url = new URL(s.url.replace(/\{\w+\}/g, "x"));
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error();
    } catch {
      problems.push(`${s.name || "A source"}: the URL must be http(s).`);
    }
    if (s.kind === "http") {
      const name = toolSlug(s.name, 64);
      if (name !== s.name) problems.push(`${s.name}: tool names use lowercase letters, digits and underscores.`);
      if (RESERVED_TOOL_NAMES.includes(name)) problems.push(`${s.name} is a built-in tool name; pick another.`);
      if (names.has(name)) problems.push(`Two tools are called ${name}.`);
      names.add(name);
    } else {
      const prefix = `mcp__${toolSlug(s.name, 20)}`;
      if (names.has(prefix)) problems.push(`Two MCP servers are called ${s.name}.`);
      names.add(prefix);
    }
  }
  return problems;
}

/** Ready-made HTTP tools; the author adds their own key. */
export const HTTP_PRESETS: Omit<HttpToolSource, "id">[] = [
  {
    kind: "http",
    name: "brave_search",
    enabled: true,
    description: "Search the web with Brave Search. Returns titles, URLs and descriptions.",
    method: "GET",
    url: "https://api.search.brave.com/res/v1/web/search",
    headers: { "X-Subscription-Token": "", Accept: "application/json" },
    params: [
      { name: "q", description: "Search query", type: "string", required: true, in: "query" },
      { name: "count", description: "Number of results (1-20)", type: "number", in: "query" },
    ],
    resultPath: "web.results",
    fields: ["title", "url", "description", "age"],
  },
  {
    kind: "http",
    name: "tavily_search",
    enabled: true,
    description: "Search the web with Tavily. Returns titles, URLs and page extracts.",
    method: "POST",
    url: "https://api.tavily.com/search",
    headers: { Authorization: "Bearer " },
    params: [
      { name: "query", description: "Search query", type: "string", required: true, in: "body" },
      { name: "max_results", description: "Number of results (1-10)", type: "number", in: "body" },
    ],
    resultPath: "results",
    fields: ["title", "url", "content"],
  },
  {
    kind: "http",
    name: "jina_reader",
    enabled: true,
    description: "Read a web page as clean markdown through Jina Reader. Pass the full URL.",
    method: "GET",
    url: "https://r.jina.ai/{url}",
    headers: { Authorization: "Bearer " },
    params: [{ name: "url", description: "Full URL of the page", type: "string", required: true, in: "path" }],
  },
];
