import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncEntries, type SyncedEntry } from "../src/lib/synced";
import { SyncedExtensionStorage } from "../src/extensions/storage";
import { HUGO_SHORTCODES, isShortcodePath, shortcodeSnippet } from "../src/lib/hugo";

const settings = { server: "https://editor.test", token: "t" };

/** A stand-in for /api/features: feature -> key -> value. */
function fakeServer() {
  const data = new Map<string, Map<string, unknown>>();
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const [, , , feature, , key] = url.pathname.split("/");
    const store = data.get(feature) ?? new Map();
    data.set(feature, store);
    if (!key) return Response.json([...store.keys()].map((k) => ({ key: k, updatedAt: 1 })));
    const k = decodeURIComponent(key);
    if (init?.method === "PUT") {
      store.set(k, JSON.parse(String(init.body)));
      return Response.json({ key: k });
    }
    return store.has(k) ? Response.json({ key: k, value: store.get(k) }) : Response.json({ error: "Not found" }, { status: 404 });
  }) as typeof fetch;
  return { data, fetchImpl };
}

describe("syncEntries", () => {
  it("uploads local-only entries and takes newer server ones, removals included", async () => {
    const { data, fetchImpl } = fakeServer();
    data.set("f", new Map<string, unknown>([
      ["a", { value: "server a", updatedAt: 20 }],
      ["b", { value: "server b", updatedAt: 5 }],
      ["gone", { deleted: true, updatedAt: 30 }],
      ["never-here", { deleted: true, updatedAt: 1 }],
    ]));
    const local: Record<string, SyncedEntry<string>> = {
      a: { value: "local a", updatedAt: 10 },
      b: { value: "local b", updatedAt: 15 },
      c: { value: "local c", updatedAt: 0 },
      gone: { value: "stale", updatedAt: 2 },
    };
    const { entries, changed } = await syncEntries(settings, "f", local, fetchImpl);
    expect(changed.sort()).toEqual(["a", "gone"]);
    expect(entries.a.value).toBe("server a");
    expect(entries.gone.deleted).toBe(true);
    expect(entries["never-here"]).toBeUndefined();
    expect(data.get("f")!.get("b")).toEqual({ value: "local b", updatedAt: 15 });
    expect(data.get("f")!.get("c")).toEqual({ value: "local c", updatedAt: 0 });
  });
});

function memoryKV() {
  const m = new Map<string, unknown>();
  return { m, kv: { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => void m.set(k, v), keys: async () => [...m.keys()] } };
}

describe("SyncedExtensionStorage", () => {
  it("carries snippets saved in one browser to a fresh one", async () => {
    const server = fakeServer();
    const old = memoryKV();
    // Saved before syncing existed: no time recorded.
    old.m.set("extension:snippets:snippets", { sig: "— Paul" });
    old.m.set("unrelated", 1);
    await new SyncedExtensionStorage(() => undefined, old.kv, server.fetchImpl).sync(settings);
    expect([...server.data.get("extension-data")!.keys()]).toEqual(["extension:snippets:snippets"]);

    const fresh = memoryKV();
    const storage = new SyncedExtensionStorage(() => settings, fresh.kv, server.fetchImpl);
    expect(await storage.sync(settings)).toEqual(["extension:snippets:snippets"]);
    expect(await storage.get("extension:snippets:snippets")).toEqual({ sig: "— Paul" });

    // A change in the new browser goes up straight away and wins on the old one.
    await storage.set("extension:snippets:snippets", { sig: "— PK" });
    await new SyncedExtensionStorage(() => undefined, old.kv, server.fetchImpl).sync(settings);
    expect(old.m.get("extension:snippets:snippets")).toEqual({ sig: "— PK" });
  });
});

describe("custom quick edits", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal("window", new EventTarget());
  });

  it("syncs additions and removals between browsers", async () => {
    const server = fakeServer();
    vi.stubGlobal("fetch", server.fetchImpl);
    const actions = { ...(await import("../src/lib/actions")), ...(await import("../src/lib/custom-actions")) };
    // Browser one has an edit saved before syncing existed.
    store.set("md-editor:custom-actions", JSON.stringify([{ id: "custom-1", name: "Tighten", prompt: "Tighten it" }]));
    await actions.syncCustomActions(settings);
    const browserOne = new Map(store);

    // Browser two starts empty and gets it.
    store = new Map();
    expect(await actions.syncCustomActions(settings)).toBe(true);
    expect(actions.loadCustomActions().map((a) => a.name)).toEqual(["Tighten"]);
    actions.removeCustomAction("custom-1", settings);
    await new Promise((r) => setTimeout(r, 0));

    // Back in browser one, the removal arrives.
    store = browserOne;
    expect(await actions.syncCustomActions(settings)).toBe(true);
    expect(actions.loadCustomActions()).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("Hugo shortcodes", () => {
  it("knows Hugo's built-ins, x included", () => {
    expect(HUGO_SHORTCODES.map((s) => s.name)).toContain("x");
    expect(shortcodeSnippet("x")).toBe('{{< x user="" id="" >}}');
    // The site's own x (aifoc.us has one) is inserted plainly.
    expect(shortcodeSnippet("x", ["x"])).toBe("{{< x >}}");
    expect(shortcodeSnippet("aside", ["aside"])).toBe("{{< aside >}}");
  });

  it("spots paths that can change the shortcode list", () => {
    for (const p of ["layouts", "layouts/shortcodes", "layouts/shortcodes/x.html", "layouts/_shortcodes/a.html", "themes/t/layouts/shortcodes/b.html", "themes/t", "themes"]) expect(isShortcodePath(p), p).toBe(true);
    for (const p of ["content/posts/a.md", "layouts/partials/x.html", "static/x.html"]) expect(isShortcodePath(p), p).toBe(false);
  });
});
