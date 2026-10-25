import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { HTTP_PRESETS, SECRET_MASK, validateToolSettings, type HttpToolSource, type McpSource, type ToolSettings } from "../src/shared/tools";
import { cleanSchema, installConfiguredTools } from "../worker/tools";
import { buildHttpRequest, shapeJson } from "../worker/tools/http";
import { McpClient } from "../worker/tools/mcp";
import { addNativeWebTools, withNativeWebTools } from "../worker/tools/native";
import { maskSecrets, unmaskSecrets } from "../worker/tools/secrets";

afterEach(() => vi.unstubAllGlobals());

const brave: HttpToolSource = { ...HTTP_PRESETS[0], id: "b1", headers: { "X-Subscription-Token": "secret-key" } };

describe("native web tools", () => {
  const payload = { model: "x", tools: [{ name: "read_post" }, { name: "web_search" }, { name: "fetch_url" }] };

  it("swaps our web tools for Claude's server tools, by model generation", () => {
    expect(withNativeWebTools(payload, "anthropic-messages", "claude-opus-5-5")?.tools).toEqual([
      { name: "read_post" },
      { type: "web_search_20260209", name: "web_search", max_uses: 5 },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
    ]);
    expect(withNativeWebTools(payload, "anthropic-messages", "claude-haiku-4-5")?.tools?.map((t) => t.type)).toEqual([undefined, "web_search_20250305", "web_fetch_20250910"]);
  });

  it("gives OpenAI Responses its web_search tool and leaves other APIs alone", () => {
    expect(withNativeWebTools(payload, "openai-responses", "gpt-5")?.tools?.at(-1)).toEqual({ type: "web_search" });
    expect(withNativeWebTools(payload, "openai-completions", "deepseek-flash")).toBeUndefined();
  });

  it("wraps providers so requests carry the tools while enabled", async () => {
    let seen: unknown;
    const provider = {
      id: "anthropic",
      name: "Anthropic",
      auth: { apiKey: { name: "k", resolve: async () => ({ auth: { apiKey: "k" } }) } },
      getModels: () => [{ id: "claude-opus-5-5", provider: "anthropic", api: "anthropic-messages", type: "chat" }],
      stream: async (_m: unknown, _c: unknown, o?: { onPayload?: (p: unknown, m: unknown) => unknown }) => (seen = await o?.onPayload?.(payload, _m)),
      streamSimple: () => undefined,
    };
    const models = createModels();
    models.setProvider(provider as never);
    let on = true;
    const wrapped = addNativeWebTools(models, () => on).getProviders()[0];
    const model = { id: "claude-opus-5-5", api: "anthropic-messages" };
    await wrapped.stream(model as never, {} as never, {});
    expect((seen as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(["read_post", "web_search", "web_fetch"]);
    on = false;
    seen = undefined;
    await wrapped.stream(model as never, {} as never, {});
    expect(seen).toBeUndefined();
    expect(wrapped.getModels()).toHaveLength(1);
  });
});

describe("tool settings", () => {
  it("masks secrets on the way out and keeps them when the mask comes back", () => {
    const stored: ToolSettings = { nativeWebTools: true, sources: [brave] };
    const masked = maskSecrets(stored);
    expect((masked.sources[0] as HttpToolSource).headers["X-Subscription-Token"]).toBe(SECRET_MASK);
    expect(unmaskSecrets(masked, stored).sources[0].headers["X-Subscription-Token"]).toBe("secret-key");
    const changed = { ...masked, sources: [{ ...masked.sources[0], headers: { "X-Subscription-Token": "new" } }] };
    expect(unmaskSecrets(changed, stored).sources[0].headers["X-Subscription-Token"]).toBe("new");
  });

  it("rejects clashing and reserved names", () => {
    const problems = validateToolSettings({ nativeWebTools: true, sources: [brave, { ...brave, id: "b2" }, { ...brave, id: "b3", name: "web_search" }] });
    expect(problems.join(" ")).toContain("Two tools are called brave_search");
    expect(problems.join(" ")).toContain("built-in tool name");
  });
});

describe("HTTP tools", () => {
  it("puts parameters in the path, query and body", async () => {
    const get = buildHttpRequest(brave, { q: "hugo shortcodes", count: 3 });
    expect(get.url).toBe("https://api.search.brave.com/res/v1/web/search?q=hugo+shortcodes&count=3");
    expect(get.headers.get("X-Subscription-Token")).toBe("secret-key");
    const reader = buildHttpRequest({ ...HTTP_PRESETS[2], id: "j" }, { url: "https://aifoc.us/post/" });
    expect(reader.url).toBe("https://r.jina.ai/https://aifoc.us/post/");
    const post = buildHttpRequest({ ...HTTP_PRESETS[1], id: "t" }, { query: "webmcp", max_results: 2 });
    expect(await post.json()).toEqual({ query: "webmcp", max_results: 2 });
  });

  it("keeps the selected part of a JSON reply", () => {
    const data = { web: { results: [{ title: "A", url: "https://a", description: "d", extra: 1 }] } };
    expect(JSON.parse(shapeJson(data, "web.results", ["title", "url"]))).toEqual([{ title: "A", url: "https://a" }]);
  });
});

/** A fake Streamable HTTP MCP server: answers initialize as JSON and tool calls as SSE. */
function fakeMcp() {
  const calls: { method: string; session: string | null; auth: string | null }[] = [];
  const fetcher = async (_url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const msg = JSON.parse(String(init?.body));
    calls.push({ method: msg.method, session: headers.get("Mcp-Session-Id"), auth: headers.get("Authorization") });
    if (msg.method === "initialize") return Response.json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "Mcp-Session-Id": "s-1" } });
    if (!("id" in msg)) return new Response(null, { status: 202 });
    if (msg.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: { tools: [{ name: "lookup", description: "Look a word up", inputSchema: { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { word: { type: "string", format: "word" } }, required: ["word"] } }] },
      });
    }
    const sse = `event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `defined: ${msg.params.arguments.word}` }] } })}\n\n`;
    return new Response(sse, { headers: { "content-type": "text/event-stream" } });
  };
  return { calls, fetcher };
}

describe("MCP client", () => {
  it("initializes once, keeps the session, and reads JSON and SSE replies", async () => {
    const { calls, fetcher } = fakeMcp();
    const client = new McpClient("https://mcp.example/mcp", { Authorization: "Bearer t" }, fetcher as typeof fetch);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["lookup"]);
    const result = await client.callTool("lookup", { word: "hugo" });
    expect(result.content).toEqual([{ type: "text", text: "defined: hugo" }]);
    expect(calls.map((c) => c.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    expect(calls.slice(1).every((c) => c.session === "s-1" && c.auth === "Bearer t")).toBe(true);
  });

  it("strips schema keywords the validator doesn't need", () => {
    expect(cleanSchema({ $schema: "x", type: "object", properties: { format: { type: "string", format: "uri" } } })).toEqual({ type: "object", properties: { format: { type: "string" } } });
    expect(cleanSchema(undefined)).toEqual({ type: "object", properties: {} });
  });
});

describe("configured tools in a harness", () => {
  it("lets the model call MCP and HTTP tools, and drops removed ones", async () => {
    const { fetcher } = fakeMcp();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://mcp.example")) return fetcher(input, init);
      return Response.json({ web: { results: [{ title: "Hugo docs", url: "https://gohugo.io", description: "Docs" }] } });
    });
    const client = new McpClient("https://mcp.example/mcp", {}, fetcher as typeof fetch);
    const mcp: McpSource = { id: "m1", kind: "mcp", name: "Dictionary", enabled: true, url: "https://mcp.example/mcp", headers: {}, tools: await client.listTools() };
    const settings: ToolSettings = { nativeWebTools: true, sources: [mcp, brave] };

    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const registry = createRegistry();
    let installed = installConfiguredTools(registry, settings);
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
    const root = await harness.root(ctx, { agent: { model: { provider: model.provider, modelId: model.id } } });
    expect((await root.agent(ctx)).tools.map((t) => t.name)).toEqual(["mcp__dictionary__lookup", "brave_search"]);

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("mcp__dictionary__lookup", { word: "shortcode" }), fauxToolCall("brave_search", { q: "hugo" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done.")]),
    ]);
    const submission = await root.submit({ type: "input", content: "Look it up" }, ctx);
    expect((await submission.wait(ctx)).status).toBe("done");
    const view = (await root.viewState(ctx)).value as unknown as { entries: { kind: string; model?: { content?: { text?: string }[]; isError?: boolean }[] }[] };
    const results = view.entries.filter((e) => e.kind === "pi.tool-result").map((e) => e.model?.[0]);
    expect(results.map((r) => r?.isError)).toEqual([false, false]);
    const texts = results.map((r) => r?.content?.[0]?.text ?? "");
    expect(texts).toContain("defined: shortcode");
    expect(texts.some((t) => t.includes("Hugo docs"))).toBe(true);

    installed = installConfiguredTools(registry, { ...settings, sources: [brave] }, installed);
    expect(installed).toHaveLength(1);
    expect((await root.agent(ctx)).tools.map((t) => t.name)).toEqual(["brave_search"]);
    await harness.close(ctx);
  });
});
