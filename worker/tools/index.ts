import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, type Extension, type Registry } from "@earendil-works/pi-durable";
import { mcpToolName, type HttpToolSource, type McpSource, type ToolSettings } from "../../src/shared/tools";
import type { Env } from "../env";
import { runHttpTool, truncate } from "./http";
import { McpClient, type McpCallResult } from "./mcp";

export { addNativeWebTools, hasNativeWebSearch } from "./native";

/** The author's tool settings from the ToolStore. */
export function loadToolSettings(env: Env): Promise<ToolSettings> {
  return env.TOOL_STORE.get(env.TOOL_STORE.idFromName("default")).settings();
}

/**
 * Builds one Pi Durable extension per enabled source: `tools:mcp:<id>` with
 * the server's tools, `tools:http:<id>` with one HTTP tool. MCP tools come
 * from the list saved with the settings, so building needs no network; the
 * server is contacted on the first call.
 */
export function toolExtensions(settings: ToolSettings): Extension[] {
  const out: Extension[] = [];
  for (const source of settings.sources) {
    if (!source.enabled) continue;
    try {
      out.push(source.kind === "mcp" ? mcpExtension(source) : httpExtension(source));
    } catch (e) {
      // One broken source shouldn't take the others (or the session) down.
      console.warn(`Skipping tool source ${source.name}:`, e);
    }
  }
  return out;
}

/**
 * Installs the configured tools into a harness registry, replacing what an
 * earlier call installed. Returns the installed extensions, to pass back on
 * the next call. Any agent (post session, site assistant) can use this.
 */
export function installConfiguredTools(registry: Registry, settings: ToolSettings, previous: readonly Extension[] = []): Extension[] {
  const next = toolExtensions(settings);
  const names = new Set(next.map((e) => e.name));
  for (const old of previous) if (!names.has(old.name)) registry.uninstall(old);
  for (const ext of next) registry.install(ext);
  return next;
}

function mcpExtension(source: McpSource): Extension {
  let client: McpClient | undefined;
  const connect = () => (client ??= new McpClient(source.url, source.headers));
  const disabled = new Set(source.disabled ?? []);
  const tools = source.tools
    .filter((t) => !disabled.has(t.name))
    .map((t) =>
      defineTool({
        name: mcpToolName(source.name, t.name),
        description: `${t.description ?? t.name} (MCP server: ${source.name})`.slice(0, 1024),
        parameters: Type.Unsafe<Record<string, unknown>>(cleanSchema(t.inputSchema)),
        execute: async (args, _api, context) => {
          try {
            return mcpResult(await connect().callTool(t.name, args, context.abortSignal));
          } catch (e) {
            client = undefined; // a fresh session next time, in case the server forgot ours
            throw e;
          }
        },
      }),
    );
  return defineExtension({ name: `tools:mcp:${source.id}`, tools: tools as never });
}

function httpExtension(source: HttpToolSource): Extension {
  const properties: Record<string, unknown> = {};
  for (const p of source.params) properties[p.name] = { type: p.type, ...(p.description ? { description: p.description } : {}) };
  const required = source.params.filter((p) => p.required).map((p) => p.name);
  const tool = defineTool({
    name: source.name,
    description: source.description || `Call ${new URL(source.url.replace(/\{\w+\}/g, "x")).host}`,
    parameters: Type.Unsafe<Record<string, unknown>>({ type: "object", properties, ...(required.length ? { required } : {}) }),
    // A GET only reads, so rerunning it after an eviction is harmless.
    ...(source.method === "GET" ? { replay: "safe" as const } : {}),
    execute: async (args, _api, context) => ({ output: [{ type: "text", text: await runHttpTool(source, args, context.abortSignal) }] }),
  });
  return defineExtension({ name: `tools:http:${source.id}`, tools: [tool] as never });
}

type Output = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export function mcpResult(result: McpCallResult): { output: Output[]; isError?: boolean } {
  const output: Output[] = [];
  for (const c of result.content ?? []) {
    if (c.type === "text") output.push({ type: "text", text: truncate(c.text, 20_000) });
    else if (c.type === "image") output.push({ type: "image", data: c.data, mimeType: c.mimeType });
    else if (c.type === "resource") output.push({ type: "text", text: truncate(c.resource.text ?? `[${c.resource.mimeType ?? "binary"} resource ${c.resource.uri}]`, 20_000) });
    else if (c.type === "resource_link") output.push({ type: "text", text: `${c.name ?? "Link"}: ${c.uri}` });
  }
  if (!output.length && result.structuredContent !== undefined) output.push({ type: "text", text: truncate(JSON.stringify(result.structuredContent), 20_000) });
  if (!output.length) output.push({ type: "text", text: "(no output)" });
  return { output, ...(result.isError ? { isError: true } : {}) };
}

/** Drops JSON Schema keywords the validator doesn't need and may reject ($schema, $id, format). */
export function cleanSchema(schema: unknown): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "$schema" || k === "$id" || k === "format") continue;
      out[k] = k === "properties" && v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv)])) : walk(v);
    }
    return out;
  };
  const cleaned = walk(schema) as Record<string, unknown>;
  return cleaned && cleaned.type === "object" ? cleaned : { type: "object", properties: {} };
}
