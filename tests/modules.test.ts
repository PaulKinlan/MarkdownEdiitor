import { describe, expect, it } from "vitest";
import { Contributions, type Shell } from "../src/core/modules";

const shell = new EventTarget() as Shell;

describe("module contributions", () => {
  it("keeps side tabs and settings sections in order, and removes them", () => {
    const c = new Contributions();
    let changes = 0;
    c.addEventListener("change", () => changes++);
    const ctx = c.context(shell);
    ctx.addSideTab({ id: "assistant", title: "Assistant", order: 20, render: () => null as never });
    const remove = ctx.addSideTab({ id: "preview", title: "Preview", order: 10, render: () => null as never });
    ctx.addSettingsSection({ id: "b", order: 50, render: () => null as never });
    ctx.addSettingsSection({ id: "a", order: 5, render: () => null as never });
    expect(c.sideTabs.map((t) => t.id)).toEqual(["preview", "assistant"]);
    expect(c.settingsSections.map((s) => s.id)).toEqual(["a", "b"]);
    remove();
    expect(c.sideTabs.map((t) => t.id)).toEqual(["assistant"]);
    ctx.setEditorOption("spellcheck", false);
    expect(c.editorOptions).toEqual({ spellcheck: false });
    expect(changes).toBe(6);
  });

  it("offers images to handlers until one takes them, and gathers commands", async () => {
    const c = new Contributions();
    const ctx = c.context(shell);
    const seen: string[] = [];
    ctx.onImageFiles(async () => (seen.push("first"), false));
    ctx.onImageFiles(async () => (seen.push("second"), true));
    ctx.onImageFiles(async () => (seen.push("third"), true));
    expect(await c.handleImages([])).toBe(true);
    expect(seen).toEqual(["first", "second"]);
    ctx.addCommands(() => [{ id: "x", title: "X", run: () => {} }]);
    expect(c.commands().map((cmd) => cmd.id)).toEqual(["x"]);
  });

  it("keeps one status item per module, and the last provider of a service", () => {
    const c = new Contributions();
    const a = c.context(shell);
    const b = c.context(shell);
    a.setStatus("Indexing…");
    b.setStatus("Synced");
    expect([...c.statuses.values()]).toEqual(["Indexing…", "Synced"]);
    a.setStatus("");
    expect([...c.statuses.values()]).toEqual(["Synced"]);
    const first = () => "first";
    const removeFirst = a.provide("prompt", first);
    const removeSecond = b.provide("prompt", () => "second");
    expect(c.services.prompt?.("x", "y")).toBe("second");
    removeFirst();
    expect(c.services.prompt?.("x", "y")).toBe("second");
    removeSecond();
    expect(c.services.prompt).toBeUndefined();
  });
});
