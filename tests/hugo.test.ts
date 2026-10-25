import { describe, expect, it } from "vitest";
import { normaliseConfig, parseConfig, permalinkFor } from "../src/lib/hugo";
import { slugify } from "../src/lib/slug";
import { newPostFromTemplate, summarise } from "../src/lib/posts";
import { Post } from "../src/lib/frontmatter";

const aifocus = normaliseConfig(
  "hugo.toml",
  parseConfig("hugo.toml", `baseURL = 'https://aifoc.us/'\ntitle = 'AI Focus'\ntheme = 'aifocustheme'\n[permalinks.page]\n    posts = '/:slug/'\n    tutorials = '/training/:slug/'\n`),
);
const kinlan = normaliseConfig("config.toml", parseConfig("config.toml", `baseurl = "https://paul.kinlan.me/"\n[permalinks]\npost = "/:title/"\n`));

describe("permalinkFor", () => {
  it("uses per-kind page permalinks (aifoc.us)", () => {
    expect(aifocus.permalinks.posts).toBe("/:slug/");
    expect(permalinkFor("posts/token.md", { slug: "the-token-salary" }, aifocus)).toBe("/the-token-salary/");
    expect(permalinkFor("tutorials/x.md", { title: "Intro to MCP" }, aifocus)).toBe("/training/intro-to-mcp/");
  });

  it("falls back to slug or file name for root content (paul.kinlan.me)", () => {
    expect(permalinkFor("2004-08-28-first-post.markdown", {}, kinlan)).toBe("/2004-08-28-first-post/");
    expect(permalinkFor("2026-08-01-cool.markdown", { slug: "cool-uris" }, kinlan)).toBe("/cool-uris/");
    expect(permalinkFor("projects/wordfinder.app.markdown", { slug: "wordhelper.app" }, kinlan)).toBe("/projects/wordhelper.app");
  });

  it("handles bundles, sections, dates and url overrides", () => {
    expect(permalinkFor("posts/hello/index.md", {}, {permalinks: {}})).toBe("/posts/hello/");
    expect(permalinkFor("posts/_index.md", {}, aifocus)).toBe("/posts/");
    expect(permalinkFor("blog/a.md", { date: "2024-02-03T00:00:00Z" }, { permalinks: { blog: "/:year/:month/:filename/" } })).toBe("/2024/02/a/");
    expect(permalinkFor("posts/a.md", { url: "/custom" }, aifocus)).toBe("/custom/");
  });
});

describe("slugify", () => {
  it("matches Hugo urlize for typical titles", () => {
    expect(slugify("Cool URIs don't change, hosting does")).toBe("cool-uris-dont-change-hosting-does");
    expect(slugify("Café & Crème")).toBe("cafe-creme");
  });
});

describe("newPostFromTemplate", () => {
  it("copies the shape of the latest post in the section", () => {
    const latest = summarise(
      "content/posts/the-token-salary.md",
      aifocus,
      Post.parse(`---\ntitle: t\nseotitle: s\ndate: 2026-03-27T20:00:00.000Z\nslug: t\ndraft: false\nauthors:\n  - paulkinlan\n---\nx`),
      0,
    );
    const now = new Date("2026-10-25T10:00:00Z");
    const { path, post } = newPostFromTemplate([latest], aifocus, "posts", "Agents need editors", now);
    expect(path).toBe("content/posts/agents-need-editors.md");
    expect(post.toString()).toBe(
      `---\ntitle: Agents need editors\nseotitle: ""\ndate: 2026-10-25T10:00:00.000Z\nslug: agents-need-editors\ndraft: true\nauthors:\n  - paulkinlan\n---\n\n`,
    );
  });
});

import { applyEdit, diffWords } from "../src/lib/diff";

describe("edits", () => {
  it("diffs by word", () => {
    expect(diffWords("a very good post", "a good post")).toEqual([
      { type: "same", text: "a " },
      { type: "del", text: "very " },
      { type: "same", text: "good post" },
    ]);
  });
  it("applies only unique matches", () => {
    expect(applyEdit("one two one", "two", "2")).toBe("one 2 one");
    expect(applyEdit("one two one", "one", "1")).toBeUndefined();
    expect(applyEdit("one", "three", "3")).toBeUndefined();
  });
});
