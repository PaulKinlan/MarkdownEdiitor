import { afterEach, describe, expect, it, vi } from "vitest";
import { fitPost, OnDeviceConnection, onDeviceModels, parseResponse, proseOnly } from "../src/lib/on-device";
import { collectChanges } from "../src/lib/file-watcher";
import { applyDictionary, parseWordList, siteWords } from "../src/lib/spelling";
import { editorTools, registerEditorTools, type EditorToolHost } from "../src/lib/webmcp";
import type { PostSummary } from "../src/lib/posts";
import type { PostContext } from "../src/shared/protocol";

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.LanguageModel;
  delete g.document;
  delete g.navigator;
});

const post: PostContext = {
  siteId: "s1",
  siteName: "AI Focus",
  siteInstructions: "",
  path: "content/posts/a.md",
  url: "/a/",
  text: "---\ntitle: A\n---\n\nThis is really very good. It is good.\n",
};

function fakeLanguageModel(reply: string, window = 4000) {
  const prompts: { input: string; initial: unknown }[] = [];
  g.LanguageModel = {
    availability: async () => "available",
    create: async (options: { initialPrompts: unknown }) => ({
      contextWindow: window,
      contextUsage: 200,
      measureContextUsage: async (s: string) => Math.ceil(s.length / 3),
      prompt: async (input: string) => {
        prompts.push({ input, initial: options.initialPrompts });
        return reply;
      },
      destroy() {},
    }),
  };
  return prompts;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("on-device assistant", () => {
  it("is offered only when the browser has a model", async () => {
    expect(await onDeviceModels()).toEqual([]);
    fakeLanguageModel("{}");
    expect((await onDeviceModels()).map((m) => `${m.provider}/${m.modelId}`)).toEqual(["chrome/on-device"]);
  });

  it("parses structured replies and falls back to plain text", () => {
    expect(parseResponse('{"reply":"ok","edits":[{"find":"a","replace":"b"},{"find":1}]}')).toEqual({ reply: "ok", edits: [{ find: "a", replace: "b" }] });
    expect(parseResponse("just words")).toEqual({ reply: "just words", edits: [] });
  });

  it("cuts long posts and says so", () => {
    expect(fitPost("short", 100)).toBe("short");
    const cut = fitPost("x".repeat(1000), 200);
    expect(cut.length).toBeLessThan(260);
    expect(cut).toContain("cut to fit");
  });

  it("strips code, shortcodes and links before summarising", () => {
    expect(proseOnly("Hi [there](https://x).\n\n```js\ncode\n```\n\n{{< figure src=\"a\" >}}\n![img](a.png) end")).toBe("Hi there.\n\n end");
  });

  it("answers, proposes only edits that match, and keeps the conversation", async () => {
    const prompts = fakeLanguageModel(
      JSON.stringify({
        reply: "Cut the intensifiers.",
        edits: [
          { find: "really very good", replace: "good", reason: "intensifiers" },
          { find: "good", replace: "fine" },
        ],
      }),
    );
    const c = new OnDeviceConnection("s1:test-1");
    c.updatePost(post);
    c.prompt("Tighten this", { provider: "chrome", modelId: "on-device" }, "Tighten");
    await settle();
    await settle();
    const items = c.view!.items;
    expect(items[0]).toMatchObject({ kind: "user", label: "Tighten" });
    expect(items[1]).toMatchObject({ kind: "assistant" });
    expect((items[1] as { text: string }).text).toContain("1 suggestion skipped");
    expect(items[2]).toMatchObject({ kind: "tool", name: "propose_edits", edits: [{ find: "really very good", replace: "good", reason: "intensifiers" }] });
    expect(c.view!.busy).toBe(false);
    expect(prompts[0].input).toContain(post.text);

    // A new connection for the same post picks the conversation up, and sends it as history.
    const again = new OnDeviceConnection("s1:test-1");
    expect(again.view!.items).toHaveLength(3);
    again.updatePost(post);
    again.prompt("And now?", { provider: "chrome", modelId: "on-device" });
    await settle();
    await settle();
    expect(prompts[1].initial).toEqual(expect.arrayContaining([{ role: "user", content: "Tighten this" }]));
    again.reset();
    expect(again.view!.items).toEqual([]);
  });

  it("doesn't run queued prompts after the connection closes", async () => {
    const prompts = fakeLanguageModel('{"reply":"hi","edits":[]}');
    const c = new OnDeviceConnection("s1:test-3");
    c.updatePost(post);
    c.prompt("one", { provider: "chrome", modelId: "on-device" });
    c.prompt("two", { provider: "chrome", modelId: "on-device" });
    c.close();
    await settle();
    await settle();
    expect(prompts).toHaveLength(0);
    expect(c.view!.items.filter((i) => i.kind === "assistant").map((i) => (i as { error?: string }).error)).toEqual(["Stopped.", "Stopped."]);
  });

  it("reports a missing model instead of hanging", async () => {
    const c = new OnDeviceConnection("s1:test-2");
    c.updatePost(post);
    c.prompt("Hi", { provider: "chrome", modelId: "on-device" });
    await settle();
    expect(c.view!.items[1]).toMatchObject({ kind: "assistant", error: expect.stringContaining("isn't available") });
  });
});

describe("folder watching", () => {
  it("collects changed paths, both ends of moves, and skips build output", () => {
    const changes = collectChanges([
      { type: "modified", relativePathComponents: ["content", "posts", "a.md"], relativePathMovedFrom: null },
      { type: "moved", relativePathComponents: ["content", "b.md"], relativePathMovedFrom: ["content", "old.md"] },
      { type: "modified", relativePathComponents: [".git", "index"], relativePathMovedFrom: null },
      { type: "appeared", relativePathComponents: ["public", "index.html"], relativePathMovedFrom: null },
    ]);
    expect([...changes.paths].sort()).toEqual(["content/b.md", "content/old.md", "content/posts/a.md"]);
    expect(changes.rescan).toBe(false);
    expect([...changes.dirs]).toEqual([]);
    expect(collectChanges([{ type: "unknown", relativePathComponents: [], relativePathMovedFrom: null }]).rescan).toBe(true);
  });

  it("marks folders, from the handle or the name", () => {
    const dir = { kind: "directory" } as FileSystemHandle;
    const changes = collectChanges([
      { type: "moved", relativePathComponents: ["content", "posts", "new-bundle"], relativePathMovedFrom: ["content", "posts", "bundle"], changedHandle: dir },
      { type: "disappeared", relativePathComponents: ["content", "drafts"], relativePathMovedFrom: null, changedHandle: null },
      { type: "disappeared", relativePathComponents: ["content", "x.md"], relativePathMovedFrom: null, changedHandle: null },
    ]);
    expect([...changes.dirs].sort()).toEqual(["content/drafts", "content/posts/bundle", "content/posts/new-bundle"]);
  });
});

describe("spell check dictionary", () => {
  const summary = (frontMatter: Record<string, unknown>) => ({ frontMatter }) as unknown as PostSummary;

  it("combines the author's words with tags and categories", () => {
    expect(parseWordList("Hugo, WebMCP\naifoc.us  Hugo")).toEqual(["Hugo", "WebMCP", "aifoc.us"]);
    const words = siteWords([summary({ tags: ["WebGPU", "Project Fugu"], categories: ["AI/ML"] }), summary({ tags: "x" })], ["Kinlan"]);
    expect(words.sort()).toEqual(["AI", "Fugu", "Kinlan", "ML", "Project", "WebGPU"]);
  });

  it("adds and removes only the difference", () => {
    const addWords = vi.fn();
    const removeWords = vi.fn();
    g.document = { spellCheckCustomDictionary: { addWords, removeWords } };
    applyDictionary(["a", "b"]);
    applyDictionary(["b", "c"]);
    expect(addWords.mock.calls).toEqual([[["a", "b"]], [["c"]]]);
    expect(removeWords.mock.calls).toEqual([[["a"]]]);
    applyDictionary([]);
  });
});

describe("WebMCP tools", () => {
  const host: EditorToolHost = {
    currentPost: () => ({ path: "content/a.md", url: "/a/", title: "A", text: "hello", unsaved: false }),
    listPosts: (q, limit) => [{ path: "content/a.md", title: `A ${q}`, url: "/a/", draft: false }].slice(0, limit),
    openPost: async () => undefined,
    insertText: () => undefined,
    applyEdits: (edits) => ({ applied: edits.length, problems: [] }),
    save: async () => "Saved",
    listEdits: () => [{ name: "Proofread", instruction: "..." }],
    runEdit: (name) => `Started ${name}`,
  };

  it("registers every tool and unregisters them on dispose", async () => {
    const registered: { name: string; signal?: AbortSignal }[] = [];
    g.document = { modelContext: { registerTool: (tool: { name: string }, o: { signal?: AbortSignal }) => (registered.push({ name: tool.name, signal: o.signal }), Promise.resolve()) } };
    g.navigator = {};
    const dispose = registerEditorTools(host);
    expect(registered.map((r) => r.name)).toEqual(["get_current_post", "list_posts", "open_post", "insert_text", "apply_edits", "save_post", "list_edits", "run_edit"]);
    dispose();
    expect(registered.every((r) => r.signal?.aborted)).toBe(true);
  });

  it("supports early builds on navigator that return unregister()", () => {
    const unregister = vi.fn();
    g.document = {};
    g.navigator = { modelContext: { registerTool: () => ({ unregister }) } };
    registerEditorTools(host)();
    expect(unregister).toHaveBeenCalledTimes(8);
  });

  it("runs tools against the host", async () => {
    const tools = Object.fromEntries(editorTools(host).map((t) => [t.name, t]));
    expect(JSON.parse(String(await tools.get_current_post.execute({})))).toMatchObject({ path: "content/a.md" });
    expect(JSON.parse(String(await tools.list_posts.execute({ query: "x", limit: 5 })))[0].title).toBe("A x");
    const limits: number[] = [];
    const capture = Object.fromEntries(editorTools({ ...host, listPosts: (_q, limit) => (limits.push(limit), []) }).map((t) => [t.name, t]));
    for (const limit of [-1, 0, 500, 2.7, "x"]) await capture.list_posts.execute({ limit });
    expect(limits).toEqual([1, 20, 100, 2, 20]);
    expect(JSON.parse(String(await tools.apply_edits.execute({ edits: [{ find: "a", replace: "b" }] })))).toEqual({ applied: 1, problems: [] });
    expect(await tools.open_post.execute({ path: "content/a.md" })).toBe("Opened content/a.md.");
    expect(await tools.run_edit.execute({ name: "Proofread" })).toBe("Started Proofread");
  });
});
