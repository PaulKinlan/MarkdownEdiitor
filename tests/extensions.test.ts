import { describe, expect, it } from "vitest";
import { ExtensionHost, matchesKey, type HostBridge, type WorkerLike } from "../src/extensions/host";
import { startRuntime } from "../src/extensions/runtime";
import { objectLiteralToJson, parseExtension } from "../src/extensions/loader";
import { builtinExtensions } from "../src/extensions/builtin";
import type { Port } from "../src/extensions/messages";
import type { PostSnapshot } from "../src/extensions/types";

/** A worker stand-in: the runtime on the other end of a MessageChannel, loading modules from data: URLs. */
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

function snapshot(text: string): PostSnapshot {
  const bodyStart = text.indexOf("---\n", 4) + 4;
  return { path: "content/posts/a.md", url: "/a/", title: "a", siteName: "Blog", text, bodyStart, selection: { from: 0, to: 0 }, unsaved: false };
}

function bridge(post: PostSnapshot, log: string[] = []): HostBridge & { text: string } {
  const b = {
    text: post.text,
    post: () => ({ ...post, text: b.text }),
    applyEdits: (edits: { find: string; replace: string }[]) => {
      let applied = 0;
      for (const e of edits) if (b.text.includes(e.find)) (b.text = b.text.replace(e.find, e.replace)), applied++;
      return { applied, problems: [] };
    },
    insert: () => true,
    readSiteFile: async (path: string) => (path === "data/stats.json" ? '{"users": 1200}' : null),
    prompt: (text: string, label: string) => void log.push(`prompt ${label}: ${text}`),
    notify: (message: string) => void log.push(`notify ${message}`),
    confirm: async () => true,
    pick: async (_t: string, items: string[]) => items[0] ?? null,
  };
  return b;
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

const memory = () => {
  const map = new Map<string, unknown>();
  return { get: async (k: string) => map.get(k), set: async (k: string, v: unknown) => void map.set(k, v) };
};

describe("manifest parsing", () => {
  it("reads a plain object literal without running the module", () => {
    expect(JSON.parse(objectLiteralToJson(`{ id: 'x', // note\n name: "A {b}", n: 2, ok: true, list: ["a", 'b',], }`))).toEqual({ id: "x", name: "A {b}", n: 2, ok: true, list: ["a", "b"] });
    const { manifest } = parseExtension(`export const manifest = { id: "demo", name: "Demo", permissions: ["ui"] };\nexport default function () {}`);
    expect(manifest).toEqual({ id: "demo", name: "Demo", permissions: ["ui"] });
    expect(() => parseExtension(`export const manifest = { id: "Bad", name: "x", permissions: [] }; export default 1`)).toThrow(/lowercase/);
    expect(() => parseExtension(`export const manifest = { id: "x", name: "x", permissions: ["root"] }; export default 1`)).toThrow(/Unknown permission/);
    expect(() => parseExtension(`export const manifest = { id: "x", name: fn(), permissions: [] }; export default 1`)).toThrow(/literal/);
  });

  it("parses the built-in extensions", () => {
    expect(builtinExtensions().map((r) => r.manifest.id)).toEqual(["readability", "data-checker", "extension-builder"]);
  });
});

describe("extension host", () => {
  it("tells an extension about post changes made while it was starting", async () => {
    const b = bridge(snapshot("---\ntitle: a\n---\n\nOne.\n"));
    const host = new ExtensionHost(b, { createWorker: fakeWorker, storage: memory() });
    const source = `
      export const manifest = { id: "slow", name: "Slow", permissions: ["post:read", "ui"] };
      export default async function (editor) {
        const show = (p) => editor.ui.status("text", p ? p.text.trim().split("\\n").pop() : "none");
        editor.on("post:change", show);
        await new Promise((r) => setTimeout(r, 30));
        show(editor.document.post);
      }`;
    const running = host.run([{ ...parseExtension(source), origin: "installed" }]);
    await new Promise((r) => setTimeout(r, 5));
    b.text = "---\ntitle: a\n---\n\nTwo.\n";
    host.emit("post:change", b.post());
    await running;
    await until(() => host.statuses[0]?.spec.text === "Two.");
    expect(host.statuses[0]?.spec.text).toBe("Two.");
  });

  it("runs an extension in a worker, checks permissions, and routes tools, hooks and commands", async () => {
    const post = snapshot("---\ntitle: a\n---\n\nHello world.\n");
    const log: string[] = [];
    const b = bridge(post, log);
    const host = new ExtensionHost(b, { createWorker: fakeWorker, storage: memory() });
    const source = `
      export const manifest = { id: "demo", name: "Demo", permissions: ["post:read", "ui", "agent", "agent:hooks"] };
      export default function (editor) {
        editor.ui.status("words", "0 words");
        editor.on("post:change", (p) => editor.ui.status("words", p.text.split(/\\s+/).length + " words"));
        editor.registerCommand({ id: "hi", title: "Say hi", key: "Mod-k", run: () => editor.ui.notify("hi " + editor.document.post.title) });
        editor.agent.registerTool({ name: "shout", description: "Upper-case text", parameters: { type: "object", properties: { text: { type: "string" } } }, execute: ({ text }) => text.toUpperCase() });
        editor.agent.registerSkill({ name: "demo-skill", description: "Demo", instructions: "Do it." });
        editor.agent.registerEdit({ id: "e1", name: "Demo edit", prompt: "Edit it" });
        editor.agent.addSystemPrompt("rules", "Be brief.");
        editor.agent.onToolCall(({ tool }) => (tool === "web_search" ? { block: "No web here" } : undefined));
        // Not granted: post:write.
        editor.document.applyEdits([{ find: "Hello", replace: "Bye" }]).catch((e) => editor.ui.notify("denied: " + e.message));
      }`;
    await host.run([{ ...parseExtension(source), origin: "installed" }]);
    await until(() => log.some((l) => l.includes("denied")));
    expect(host.status("demo").status).toBe("running");
    expect(log.find((l) => l.includes("denied"))).toContain('"post:write" permission');
    expect(b.text).toContain("Hello");

    expect(host.statuses.map((s) => s.spec.text)).toEqual(["0 words"]);
    host.emit("post:change", { ...post, text: "one two three" });
    await until(() => host.statuses[0]?.spec.text === "3 words");
    expect(host.statuses[0].spec.text).toBe("3 words");

    expect(host.agentSpecs).toEqual([
      {
        id: "demo",
        name: "Demo",
        tools: [{ name: "shout", description: "Upper-case text", parameters: { type: "object", properties: { text: { type: "string" } } } }],
        sections: [{ name: "rules", text: "Be brief." }],
        hooks: { beforeTool: true, afterTool: false },
      },
    ]);
    expect(host.skills).toEqual([{ name: "demo-skill", description: "Demo", instructions: "Do it.", source: "extension:demo" }]);
    expect(host.quickEdits.map((e) => e.spec.name)).toEqual(["Demo edit"]);

    expect(await host.call({ kind: "tool", extension: "demo", name: "shout", args: { text: "hey" } })).toEqual({ text: "HEY" });
    expect(await host.call({ kind: "beforeTool", extension: "demo", tool: "web_search", args: {} })).toEqual({ block: "No web here" });
    expect(await host.call({ kind: "beforeTool", extension: "demo", tool: "read_post", args: {} })).toBeUndefined();
    await expect(host.call({ kind: "tool", extension: "demo", name: "missing", args: {} })).rejects.toThrow(/no tool/);

    const key = { key: "k", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault() {} } as KeyboardEvent;
    expect(host.handleKey(key)).toBe(true);
    await until(() => log.some((l) => l.startsWith("notify Demo: hi")));
    expect(log).toContain("notify Demo: hi a");

    host.stopAll();
    expect(host.agentSpecs).toEqual([]);
  });

  it("marks a broken extension failed without affecting the others", async () => {
    const host = new ExtensionHost(bridge(snapshot("---\nt: 1\n---\nx")), { createWorker: fakeWorker, storage: memory() });
    const good = parseExtension(`export const manifest = { id: "good", name: "Good", permissions: ["ui"] }; export default (e) => e.ui.status("s", "ok");`);
    const bad = parseExtension(`export const manifest = { id: "bad", name: "Bad", permissions: [] }; export default () => { throw new Error("boom"); };`);
    await host.run([{ ...good, origin: "installed" }, { ...bad, origin: "installed" }]);
    expect(host.status("bad")).toMatchObject({ status: "failed", error: "boom" });
    expect(host.status("good").status).toBe("running");
    await host.run([{ ...good, origin: "installed" }]);
    expect(host.status("bad").status).toBe("stopped");
    host.stopAll();
  });

  it("runs the built-in extensions against a post", async () => {
    const text = `---\ntitle: numbers\n---\n\nIn 2024 we had 1,200 users, up 35% from the year before, and revenue of $4.5 million. This sentence is deliberately written to be very long so that it goes well past the thirty word limit that the readability extension uses to underline sentences for the author to look at again.\n`;
    const log: string[] = [];
    const host = new ExtensionHost(bridge(snapshot(text), log), { createWorker: fakeWorker, storage: memory() });
    await host.run(builtinExtensions());
    await until(() => host.statuses.length === 2 && host.annotations.length > 0);
    expect(host.status("readability").status).toBe("running");
    expect(host.status("data-checker").status).toBe("running");
    expect(host.statuses.map((s) => s.spec.text)).toEqual([expect.stringMatching(/^Grade \d+\.\d$/), "4 claims"]);
    expect(host.annotations).toHaveLength(1);
    expect(text.slice(host.annotations[0].from, host.annotations[0].to)).toMatch(/^This sentence .* again\.$/);

    const claims = await host.call({ kind: "tool", extension: "data-checker", name: "list_claims", args: {} });
    expect(claims.text.split("\n").filter((l) => /^\d+\./.test(l)).map((l) => l.replace(/^\d+\. /, ""))).toEqual([
      "[date] line 5: 2024",
      "[number] line 5: 1,200",
      "[percent] line 5: 35%",
      "[money] line 5: $4.5 million",
    ]);
    expect((await host.call({ kind: "tool", extension: "data-checker", name: "read_site_data", args: { path: "data/stats.json" } })).text).toBe('{"users": 1200}');
    expect((await host.call({ kind: "tool", extension: "data-checker", name: "read_site_data", args: { path: "../secrets.json" } })).isError).toBe(true);
    expect((await host.call({ kind: "tool", extension: "readability", name: "readability_report", args: {} })).text).toContain("line 5 (34 words): This sentence");
    expect(host.skills.map((s) => s.name)).toEqual(["check-data", "write-extension"]);
    expect(host.skills[1].instructions).toContain("## editor.agent");
    expect(host.panels.map((p) => p.spec.title)).toEqual(["Claims"]);
    host.stopAll();
  });
});

describe("extension builder", () => {
  it("installs through the editor, and only built-ins may manage extensions", async () => {
    const installed: string[] = [];
    const b = {
      ...bridge(snapshot("---\nt: 1\n---\nx")),
      extensions: {
        list: async () => [{ id: "readability" }],
        read: async (id: string) => (id === "readability" ? "source" : null),
        install: async (source: string) => (installed.push(source), { id: "demo", status: "running" }),
      },
    };
    const host = new ExtensionHost(b, { createWorker: fakeWorker, storage: memory() });
    const sneaky = parseExtension(
      `export const manifest = { id: "sneaky", name: "Sneaky", permissions: ["ui", "extensions"] };
       export default (e) => e.extensions.list().then(() => e.ui.notify("listed"), (err) => e.ui.status("s", err.message));`,
    );
    await host.run([...builtinExtensions().filter((r) => r.manifest.id === "extension-builder"), { ...sneaky, origin: "installed" }]);
    expect((await host.call({ kind: "tool", extension: "extension-builder", name: "install_extension", args: { source: "x" } })).isError).toBe(false);
    expect(installed).toEqual(["x"]);
    expect((await host.call({ kind: "tool", extension: "extension-builder", name: "read_extension", args: { id: "nope" } })).isError).toBe(true);
    await until(() => host.statuses.length > 0);
    expect(host.statuses[0].spec.text).toContain('"extensions" permission');
    host.stopAll();
  });
});

describe("matchesKey", () => {
  const e = (key: string, mods: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  it("maps Mod to Cmd on Mac and Ctrl elsewhere", () => {
    expect(matchesKey(e("L", { metaKey: true, shiftKey: true }), "Mod-Shift-l", true)).toBe(true);
    expect(matchesKey(e("l", { ctrlKey: true, shiftKey: true }), "Mod-Shift-l", false)).toBe(true);
    expect(matchesKey(e("l", { ctrlKey: true }), "Mod-Shift-l", false)).toBe(false);
  });
});
