import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { ExtensionBridge, type ExtensionTransport } from "../worker/agent/extension-bridge";
import { createWritingExtension } from "../worker/agent/writing";
import { projectView } from "../worker/agent/view";
import type { AgentExtensionSpec, ExtensionCall } from "../src/shared/extensions";

const post = { siteId: "s1", siteName: "Blog", siteInstructions: "", path: "content/a.md", url: "/a/", text: "---\ntitle: a\n---\n\nOne two three.\n" };

const readability: AgentExtensionSpec = {
  id: "readability",
  name: "Readability",
  tools: [
    {
      name: "readability_report",
      description: "Grade level of the post",
      parameters: { type: "object", properties: { detail: { type: "boolean" } } },
    },
    // Reserved: a built-in tool has this name.
    { name: "read_post", description: "Shadow", parameters: { type: "object", properties: {} } },
    // Only for the site-wide assistant.
    { name: "site_report", description: "Site", parameters: { type: "object", properties: {} }, scope: "site" },
  ],
  sections: [{ name: "style", text: "Prefer short sentences." }],
  hooks: { beforeTool: true, afterTool: false },
};

async function setup(transport: ExtensionTransport) {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel();
  const registry = createRegistry();
  const writing = createWritingExtension({ post: () => post, searchPosts: async () => [], readPastPost: async () => undefined });
  registry.install(writing);
  const bridge = new ExtensionBridge(registry, transport, { scope: "post", reserved: new Set(writing.tools!.map((t) => t.name)) });
  const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
  const root = await harness.root(ctx, { agent: { model: { provider: model.provider, modelId: model.id } } });
  return { faux, bridge, harness, root };
}

describe("extension bridge", () => {
  it("installs extension tools and sections, and forwards calls and hooks to the editor", async () => {
    const calls: ExtensionCall[] = [];
    const transport: ExtensionTransport = {
      call: async (call) => {
        calls.push(call);
        if (call.kind === "tool") return { text: `Grade 6 (${JSON.stringify(call.args)})` } as never;
        if (call.kind === "beforeTool" && call.tool === "search_posts") return { block: "Searching is off in this test" } as never;
        return undefined as never;
      },
    };
    const { faux, bridge, harness, root } = await setup(transport);
    const problems = bridge.sync([readability]);
    expect(problems).toEqual(["readability: skipped tool read_post, a built-in tool has that name"]);

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("readability_report", { detail: true }), fauxToolCall("search_posts", { query: "x" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done.")]),
    ]);
    const submission = await root.submit({ type: "input", content: "How readable is it?" }, ctx);
    expect((await submission.wait(ctx)).status).toBe("done");

    const agent = await root.agent(ctx);
    const names = agent.tools.map((t) => t.name);
    expect(names).toContain("readability_report");
    expect(names).not.toContain("site_report");

    const view = projectView((await root.viewState(ctx)).value as never);
    const tools = view.items.filter((i) => i.kind === "tool");
    expect(tools.map((t) => [t.name, t.status, t.summary])).toEqual([
      ["readability_report", "done", 'Grade 6 ({"detail":true})'],
      ["search_posts", "error", expect.any(String)],
    ]);
    // The hook saw both calls; the tool ran once.
    expect(calls.filter((c) => c.kind === "beforeTool").map((c) => (c as { tool: string }).tool)).toEqual(["readability_report", "search_posts"]);
    expect(calls.filter((c) => c.kind === "tool")).toHaveLength(1);

    const system = (await root.viewState(ctx)).value as unknown as { entries: { kind: string; model?: { sections?: Record<string, string> }[] }[] };
    expect(system.entries.find((e) => e.kind === "pi.system")?.model?.[0].sections?.["readability-style"]).toContain("Prefer short sentences.");
    await harness.close(ctx);
  });

  it("reports a closed editor as a tool error, lets hooks fail open, and uninstalls removed extensions", async () => {
    const transport: ExtensionTransport = { call: async () => Promise.reject(new Error("The editor isn't open")) };
    const { faux, bridge, harness, root } = await setup(transport);
    bridge.sync([readability]);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("readability_report", {}), fauxToolCall("read_post", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("ok")]),
    ]);
    await (await root.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
    const view = projectView((await root.viewState(ctx)).value as never);
    const tools = view.items.filter((i) => i.kind === "tool");
    expect(tools.map((t) => [t.name, t.status])).toEqual([
      ["readability_report", "error"],
      ["read_post", "done"],
    ]);
    expect(tools[0].summary).toContain("The editor isn't open");

    bridge.sync([]);
    expect(bridge.ids).toEqual([]);
    expect((await root.agent(ctx)).tools.map((t) => t.name)).not.toContain("readability_report");
    await harness.close(ctx);
  });

  it("skips specs with invalid ids", () => {
    const registry = createRegistry();
    const bridge = new ExtensionBridge(registry, { call: async () => undefined as never }, { scope: "post", reserved: new Set() });
    expect(bridge.sync([{ ...readability, id: "../bad" }])[0]).toContain("invalid id");
    expect(bridge.ids).toEqual([]);
  });
});
