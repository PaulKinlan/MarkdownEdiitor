import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { fetchSkillsFromGitHub, parseGitHubSource, refreshSkill } from "../src/lib/skill-install";
import { BUILTIN_SKILLS } from "../src/shared/builtin-skills";
import { isSkillTextFile, toSkillName } from "../src/shared/skills";
import { createSkillsExtension } from "../worker/agent/skills";

describe("parseGitHubSource", () => {
  it("reads the forms people paste", () => {
    expect(parseGitHubSource("vstaln/noslop")).toEqual({ owner: "vstaln", repo: "noslop", ref: "HEAD", path: "" });
    expect(parseGitHubSource("https://github.com/vstaln/noslop.git")).toEqual({ owner: "vstaln", repo: "noslop", ref: "HEAD", path: "" });
    expect(parseGitHubSource("github.com/vstaln/noslop/tree/main/skills/noslop/")).toEqual({ owner: "vstaln", repo: "noslop", ref: "main", path: "skills/noslop" });
    expect(parseGitHubSource("https://github.com/a/b/blob/v2/skills/x/SKILL.md")).toEqual({ owner: "a", repo: "b", ref: "v2", path: "skills/x" });
    expect(parseGitHubSource("https://gitlab.com/a/b")).toBeUndefined();
    expect(parseGitHubSource("not a repo")).toBeUndefined();
  });
});

const REPO: Record<string, string> = {
  "README.md": "# repo",
  "skills/noslop/SKILL.md": "---\nname: noslop\ndescription: Write prose without AI tells.\nallowed-tools: Read\n---\n\nLoad style-and-bans.md first.\n",
  "skills/noslop/style-and-bans.md": "Never write 'delve'.",
  "skills/noslop/construction.md": "Structure.",
  "skills/noslop/logo.png": "binary",
  "skills/noslop/nested/SKILL.md": "---\nname: Nested_Skill\ndescription: A nested one.\n---\nNested body.",
  "skills/noslop/nested/notes.txt": "nested notes",
  "src/noslop/cli.py": "print()",
};

function fakeGitHub(repo: Record<string, string>) {
  const calls: string[] = [];
  const dirs = new Set(["", ...Object.keys(repo).flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/")))]);
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const api = url.match(/^https:\/\/api\.github\.com\/repos\/vstaln\/noslop\/(.*)$/)?.[1];
    if (api?.startsWith("commits/")) return Response.json({ commit: { tree: { sha: "dir:" } } });
    if (api?.startsWith("contents/") || api?.startsWith("contents?")) {
      const parent = decodeURIComponent(api.slice("contents/".length).split("?")[0]);
      const prefix = parent ? `${parent}/` : "";
      const children = [...dirs].filter((d) => d.startsWith(prefix) && d !== parent && !d.slice(prefix.length).includes("/"));
      return Response.json(children.map((d) => ({ name: d.slice(prefix.length), type: "dir", sha: `dir:${d}` })));
    }
    if (api?.startsWith("git/trees/")) {
      const dir = decodeURIComponent(api.slice("git/trees/".length).split("?")[0]).slice(4);
      const prefix = dir ? `${dir}/` : "";
      return Response.json({
        tree: Object.entries(repo)
          .filter(([path]) => path.startsWith(prefix))
          .map(([path, text]) => ({ path: path.slice(prefix.length), type: "blob", size: text.length })),
        truncated: false,
      });
    }
    const raw = url.match(/^https:\/\/raw\.githubusercontent\.com\/vstaln\/noslop\/[^/]+\/(.+)$/);
    if (raw && decodeURIComponent(raw[1]) in repo) return new Response(repo[decodeURIComponent(raw[1])]);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe("installing from GitHub", () => {
  it("finds every SKILL.md and downloads each skill's text files", async () => {
    const { fetcher, calls } = fakeGitHub(REPO);
    const { skills } = await fetchSkillsFromGitHub("vstaln/noslop", fetcher);
    expect(skills.map((s) => s.skill.name).sort()).toEqual(["nested-skill", "noslop"]);
    const noslop = skills.find((s) => s.skill.name === "noslop")!;
    expect(noslop.skill.files).toEqual({ "construction.md": "Structure.", "style-and-bans.md": "Never write 'delve'." });
    expect(noslop.skill.origin).toEqual({ owner: "vstaln", repo: "noslop", ref: "HEAD", path: "skills/noslop" });
    expect(noslop.markdown).toContain("allowed-tools: Read");
    expect(skills.find((s) => s.skill.name === "nested-skill")!.skill.files).toEqual({ "notes.txt": "nested notes" });
    // Two API calls to list the tree; everything else from raw downloads.
    expect(calls.filter((c) => c.includes("api.github.com"))).toHaveLength(2);
    expect(calls.some((c) => c.endsWith("logo.png") || c.endsWith("cli.py"))).toBe(false);
  });

  it("installs just one folder when linked to it, and refreshes from its origin", async () => {
    const { fetcher } = fakeGitHub(REPO);
    const { skills } = await fetchSkillsFromGitHub("https://github.com/vstaln/noslop/tree/main/skills/noslop/nested", fetcher);
    expect(skills.map((s) => s.skill.name)).toEqual(["nested-skill"]);
    const changed = fakeGitHub({ ...REPO, "skills/noslop/nested/notes.txt": "new notes" });
    const fresh = await refreshSkill(skills[0].skill, changed.fetcher);
    expect(fresh.skill.files).toEqual({ "notes.txt": "new notes" });
  });

  it("explains a repo without skills", async () => {
    const { fetcher } = fakeGitHub({ "README.md": "hi" });
    await expect(fetchSkillsFromGitHub("vstaln/noslop", fetcher)).rejects.toThrow(/No SKILL.md/);
  });

  it("keeps only small text files", () => {
    expect(isSkillTextFile("refs/style.md", 1000)).toBe(true);
    expect(isSkillTextFile("logo.png", 10)).toBe(false);
    expect(isSkillTextFile(".hidden.md", 10)).toBe(false);
    expect(isSkillTextFile("big.md", 10_000_000)).toBe(false);
    expect(toSkillName(" No_Slop Writer ")).toBe("no-slop-writer");
  });
});

describe("load_skill with supporting files", () => {
  it("lists a skill's files and loads one", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const registry = createRegistry();
    const skill = { name: "noslop", description: "d", instructions: "Read style-and-bans.md.", files: { "style-and-bans.md": "Never write 'delve'." } };
    registry.install(createSkillsExtension("post", () => [skill]));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
    const root = await harness.root(ctx, { agent: { model: { provider: model.provider, modelId: model.id } } });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("load_skill", { name: "noslop" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("load_skill", { name: "noslop", file: "./style-and-bans.md" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("ok")]),
    ]);
    const submission = await root.submit({ type: "input", content: "go" }, ctx);
    expect((await submission.wait(ctx)).status).toBe("done");
    const view = (await root.viewState(ctx)).value as unknown as { entries: { kind: string; model?: { content?: string | { type: string; text?: string }[] }[] }[] };
    const results = view.entries
      .filter((e) => e.kind === "pi.tool-result")
      .map((e) => { const c = e.model?.[0]?.content; return typeof c === "string" ? c : (c?.map((b) => b.text).join("") ?? ""); });
    expect(results[0]).toContain("Supporting files for this skill");
    expect(results[0]).toContain("style-and-bans.md");
    expect(results[1]).toBe("Never write 'delve'.");
    await harness.close(ctx);
  });

  it("ships fourteen built-in skills", () => {
    expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual(
      expect.arrayContaining(["alt-text", "code-check", "headline-hook", "update-notes", "quote-check", "newsletter", "image-prompts"]),
    );
    expect(BUILTIN_SKILLS).toHaveLength(14);
  });
});

describe("review fixes", () => {
  it("finds a branch with a slash in a /tree/ link", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      calls.push(url);
      if (url.includes("/contents/skills?ref=feature/new-skill")) return Response.json([{ name: "x", type: "dir", sha: "abc" }]);
      if (url.includes("/contents/")) return new Response("{}", { status: 404 });
      if (url.includes("/git/trees/abc")) return Response.json({ tree: [{ path: "SKILL.md", type: "blob", size: 40 }] });
      if (url.includes("raw.githubusercontent.com/a/b/feature/new-skill/skills/x/SKILL.md")) return new Response("---\nname: x\ndescription: d\n---\nbody");
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const { skills } = await fetchSkillsFromGitHub("https://github.com/a/b/tree/feature/new-skill/skills/x", fetcher);
    expect(skills[0].skill.origin).toEqual({ owner: "a", repo: "b", ref: "feature/new-skill", path: "skills/x" });
  });

  it("counts the size budget in UTF-8 bytes", async () => {
    const big = "漢".repeat(60_000); // 180 KB in UTF-8, but 60K characters
    const repo = { "SKILL.md": "---\nname: cjk\ndescription: d\n---\nbody", "a.md": big, "b.md": big, "c.md": big, "d.md": big, "e.md": big, "f.md": big };
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/commits/")) return Response.json({ commit: { tree: { sha: "root" } } });
      if (url.includes("/git/trees/root")) {
        return Response.json({ tree: Object.entries(repo).map(([path, t]) => ({ path, type: "blob", size: new TextEncoder().encode(t).length })) });
      }
      const path = url.split("/").pop()!;
      return new Response(repo[path as keyof typeof repo]);
    }) as typeof fetch;
    const { skills } = await fetchSkillsFromGitHub("a/cjk", fetcher);
    expect(Object.keys(skills[0].skill.files ?? {})).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
  });
});
