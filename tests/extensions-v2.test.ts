import { describe, expect, it } from "vitest";
import { ExtensionHost, type HostBridge, type WorkerLike } from "../src/extensions/host";
import { startRuntime } from "../src/extensions/runtime";
import { parseExtension } from "../src/extensions/loader";
import { changedLines, sitePath } from "../src/extensions/controller";
import type { Port } from "../src/extensions/messages";
import type { PostSnapshot } from "../src/extensions/types";

// The second round of the extension API: site writes, front matter, save
// hooks, site events and settings. (tests/extensions.test.ts covers the rest.)

function fakeWorker(): WorkerLike {
  const { port1, port2 } = new MessageChannel();
  port1.start();
  port2.start();
  startRuntime(port2 as unknown as Port, { moduleUrl: (s) => `data:text/javascript;base64,${Buffer.from(s).toString("base64")}` });
  return {
    postMessage: (m) => port1.postMessage(m),
    addEventListener: (type: string, listener: (e: never) => void) => {
      if (type === "message") port1.addEventListener("message", listener as never);
    },
    terminate: () => {
      port1.close();
      port2.close();
    },
  };
}

const TEXT = "---\ntitle: a\n---\n\nHello world.\n";
const post: PostSnapshot = { path: "content/posts/a.md", url: "/a/", title: "a", siteName: "Blog", text: TEXT, bodyStart: TEXT.indexOf("\n\n") + 2, selection: { from: 0, to: 0 }, unsaved: true };

function setup() {
  const log: string[] = [];
  const writes: { path: string; text: string; extension: string }[] = [];
  const frontMatter: Record<string, unknown> = { title: "a" };
  const bridge: HostBridge = {
    post: () => post,
    applyEdits: () => ({ applied: 0, problems: [] }),
    insert: () => true,
    readSiteFile: async () => null,
    listSiteDir: async (path) => (path === "static" ? [{ name: "demos", kind: "directory" }] : null),
    writeSiteFile: async ({ extension, path, text }) => (writes.push({ path, text, extension: extension.id }), path !== "declined.txt"),
    frontMatter: () => ({ ...frontMatter }),
    setFrontMatter: (key, value) => {
      if (value === undefined) delete frontMatter[key];
      else frontMatter[key] = value;
      return true;
    },
    prompt: () => {},
    notify: (message) => void log.push(message),
    confirm: async () => true,
    pick: async () => null,
  };
  const store = new Map<string, unknown>();
  const host = new ExtensionHost(bridge, { createWorker: fakeWorker, storage: { get: async (k) => store.get(k), set: async (k, v) => void store.set(k, v) }, timeouts: { hook: 200 } });
  const start = (source: string) => host.run([{ ...parseExtension(source), origin: "installed" }]);
  return { host, log, writes, frontMatter, start };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe("extension API v2", () => {
  it("writes site files only with site:write, and lists folders with site:read", async () => {
    const { host, log, writes, start } = setup();
    await start(`
      export const manifest = { id: "demo-maker", name: "Demos", permissions: ["site:read", "site:write", "ui"] };
      export default async function (editor) {
        const entries = await editor.site.list("static");
        const ok = await editor.site.writeFile("static/demos/chart.html", "<p>chart</p>", { reason: "The chart demo" });
        const no = await editor.site.writeFile("declined.txt", "x");
        editor.ui.notify(JSON.stringify({ entries, ok, no }));
      }`);
    await until(() => log.length > 0);
    expect(JSON.parse(log[0].replace(/^Demos: /, ""))).toEqual({ entries: [{ name: "demos", kind: "directory" }], ok: true, no: false });
    expect(writes).toEqual([
      { path: "static/demos/chart.html", text: "<p>chart</p>", extension: "demo-maker" },
      { path: "declined.txt", text: "x", extension: "demo-maker" },
    ]);
    host.stopAll();

    const other = setup();
    await other.start(`
      export const manifest = { id: "sneaky", name: "Sneaky", permissions: ["site:read", "ui"] };
      export default function (editor) {
        editor.site.writeFile("a.txt", "x").catch((e) => editor.ui.notify(e.message));
      }`);
    await until(() => other.log.length > 0);
    expect(other.log[0]).toContain('"site:write" permission');
    expect(other.writes).toEqual([]);
    other.host.stopAll();
  });

  it("reads and sets front matter", async () => {
    const { host, log, frontMatter, start } = setup();
    await start(`
      export const manifest = { id: "fm", name: "FM", permissions: ["post:read", "post:write", "ui"] };
      export default async function (editor) {
        const before = await editor.document.frontMatter();
        await editor.document.setFrontMatter("summary", "Short.");
        await editor.document.setFrontMatter("title", undefined);
        const bad = await editor.document.setFrontMatter("bad key!", 1).then(() => "set", (e) => e.message);
        editor.ui.notify(JSON.stringify({ before, bad }));
      }`);
    await until(() => log.length > 0);
    const { before, bad } = JSON.parse(log[0].replace(/^FM: /, ""));
    expect(before).toEqual({ title: "a" });
    expect(bad).toMatch(/Invalid front matter key/);
    expect(frontMatter).toEqual({ summary: "Short." });
    host.stopAll();
  });

  it("chains save hooks, lets one block, and skips one that hangs", async () => {
    const { host, start } = setup();
    await host.run([
      {
        ...parseExtension(`
          export const manifest = { id: "lastmod", name: "Lastmod", permissions: ["post:write"], order: 1 };
          export default function (editor) {
            editor.onBeforeSave((post) => ({ text: post.text.replace("title: a", "title: a\\nlastmod: 2026-10-25") }));
          }`),
        origin: "installed",
      },
      {
        ...parseExtension(`
          export const manifest = { id: "slow", name: "Slow", permissions: ["post:write"] };
          export default function (editor) {
            editor.onBeforeSave(() => new Promise(() => {}));
          }`),
        origin: "installed",
      },
    ]);
    expect((await host.beforeSave(post)).text).toContain("lastmod: 2026-10-25");
    expect(host.status("slow").logs.join()).toMatch(/onBeforeSave/);

    await start(`
      export const manifest = { id: "lint", name: "Lint", permissions: ["post:write"] };
      export default function (editor) {
        editor.onBeforeSave((post) => (post.text.includes("TODO") ? { block: "There's a TODO left." } : undefined));
      }`);
    expect(await host.beforeSave({ ...post, text: TEXT + "TODO\n" })).toMatchObject({ blocked: "Lint: There's a TODO left." });
    host.stopAll();

    // A save hook needs post:write.
    const other = setup();
    await other.start(`
      export const manifest = { id: "peek", name: "Peek", permissions: ["post:read"] };
      export default function (editor) { editor.onBeforeSave(() => ({ text: "gone" })); }`);
    await until(() => other.host.status("peek").logs.length > 0);
    expect(other.host.status("peek").logs.join()).toMatch(/post:write/);
    expect((await other.host.beforeSave(post)).text).toBe(TEXT);
    other.host.stopAll();
  });

  it("sends site events only with site:read, and settings to their extension", async () => {
    const { host, log } = setup();
    await host.run([
      {
        ...parseExtension(`
          export const manifest = {
            id: "watcher", name: "Watcher", permissions: ["site:read", "ui"],
            settings: { folder: { type: "string", default: "static", title: "Folder" }, loud: { type: "boolean" } },
          };
          export default async function (editor) {
            editor.ui.notify("settings " + JSON.stringify(await editor.settings.get()));
            editor.on("site:files-changed", (c) => editor.ui.notify("files " + c.paths.join(",")));
            editor.on("site:open", (s) => editor.ui.notify("open " + s.name));
            editor.on("settings:change", (v) => editor.ui.notify("changed " + JSON.stringify(v)));
          }`),
        origin: "installed",
      },
      {
        ...parseExtension(`
          export const manifest = { id: "blind", name: "Blind", permissions: ["ui"] };
          export default function (editor) { editor.on("site:files-changed", () => editor.ui.notify("saw files")); }`),
        origin: "installed",
      },
    ]);
    await until(() => log.length > 0);
    expect(log).toContain('Watcher: settings {"folder":"static"}');
    host.emit("site:open", { id: "s1", name: "Blog" });
    host.emit("site:files-changed", { paths: ["content/posts/b.md"], rescan: false });
    await host.setSettings("watcher", { folder: "data", loud: true, junk: 1 } as never);
    await until(() => log.length >= 4);
    expect(log).toContain("Watcher: open Blog");
    expect(log).toContain("Watcher: files content/posts/b.md");
    expect(log).toContain('Watcher: changed {"folder":"data","loud":true}');
    expect(log).not.toContain("Blind: saw files");
    host.stopAll();
  });

  it("doesn't time out a command while the author is answering it", async () => {
    const log: string[] = [];
    const host = new ExtensionHost(
      {
        post: () => post,
        applyEdits: () => ({ applied: 0, problems: [] }),
        insert: () => true,
        readSiteFile: async () => null,
        prompt: () => {},
        notify: (message) => void log.push(message),
        confirm: () => new Promise((resolve) => setTimeout(() => resolve(true), 150)),
        pick: async () => null,
      },
      { createWorker: fakeWorker, timeouts: { command: 50 } },
    );
    await host.run([
      {
        ...parseExtension(`
          export const manifest = { id: "asker", name: "Asker", permissions: ["ui"] };
          export default function (editor) {
            editor.registerCommand({ id: "ask", title: "Ask", run: async () => editor.ui.notify("answer " + (await editor.ui.confirm("Sure?"))) });
          }`),
        origin: "installed",
      },
    ]);
    await host.runCommand("asker", "ask");
    expect(log).toEqual(["Asker: answer true"]);
    host.stopAll();
  });

  it("checks manifest settings", () => {
    const parse = (settings: string) => parseExtension(`export const manifest = { id: "x", name: "X", permissions: [], settings: ${settings} };\nexport default function () {}`).manifest;
    expect(parse(`{ size: { type: "number", default: 3 }, mode: { type: "string", enum: ["a", "b"] } }`).settings).toEqual({
      size: { type: "number", default: 3 },
      mode: { type: "string", enum: ["a", "b"] },
    });
    expect(() => parse(`{ size: { type: "date" } }`)).toThrow(/needs a type/);
    expect(() => parse(`{ size: { type: "number", default: "3" } }`)).toThrow(/default isn't a number/);
  });
});

describe("site paths for extensions", () => {
  it("allows plain paths and refuses escapes, git and .editor", () => {
    expect(sitePath("/static/demos/a.html")).toBe("static/demos/a.html");
    expect(sitePath("", { root: true })).toBe("");
    for (const bad of ["", "../x", "a/./b", "a//b", ".git/config", "x/.gitignore", ".editor/extensions/evil.js"]) expect(() => sitePath(bad)).toThrow();
  });

  it("lists the changed lines", () => {
    expect(changedLines("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1, listing: "@@ line 2\n- b\n+ B" });
    expect(changedLines("a", "a\nb").added).toBe(1);
  });
});
