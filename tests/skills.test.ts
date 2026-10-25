import { describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT as ctx } from "@earendil-works/chord/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { BUILTIN_SKILLS } from "../src/shared/builtin-skills";
import { inlineSkill, mergeSkills, parseSkillMarkdown, skillPrompt, skillsFor, type Skill } from "../src/shared/skills";
import { createSkillsExtension } from "../worker/agent/skills";
import { browserSupport, calculate, describeTable, parseCellNumber, parseTable } from "../worker/agent/research";
import { analyzePost } from "../worker/agent/post-stats";
import { projectView } from "../worker/agent/view";

describe("skill files", () => {
  it("parses SKILL.md front matter and body", () => {
    const skill = parseSkillMarkdown("---\nname: Alt-Text\ndescription: Write alt text for images.\nscope: both\n---\n\n# Alt text\n\nDescribe each image.\n", "site");
    expect(skill).toEqual({ name: "alt-text", description: "Write alt text for images.", instructions: "# Alt text\n\nDescribe each image.", scope: "both", source: "site" });
  });

  it("falls back to the folder name and rejects incomplete files", () => {
    expect(parseSkillMarkdown("---\ndescription: d\n---\nbody", "site", "my-skill")?.name).toBe("my-skill");
    expect(parseSkillMarkdown("---\nname: x\n---\nbody")).toBeUndefined();
    expect(parseSkillMarkdown("---\nname: x\ndescription: d\n---\n")).toBeUndefined();
    expect(parseSkillMarkdown("---\nname: Not Valid!\ndescription: d\n---\nbody")?.name).toBe("not-valid");
    expect(parseSkillMarkdown("---\nname: \"!!!\"\ndescription: d\n---\nbody")).toBeUndefined();
    expect(parseSkillMarkdown("---\nname: [unclosed\n---\nbody")).toBeUndefined();
  });

  it("merges by name, later wins, and filters by scope", () => {
    const site: Skill = { name: "fact-check", description: "mine", instructions: "my way", source: "site" };
    const siteWide: Skill = { name: "audit", description: "d", instructions: "i", scope: "site" };
    const merged = mergeSkills(BUILTIN_SKILLS, [site, siteWide]);
    expect(merged.filter((s) => s.name === "fact-check")).toEqual([site]);
    expect(skillsFor(merged, "post").some((s) => s.name === "audit")).toBe(false);
    expect(skillsFor(merged, "site").map((s) => s.name)).toEqual(["audit"]);
  });

  it("built-in skills are well formed and unique", () => {
    const names = BUILTIN_SKILLS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["fact-check", "internal-links", "demo-builder", "seo-social", "critique", "chrome-api-check", "data-check"]));
    for (const s of BUILTIN_SKILLS) expect(s.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("inlines a skill's instructions for models without tools", () => {
    const skill = BUILTIN_SKILLS[0];
    expect(inlineSkill(skillPrompt(skill), BUILTIN_SKILLS)).toContain(skill.instructions);
    expect(inlineSkill("Fix my intro", BUILTIN_SKILLS)).toBe("Fix my intro");
    const withFiles = { name: "noslop", description: "d", instructions: "Read bans.md.", files: { "bans.md": "No delve.", "long.md": "x".repeat(500) } };
    const inlined = inlineSkill("Use the noslop skill on this post.", [withFiles], 200);
    expect(inlined).toContain('<file path="bans.md">\nNo delve.');
    expect(inlined).toContain("Files left out to fit: long.md");
  });
});

describe("skills extension", () => {
  it("lists skills in the system prompt and loads one on request", async () => {
    const faux = fauxProvider();
    const models = createModels();
    models.setProvider(faux.provider);
    const model = faux.getModel();
    const extra: Skill[] = [{ name: "house-style", description: "Apply the house style.", instructions: "Use British spelling.", source: "site" }];
    const registry = createRegistry();
    registry.install(createSkillsExtension("post", () => extra));
    const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);
    const root = await harness.root(ctx, { agent: { model: { provider: model.provider, modelId: model.id } } });

    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("load_skill", { name: "house-style" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("load_skill", { name: "nope" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done.")]),
    ]);
    const submission = await root.submit({ type: "input", content: "Use the house-style skill on this post." }, ctx);
    expect((await submission.wait(ctx)).status).toBe("done");

    const view = await root.viewState(ctx);
    const items = projectView(view.value as never).items.filter((i) => i.kind === "tool");
    expect(items.map((i) => i.kind === "tool" && i.status)).toEqual(["done", "error"]);
    const system = (view.value as unknown as { entries: { kind: string; model?: { sections?: Record<string, string> }[] }[] }).entries.find((e) => e.kind === "pi.system");
    const catalog = system?.model?.[0].sections?.skills ?? "";
    expect(catalog).toContain("- house-style: Apply the house style.");
    expect(catalog).toContain("- fact-check:");
    await harness.close(ctx);
  });
});

describe("calculate", () => {
  it("evaluates arithmetic with precedence and functions", () => {
    expect(calculate("(132 - 98) / 98 * 100")).toBeCloseTo(34.6939, 3);
    expect(calculate("-2^2")).toBe(-4);
    expect(calculate("2^3^2")).toBe(512);
    expect(calculate("2 ** -1")).toBe(0.5);
    expect(calculate("round(sqrt(2), 3) + max(1, 4, 2)")).toBe(5.414);
    expect(calculate("1,234,567 × 2")).toBe(2469134);
    expect(calculate("1e3 % 7")).toBe(6);
  });

  it("rejects anything that isn't arithmetic", () => {
    expect(() => calculate("alert(1)")).toThrow(/unknown name/);
    expect(() => calculate("1 +")).toThrow();
    expect(() => calculate("1 / 0")).toThrow(/division/);
    expect(() => calculate("(1 + 2")).toThrow(/expected/);
  });
});

describe("table_stats", () => {
  it("reads markdown tables and numbers in common formats", () => {
    const table = parseTable("Intro text\n\n| Browser | Share |\n|---|--:|\n| Chrome | 65% |\n| Safari | 20% |\n| Firefox | 3% |\n");
    expect(table?.header).toEqual(["Browser", "Share"]);
    expect(table?.rows).toHaveLength(3);
    const text = describeTable(table!);
    expect(text).toContain("sum 88");
    expect(text).toContain("(values are percentages)");
    expect(text).toContain("Chrome 73.9%");
  });

  it("reads CSV with quotes", () => {
    const table = parseTable('name,"cost, $"\n"Widget, large","$1,200.50"\nGadget,(300)\n');
    expect(table?.rows[0]).toEqual(["Widget, large", "$1,200.50"]);
    expect(describeTable(table!)).toContain("sum 900.5");
  });

  it("parses cells", () => {
    expect(parseCellNumber("1,234")).toBe(1234);
    expect(parseCellNumber("−4 ms")).toBe(-4);
    expect(parseCellNumber("**12.5%**")).toBe(12.5);
    expect(parseCellNumber("n/a")).toBeUndefined();
    expect(parseCellNumber("Chrome 120")).toBeUndefined();
  });
});

describe("analyze_post", () => {
  it("reports length, outline, links, images and front matter", () => {
    const text = [
      "---",
      "title: A post about things",
      "description: Short.",
      "---",
      "",
      "# Heading",
      "",
      "First paragraph with a [link](https://example.com) and [here](/old/).",
      "",
      "### Skipped level",
      "",
      "![](/img/a.png) and <img src=\"/b.png\" alt=\"B\">",
      "",
      "```js",
      "const notCounted = words.in.code;",
      "```",
    ].join("\n");
    const report = analyzePost(text);
    expect(report).toContain("Front matter (yaml): title, description");
    expect(report).toContain("title: 19 characters");
    expect(report).toMatch(/\s6\| # Heading/);
    expect(report).toContain("jumps from h1 to h3");
    expect(report).toContain("Links: 2 (1 external, 1 internal or relative)");
    expect(report).toContain('line 8 "here" → /old/');
    expect(report).toContain("Images without alt text: line 12 /img/a.png");
    expect(report).not.toContain("notCounted");
  });
});

describe("browser_support", () => {
  it("combines Chrome Status and webstatus.dev, and survives a failing source", async () => {
    const calls: string[] = [];
    const fake = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("https://chromestatus.com/")) {
        return new Response(
          ")]}'\n" +
            JSON.stringify({
              features: [
                {
                  id: 1,
                  name: "View Transitions",
                  web_feature: "view-transitions",
                  browsers: { chrome: { status: { text: "Enabled by default" }, desktop: 111, android: 111 }, ff: { view: { text: "Positive" } }, safari: { view: { text: "Shipped" } } },
                },
              ],
            }),
        );
      }
      if (url.includes("/v1/features/view-transitions")) {
        return Response.json({ feature_id: "view-transitions", name: "View transitions", baseline: { status: "newly", low_date: "2025-10-14" } });
      }
      return new Response("nope", { status: 503 });
    }) as typeof fetch;
    const text = await browserSupport("View Transitions", fake);
    expect(text).toContain("Chrome: Enabled by default, shipped in desktop 111, Android 111");
    expect(text).toContain("Safari: Shipped");
    expect(text).toContain("webstatus.dev lookup failed: status 503");
    expect(text).toContain("Baseline newly available since 2025-10-14");
    expect(calls.some((c) => c.includes("api.webstatus.dev/v1/features?q="))).toBe(true);
  });
});
