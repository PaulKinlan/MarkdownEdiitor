import { describe, expect, it } from "vitest";
import { serveMcp } from "../worker/mcp-server";
import { siteMcpTools, type IndexHost } from "../worker/routes/mcp";
import { McpClient } from "../worker/tools/mcp";

const POST = "---\ntitle: Hello\n---\n\n# Hello\n\nA first post about [this](https://example.com).\n";

const host: IndexHost = {
  listPosts: async () => [{ path: "content/posts/hello.md", title: "Hello", url: "/hello/", date: "2026-10-01", draft: false, frontMatter: { tags: ["ai"] }, words: 7 }],
  terms: async () => [{ term: "ai", count: 1 }],
  grep: async () => ({ matches: [{ path: "content/posts/hello.md", line: 7, text: "A first post" }], total: 1, files: 1 }),
  readFile: async (path) => (path === "content/posts/hello.md" ? { title: "Hello", url: "/hello/", text: POST } : undefined),
  searchPosts: async () => [{ path: "content/posts/hello.md", title: "Hello", url: "/hello/", snippet: "A first post" }],
};

/** An MCP client whose requests go straight to serveMcp. */
function client() {
  const fetcher = (input: RequestInfo | URL, init?: RequestInit) => serveMcp(new Request(input, init), siteMcpTools(host), { name: "hugo-editor", version: "1.0.0" });
  return new McpClient("https://editor.example/api/mcp/sites/s1", {}, fetcher as typeof fetch);
}

describe("the editor's MCP server", () => {
  it("lists the read-only site tools", async () => {
    const names = (await client().listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["list_posts", "list_terms", "grep_posts", "read_post", "search_posts", "analyze_post", "browser_support", "calculate"]));
    expect(names).not.toContain("propose_changes");
    expect(names).not.toContain("web_search");
  });

  it("calls tools, and reports bad calls as tool errors", async () => {
    const mcp = client();
    const read = await mcp.callTool("read_post", { path: "content/posts/hello.md" });
    expect(read.isError).toBeUndefined();
    expect(read.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("A first post") });
    expect((await mcp.callTool("analyze_post", { path: "content/posts/hello.md" })).content[0]).toMatchObject({ text: expect.stringContaining("words") });
    expect((await mcp.callTool("calculate", { expressions: ["2 + 2"] })).content[0]).toMatchObject({ text: "2 + 2 = 4" });
    expect(await mcp.callTool("read_post", { path: "missing.md" })).toMatchObject({ isError: true });
    expect(await mcp.callTool("read_post", {})).toMatchObject({ isError: true });
    expect(await mcp.callTool("propose_changes", { changes: [] })).toMatchObject({ isError: true });
  });

  it("speaks JSON-RPC: notifications, unknown methods, GET", async () => {
    const send = (body: unknown, method = "POST") =>
      serveMcp(new Request("https://x/api/mcp/sites/s1", { method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }), [], { name: "t", version: "1" });
    expect((await send({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    expect(await (await send({ jsonrpc: "2.0", id: 1, method: "nope" })).json()).toMatchObject({ id: 1, error: { code: -32601 } });
    expect(await (await send({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json()).toMatchObject({
      result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } },
    });
    expect((await send(undefined, "GET")).status).toBe(405);
  });
});
