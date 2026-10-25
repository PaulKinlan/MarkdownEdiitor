import { describe, expect, it } from "vitest";
import { BUILTIN_ACTIONS, SITE_ACTIONS, parseQuickEdit } from "../src/lib/actions";
import { BUILTIN_SKILLS } from "../src/shared/builtin-skills";

// Built-in skills and quick edits are one file each (src/skills, src/quick-edits),
// listed by folder rather than by a hand-kept array.
describe("registries", () => {
  it("lists built-in skills in their `order`", () => {
    expect(BUILTIN_SKILLS.map((s) => s.name)).toEqual([
      "fact-check",
      "internal-links",
      "demo-builder",
      "seo-social",
      "critique",
      "chrome-api-check",
      "data-check",
      "alt-text",
      "code-check",
      "headline-hook",
      "update-notes",
      "quote-check",
      "newsletter",
      "image-prompts",
    ]);
    for (const s of BUILTIN_SKILLS) expect(s.title && s.description && s.instructions).toBeTruthy();
  });

  it("lists quick edits by scope, in their `order`", () => {
    expect(BUILTIN_ACTIONS.map((a) => a.id)).toEqual(["proofread", "tighten", "rules", "title", "links", "summary"]);
    expect(SITE_ACTIONS.map((a) => a.id)).toEqual([
      "site-research",
      "site-ideas",
      "site-draft",
      "site-tags",
      "site-related",
      "site-links",
      "site-metadata",
      "site-series",
      "site-rules",
    ]);
    for (const a of SITE_ACTIONS) expect(a.scope).toBe("site");
    for (const a of BUILTIN_ACTIONS) expect(a.scope).toBeUndefined();
  });

  it("parses a quick edit file", () => {
    expect(parseQuickEdit("x", "---\nname: Shorten\norder: 5\n---\n\nCut it.\n")).toEqual({ id: "x", name: "Shorten", prompt: "Cut it.", order: 5 });
    expect(() => parseQuickEdit("y", "---\norder: 1\n---\nNo name")).toThrow(/needs a name/);
  });
});
