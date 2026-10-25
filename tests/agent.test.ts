import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { checkEdits, createWritingExtension, type WritingHost } from "../worker/agent/writing";
import { projectView } from "../worker/agent/view";
import type { PostContext } from "../src/shared/protocol";

const post: PostContext = {
  siteId: "s1",
  siteName: "AI Focus",
  siteInstructions: "Do not anthropomorphize AI systems.",
  path: "content/posts/agents.md",
  url: "/agents/",
  text: "---\ntitle: agents\n---\n\nThe model thinks very hard about it. The model thinks again.\n",
};

describe("checkEdits", () => {
  it("accepts unique matches and explains the rest", () => {
    const { valid, problems } = checkEdits(post.text, [
      { find: "thinks very hard", replace: "computes", reason: "no anthropomorphizing" },
      { find: "The model thinks", replace: "x" },
      { find: "not there", replace: "y" },
    ]);
    expect(valid).toEqual([{ find: "thinks very hard", replace: "computes", reason: "no anthropomorphizing" }]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("more than once");
    expect(problems[1]).toContain("not found");
  });
});

describe("writing agent", () => {
  it("reads the post, proposes edits, and projects the chat", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const host: WritingHost = {
      post: () => post,
      searchPosts: async () => [{ path: "content/posts/old.md", title: "old post", url: "/old/", snippet: "about models" }],
      readPastPost: async () => undefined,
    };
    const registry = createRegistry();
    registry.install(createWritingExtension(host));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
    const root = await harness.root(ctx, { agent: { model: { provider: model.provider, modelId: model.id } } });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("read_post", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage(
        [fauxText("Two fixes."), fauxToolCall("propose_edits", { edits: [{ find: "thinks very hard", replace: "runs for a long time" }, { find: "nope", replace: "x" }] })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Sent one edit; the other did not match.")]),
    ]);
    const submission = await root.submit({ type: "input", content: "Check tone" }, ctx);
    expect((await submission.wait(ctx)).status).toBe("done");

    const view = await root.viewState(ctx);
    const projected = projectView(view.value as never);
    expect(projected.busy).toBe(false);
    expect(projected.items.map((i) => i.kind)).toEqual(["user", "tool", "assistant", "tool", "assistant"]);
    const read = projected.items[1] as Extract<(typeof projected.items)[number], { kind: "tool" }>;
    expect(read.name).toBe("read_post");
    expect(read.status).toBe("done");
    const propose = projected.items[3] as Extract<(typeof projected.items)[number], { kind: "tool" }>;
    expect(propose.edits).toEqual([{ find: "thinks very hard", replace: "runs for a long time" }]);
    expect(propose.summary).toBe("1 edit(s) sent to the author for review.");

    // The site rules and post reach the system prompt.
    const system = (view.value as unknown as { entries: { kind: string; model?: { sections?: Record<string, string> }[] }[] }).entries.find((e) => e.kind === "pi.system");
    expect(system?.model?.[0].sections?.site).toContain("Do not anthropomorphize AI systems.");
    await harness.close(ctx);
  });
});

describe("sessionId", () => {
  it("gives distinct paths distinct sessions, and matches the Worker's route", async () => {
    const { sessionId } = await import("../src/lib/agent-client");
    const a = sessionId("s1", "content/posts/a-b.md");
    const b = sessionId("s1", "content/posts/a/b.md");
    const long = sessionId("s1", `content/posts/${"x".repeat(300)}-é.md`);
    expect(a).not.toBe(b);
    for (const id of [a, b, long]) expect(id).toMatch(/^[\w:-]{1,2048}$/);
  });
});
