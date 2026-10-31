import { afterEach, describe, expect, it, vi } from "vitest";
import { addOptIn, makeShortcodeSelfSizing, OPT_IN } from "../src/modules/demo-sizing/sizing";
import { listPosts, samePosts, type PostSummary } from "../src/lib/posts";
import { postCard } from "../src/lib/post-card";
import { scopedTransition } from "../src/lib/transitions";
import type { HugoConfig } from "../src/lib/hugo";

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.matchMedia;
});

describe("self-sizing demos", () => {
  it("adds the opt-in after the charset meta", () => {
    const out = addOptIn(`<!doctype html><html><head><meta charset="utf-8"><title>x</title></head></html>`)!;
    expect(out).toContain(`<meta charset="utf-8">\n    ${OPT_IN}<title>`);
    expect(addOptIn(out)).toBeUndefined();
  });

  it("falls back to just after <head>, and skips pages without one", () => {
    expect(addOptIn(`<html><head lang="en"><title>x</title></head></html>`)).toContain(`<head lang="en">\n    ${OPT_IN}`);
    expect(addOptIn(`<p>fragment</p>`)).toBeUndefined();
  });

  const shortcode = `{{ $src := .Get 0 }}{{ $height := .Get 1 | default "400" }}\n<iframe src="{{ $src }}" style="height: {{ $height }}px" loading="lazy"></iframe>\n`;

  const updated = (template: string) => {
    const change = makeShortcodeSelfSizing(template);
    if (change.kind !== "updated") throw new Error(`expected an update, got ${change.kind}`);
    return change.text;
  };

  it("teaches the iframe shortcode to size opted-in local demos", () => {
    const out = updated(shortcode);
    expect(out.indexOf("$sizingSrc := $src")).toBeGreaterThan(out.indexOf("$src :="));
    expect(out).toContain(`<iframe{{ if $selfSizing }} class="self-sizing"{{ end }} src="{{ $src }}"`);
    // Overrides the inline style height when supported, and keeps it as the fallback.
    expect(out).toContain("height: auto !important; frame-sizing: content-height");
    expect(out).toContain(`style="height: {{ $height }}px"`);
    expect(makeShortcodeSelfSizing(out)).toEqual({ kind: "already" });
  });

  it("keeps everything in the iframe's scope", () => {
    const out = updated(`{{ $src := .Get 0 }}{{ if $src }}<iframe src="{{ $src }}"></iframe>{{ end }}`);
    const ifAt = out.indexOf("{{ if $src }}");
    expect(out.indexOf("$selfSizing :=")).toBeGreaterThan(ifAt);
    expect(out.lastIndexOf("$selfSizing")).toBeLessThan(out.indexOf("</iframe>{{ end }}"));
    expect(out.endsWith("</iframe>{{ end }}")).toBe(true);
  });

  it("handles a src that reads a shortcode argument directly", () => {
    const out = updated(`<iframe src="{{ .Get 0 }}" height="{{ .Get 1 }}"></iframe>\n`);
    expect(out).toContain("{{- $sizingSrc := .Get 0 -}}");
    expect(updated(`<iframe src="{{ .Get "src" }}"></iframe>`)).toContain(`$sizingSrc := .Get "src"`);
  });

  it("says why it can't edit a shortcode", () => {
    expect(makeShortcodeSelfSizing(`<div>{{ .Inner }}</div>`)).toMatchObject({ kind: "unsupported" });
    expect(makeShortcodeSelfSizing(`<iframe class="demo" src="{{ $src }}"></iframe>`)).toMatchObject({ kind: "unsupported" });
    expect(makeShortcodeSelfSizing(`<iframe src="{{ .Site.Params.demo }}"></iframe>`)).toMatchObject({ kind: "unsupported" });
  });
});

describe("post list refresh", () => {
  const config = { contentDir: "content", permalinks: {} } as unknown as HugoConfig;
  function folder(files: Record<string, { text: string; lastModified: number }>, reads: string[]) {
    const file = (name: string) => ({
      kind: "file",
      name,
      getFile: async () => ({ lastModified: files[`content/${name}`].lastModified, text: async () => (reads.push(name), files[`content/${name}`].text) }),
    });
    const content = {
      kind: "directory",
      name: "content",
      async *values() {
        for (const path of Object.keys(files)) yield file(path.slice(8));
      },
    };
    return { kind: "directory", name: "site", getDirectoryHandle: async (n: string) => (n === "content" ? content : Promise.reject(new DOMException("", "NotFoundError"))) } as unknown as FileSystemDirectoryHandle;
  }

  it("only re-reads files whose modification time changed", async () => {
    const files = { "content/a.md": { text: "---\ntitle: A\n---\n", lastModified: 1 }, "content/b.md": { text: "---\ntitle: B\n---\n", lastModified: 1 } };
    const reads: string[] = [];
    const first = await listPosts(folder(files, reads), config);
    expect(reads.sort()).toEqual(["a.md", "b.md"]);
    reads.length = 0;
    const again = await listPosts(folder(files, reads), config, first);
    expect(reads).toEqual([]);
    expect(samePosts(first, again)).toBe(true);
    files["content/b.md"] = { text: "---\ntitle: B2\n---\n", lastModified: 2 };
    const changed = await listPosts(folder(files, reads), config, again);
    expect(reads).toEqual(["b.md"]);
    expect(samePosts(again, changed)).toBe(false);
    expect(changed.map((p) => p.title).sort()).toEqual(["A", "B2"]);
  });

  it("samePosts notices additions and removals", () => {
    const a = { path: "a" } as PostSummary;
    const b = { path: "b" } as PostSummary;
    expect(samePosts([a, b], [b, a])).toBe(true);
    expect(samePosts([a], [a, b])).toBe(false);
    expect(samePosts([a, b], [a, { ...b }])).toBe(false);
  });
});

describe("hover cards", () => {
  const base = { path: "content/posts/a.md", contentPath: "posts/a.md", section: "posts", title: "A", draft: false, format: "yaml", url: "/a/", lastModified: 0 } as const;

  it("shows the summary, tags and where the post lives", () => {
    const card = postCard({ ...base, frontMatter: { summary: "  A post\n about   things. ", tags: ["ai", "web", "ai"], categories: ["notes"] } });
    expect(card).toMatchObject({ title: "A", where: "posts · /a/", excerpt: "A post about things.", tags: ["ai", "web", "notes"] });
    expect(card.status).toBeUndefined();
  });

  it("uses the note status, or draft, and clips long summaries at a word", () => {
    expect(postCard({ ...base, frontMatter: { status: "researching" } }).status).toBe("researching");
    const card = postCard({ ...base, draft: true, frontMatter: { description: "word ".repeat(100) } });
    expect(card.status).toBe("draft");
    expect(card.excerpt!.length).toBeLessThanOrEqual(241);
    expect(card.excerpt).toMatch(/word…$/);
  });
});

describe("scoped view transitions", () => {
  it("runs the update directly when the element can't transition", async () => {
    g.matchMedia = () => ({ matches: false });
    const update = vi.fn();
    await scopedTransition({} as Element, update);
    await scopedTransition(null, update);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("transitions the element, unless the user prefers reduced motion", async () => {
    const update = vi.fn();
    const startViewTransition = vi.fn((cb: () => Promise<void>) => ({ updateCallbackDone: cb() }));
    g.matchMedia = () => ({ matches: false });
    await scopedTransition({ startViewTransition } as unknown as Element, update);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    g.matchMedia = () => ({ matches: true });
    await scopedTransition({ startViewTransition } as unknown as Element, update);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
