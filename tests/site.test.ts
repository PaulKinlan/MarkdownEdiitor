import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { checkChanges, createSiteExtension, type SiteHost } from "../worker/agent/site";
import { countTerms, filterPosts, grepFiles, type PostListing } from "../worker/agent/site-data";
import { projectView } from "../worker/agent/view";
import type { SiteContext } from "../src/shared/protocol";

const files: Record<string, string> = {
  "content/posts/a.md": "---\ntitle: A\ntags: [AI, web]\n---\n\nSee [b](/b/). Chrome ships it.\n",
  "content/posts/b.md": "---\ntitle: B\ntags: [ai]\n---\n\nChrome and chrome.\n",
  "content/notes-like/c.md": "---\ntitle: C\n---\n\nNo tags here.\n",
  "notes/agents.md": "---\ntitle: Agents\nstatus: idea\n---\n\n## Sources\n",
};

const listings: PostListing[] = [
  { path: "content/posts/a.md", title: "A", url: "/a/", date: "2026-01-02", draft: false, frontMatter: { tags: ["AI", "web"] }, words: 5 },
  { path: "content/posts/b.md", title: "B", url: "/b/", date: "2026-03-01", draft: true, frontMatter: { tags: ["ai"] }, words: 3 },
  { path: "content/notes-like/c.md", title: "C", url: "/c/", date: "2025-06-01", draft: false, frontMatter: {}, words: 3 },
  { path: "notes/agents.md", title: "Agents", url: "", date: "2026-10-01", draft: false, frontMatter: { status: "idea" }, words: 1 },
];

const site: SiteContext = { siteId: "s1", siteName: "AI Focus", siteInstructions: "Say 'web platform', not 'the web'.", contentDir: "content", sections: ["posts"] };

describe("site data", () => {
  it("filters posts by section, field, missing field, draft and date, newest first, and lists notes separately", () => {
    expect(filterPosts(listings, "content", {}).map((p) => p.title)).toEqual(["B", "A", "C"]);
    expect(filterPosts(listings, "content", { section: "posts" }).map((p) => p.title)).toEqual(["B", "A"]);
    expect(filterPosts(listings, "content", { field: "tags", value: "ai" }).map((p) => p.title)).toEqual(["B", "A"]);
    expect(filterPosts(listings, "content", { missing: "tags" }).map((p) => p.title)).toEqual(["C"]);
    expect(filterPosts(listings, "content", { draft: false, since: "2026-01-01" }).map((p) => p.title)).toEqual(["A"]);
    expect(filterPosts(listings, "content", { notes: true }).map((p) => p.title)).toEqual(["Agents"]);
  });

  it("counts terms case-sensitively so near-duplicates show up", () => {
    expect(countTerms(listings, "tags")).toEqual([
      { term: "ai", count: 1 },
      { term: "AI", count: 1 },
      { term: "web", count: 1 },
    ]);
  });

  it("greps literally by default, with line numbers and a total past the limit", () => {
    const all = Object.entries(files).map(([path, text]) => ({ path, text }));
    const literal = grepFiles(all, "chrome", { limit: 1 });
    expect(literal).toEqual({ matches: [{ path: "content/posts/a.md", line: 6, text: "See [b](/b/). Chrome ships it." }], total: 2, files: 2 });
    expect(grepFiles(all, "[b]").total).toBe(1);
    expect(grepFiles(all, "^tags: \\[ai\\]$", { regex: true }).matches.map((m) => m.path)).toEqual(["content/posts/b.md"]);
    expect(() => grepFiles(all, "(", { regex: true })).toThrow();
  });
});

const host: SiteHost = {
  site: () => site,
  listPosts: async (filter) => filterPosts(listings, "content", filter),
  terms: async (key) => countTerms(listings, key),
  grep: async (pattern, options) => grepFiles(Object.entries(files).map(([path, text]) => ({ path, text })), pattern, options),
  readFile: async (path) => (files[path] ? { title: path, url: "/", text: files[path] } : undefined),
  searchPosts: async () => [],
};

describe("checkChanges", () => {
  it("keeps applicable edits and new posts or notes, and explains the rest", async () => {
    const { valid, problems } = await checkChanges(host, site, [
      { path: "content/posts/a.md", edits: [{ find: "Chrome ships", replace: "Chrome 140 ships" }, { find: "missing", replace: "x" }] },
      { path: "/content/posts/b.md", edits: [{ find: "Chrome and", replace: "Chrome, and" }] },
      { path: "content/posts/a.md", edits: [{ find: "See", replace: "Read" }] },
      { path: "content/posts/new.md", create: "---\ntitle: New\ndraft: true\n---\n" },
      { path: "notes/rag.md", create: "---\ntitle: RAG\n---\n" },
      { path: "notes/agents.md", create: "dup" },
      { path: "static/x.md", create: "nope" },
      { path: "content/../x.md", edits: [{ find: "a", replace: "b" }] },
      { path: "content/posts/zzz.md", edits: [{ find: "a", replace: "b" }] },
    ]);
    expect(valid).toEqual([
      { path: "content/posts/a.md", edits: [{ find: "Chrome ships", replace: "Chrome 140 ships" }] },
      { path: "content/posts/b.md", edits: [{ find: "Chrome and", replace: "Chrome, and" }] },
      { path: "content/posts/new.md", create: "---\ntitle: New\ndraft: true\n---\n" },
      { path: "notes/rag.md", create: "---\ntitle: RAG\n---\n" },
    ]);
    expect(problems).toHaveLength(6);
    expect(problems[0]).toContain("not found");
    expect(problems[1]).toContain("listed twice");
    expect(problems[2]).toContain("already exists");
    expect(problems[3]).toContain("new files must be .md");
    expect(problems[4]).toContain(". or ..");
    expect(problems[5]).toContain("no such post");
  });
});

describe("site agent", () => {
  it("lists, reads and proposes multi-file changes, projected per file", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const registry = createRegistry();
    registry.install(createSiteExtension(host));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
    const root = await harness.root(ctx, { agent: { model: { provider: model.provider, modelId: model.id } } });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("list_terms", { key: "tags" }), fauxToolCall("read_post", { path: "content/posts/b.md" })], { stopReason: "toolUse" }),
      fauxAssistantMessage(
        [
          fauxText("Merging ai into AI."),
          fauxToolCall("propose_changes", {
            changes: [
              { path: "content/posts/b.md", reason: "tag casing", edits: [{ find: "tags: [ai]", replace: "tags: [AI]" }] },
              { path: "notes/tags.md", create: "---\ntitle: Tag style\n---\n" },
            ],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Done.")]),
    ]);
    const submission = await root.submit({ type: "input", content: "Tidy tags" }, ctx);
    expect((await submission.wait(ctx)).status).toBe("done");

    const view = await root.viewState(ctx);
    const projected = projectView(view.value as never);
    const tools = projected.items.filter((i) => i.kind === "tool");
    expect(tools.map((t) => t.name)).toEqual(["list_terms", "read_post", "propose_changes"]);
    expect(tools[0].summary).toBe("3 distinct value(s) of tags:");
    const propose = tools[2] as Extract<(typeof projected.items)[number], { kind: "tool" }>;
    expect(propose.changes).toEqual([
      { path: "content/posts/b.md", reason: "tag casing", edits: [{ find: "tags: [ai]", replace: "tags: [AI]" }] },
      { path: "notes/tags.md", create: "---\ntitle: Tag style\n---\n" },
    ]);
    expect(propose.summary).toBe("1 edit(s) in 1 file(s) and 1 new file(s) sent to the author for review.");

    const system = (view.value as unknown as { entries: { kind: string; model?: { sections?: Record<string, string> }[] }[] }).entries.find((e) => e.kind === "pi.system");
    expect(system?.model?.[0].sections?.site).toContain("Say 'web platform'");
    await harness.close(ctx);
  });
});
