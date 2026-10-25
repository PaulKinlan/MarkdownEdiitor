import { describe, expect, it } from "vitest";
import { Post } from "../src/lib/frontmatter";

const aifocus = `---
title: the token salary
seotitle: "Paying for AI agents in tokens instead of salaries"
date: 2026-03-27T20:00:00.000Z
slug: the-token-salary
draft: false
authors:
  - paulkinlan
---

Two conversations have been rattling around in my head.
`;

describe("Post", () => {
  it("round-trips YAML front matter byte for byte", () => {
    expect(Post.parse(aifocus).toString()).toBe(aifocus);
  });

  it("keeps dates as written and quoting of untouched fields", () => {
    const post = Post.parse(aifocus);
    expect(post.get("date")).toBe("2026-03-27T20:00:00.000Z");
    post.set("title", "the token salary, revisited");
    const out = post.toString();
    expect(out).toContain('seotitle: "Paying for AI agents in tokens instead of salaries"');
    expect(out).toContain("title: the token salary, revisited\n");
    expect(out.endsWith("Two conversations have been rattling around in my head.\n")).toBe(true);
  });

  it("rewrites only the edited key", () => {
    const src = `---\ntitle: >\n  folded title\nsummary: a long line that a different YAML library folded\n  onto two lines\n# a comment\ntags:\n- a\n- b\ndraft: true\n---\nBody\n`;
    const post = Post.parse(src);
    post.set("draft", false);
    expect(post.toString()).toBe(src.replace("draft: true", "draft: false"));
    post.set("title", "new title");
    expect(post.toString()).toContain("---\ntitle: new title\nsummary: a long line");
    post.set("tags", ["a", "b", "c"]);
    expect(post.get("tags")).toEqual(["a", "b", "c"]);
    expect(post.toString()).toContain("# a comment\ntags:\n- a\n- b\n- c\ndraft: false\n---\nBody\n");
    post.set("summary", undefined);
    expect(post.toString()).toBe("---\ntitle: new title\n# a comment\ntags:\n- a\n- b\n- c\ndraft: false\n---\nBody\n");
  });

  it("parses TOML front matter", () => {
    const post = Post.parse(`+++\ntitle = 'Hello'\ndraft = true\n+++\nBody\n`);
    expect(post.format).toBe("toml");
    expect(post.get("title")).toBe("Hello");
    post.set("draft", false);
    expect(post.toString()).toBe(`+++\ntitle = "Hello"\ndraft = false\n+++\nBody\n`);
  });

  it("treats files without front matter as body only", () => {
    const post = Post.parse("Just text");
    expect(post.format).toBe("none");
    post.set("title", "Now titled");
    expect(post.toString()).toBe("---\ntitle: Now titled\n---\nJust text");
  });

  it("edits raw front matter and rejects invalid YAML", () => {
    const post = Post.parse(aifocus);
    expect(() => post.setRawFrontMatter("title: [unclosed")).toThrow();
    post.setRawFrontMatter("title: new\ndraft: true");
    expect(post.get("draft")).toBe(true);
  });

  it("handles empty front matter blocks", () => {
    for (const src of ["---\n---\nBody\n", "+++\n+++\nBody\n", "---\n\n---\nBody\n"]) {
      const post = Post.parse(src);
      expect(post.format).not.toBe("none");
      expect(post.toString()).toBe(src);
      expect(post.body).toBe("Body\n");
    }
    const post = Post.parse("---\n---\nBody\n");
    post.set("title", "t");
    expect(post.toString()).toBe("---\ntitle: t\n---\nBody\n");
  });

  it("keeps JSON front matter separators exactly", () => {
    expect(Post.parse('{"title": "a"}Body').body).toBe("Body");
    expect(Post.parse('{"title": "a"}').toString()).toBe('{"title": "a"}');
    expect(Post.parse('{"title": "a"}\nBody').toString()).toBe('{"title": "a"}\nBody');
  });

  it("treats a body that starts with a shortcode as body only", () => {
    const text = '{{< figure src="/a.png" >}}\n\nText';
    const post = Post.parse(text);
    expect(post.format).toBe("none");
    expect(post.toString()).toBe(text);
  });

  it("rejects front matter that is not an object, leaving the post unchanged", () => {
    const post = Post.parse('{"title": "a"}\nBody');
    expect(() => post.setRawFrontMatter("null")).toThrow();
    expect(() => post.setRawFrontMatter("[1]")).toThrow();
    expect(post.get("title")).toBe("a");
    const yaml = Post.parse("---\nauthors: &people [alice]\nreviewers: *people\n---\n");
    expect(() => yaml.set("authors", ["bob"])).toThrow();
    expect(yaml.get("authors")).toEqual(["alice"]);
    expect(yaml.toString()).toBe("---\nauthors: &people [alice]\nreviewers: *people\n---\n");
  });
});
