import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { addNativeWebTools } from "../../worker/tools/native";

// Calls the real Anthropic API, so it only runs where a key is set: the "Live tools" workflow, or locally with
// ANTHROPIC_API_KEY=… npx vitest run tests/live
const key = process.env.ANTHROPIC_API_KEY;

// The editor's own tools, which the wrapper swaps for Claude's server tools.
const tools = [
  { name: "web_search", description: "Search the web.", parameters: Type.Object({ query: Type.String() }) },
  { name: "fetch_url", description: "Fetch a web page.", parameters: Type.Object({ url: Type.String() }) },
];

async function ask(prompt: string) {
  const models = createModels();
  models.setProvider(anthropicProvider());
  addNativeWebTools(models, () => true);
  const model = models.getModel("anthropic", "claude-sonnet-5-5")!;
  const serverTools: string[] = [];
  const message = await models.complete(
    model,
    { messages: [{ role: "user", content: prompt, timestamp: Date.now() }], tools },
    {
      maxTokens: 4000,
      onProviderStreamEvent: (event: unknown) => {
        const e = event as { type?: string; content_block?: { type?: string; name?: string } };
        if (e.type === "content_block_start" && e.content_block?.type === "server_tool_use") serverTools.push(e.content_block.name ?? "");
      },
    } as never,
  );
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const clientCalls = message.content.filter((b) => b.type === "toolCall").map((b) => (b as { name: string }).name);
  return { message, text, serverTools, clientCalls };
}

describe.skipIf(!key)("Claude's server-side web tools (live)", () => {
  it("searches the web itself instead of calling web_search", async () => {
    const r = await ask("Use web search to find the latest released version of the Hugo static site generator. Reply with just the version number.");
    expect(r.message.stopReason, r.message.errorMessage).not.toBe("error");
    expect(r.serverTools).toContain("web_search");
    expect(r.clientCalls).toEqual([]);
    expect(r.text).toMatch(/\d+\.\d+/);
  }, 180_000);

  it("reads a page itself instead of calling fetch_url", async () => {
    const r = await ask("Fetch https://example.com/ and tell me the text of its main heading, nothing else.");
    expect(r.message.stopReason, r.message.errorMessage).not.toBe("error");
    expect(r.serverTools).toContain("web_fetch");
    expect(r.clientCalls).toEqual([]);
    expect(r.text).toMatch(/Example Domain/i);
  }, 180_000);
});
