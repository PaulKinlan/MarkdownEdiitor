// Connects extensions to the app: which ones run (the library), editor events
// into the host, and the host's agent contributions into the assistant's
// connection. The app renders what `host` exposes.

import type { AgentLink, AgentSettings } from "../lib/agent-client";
import { ExtensionHost, type HostBridge } from "./host";
import { approve, install, listExtensions, setEnabled, syncLibrary, uninstall, type LibraryEntry } from "./library";
import { parseExtension } from "./loader";
import { PERMISSIONS, type PostSnapshot, type SitePost } from "./types";

export interface AppHooks {
  snapshot(): PostSnapshot | undefined;
  applyEdits(edits: { find: string; replace: string }[]): { applied: number; problems: string[] };
  insert(text: string): boolean;
  readSiteFile(path: string): Promise<string | null>;
  select(from: number, to: number): boolean;
  /** Saves the open post; resolves false if there was nothing to save or it failed. */
  save(): Promise<boolean>;
  sitePosts(): SitePost[];
  prompt(text: string, label: string): void;
  notify(message: string, level: "info" | "warning" | "error"): void;
  /** Agent server settings, when it is reachable; the library syncs to it. */
  server(): AgentSettings | undefined;
}

const CHANGE_DELAY_MS = 300;
const SELECTION_DELAY_MS = 150;

export class ExtensionController extends EventTarget {
  readonly host: ExtensionHost;
  entries: LibraryEntry[] = [];
  private site?: { id: string; handle: FileSystemDirectoryHandle };
  private changeTimer?: ReturnType<typeof setTimeout>;
  private selectionTimer?: ReturnType<typeof setTimeout>;
  private connection?: AgentLink;
  /** Other assistants (the site-wide one) that may call extension tools. */
  private others = new Set<AgentLink>();
  private busy = false;
  private generation = 0;

  constructor(private app: AppHooks) {
    super();
    const bridge: HostBridge = {
      post: () => app.snapshot(),
      applyEdits: (edits) => app.applyEdits(edits),
      insert: (text) => app.insert(text),
      readSiteFile: (path) => app.readSiteFile(path),
      select: (from, to) => app.select(from, to),
      sitePosts: () => app.sitePosts(),
      save: () => app.save(),
      input: (title, value) => input(title, value),
      alert: (title, body) => systemAlert(title, body),
      speech: speech(),
      prompt: (text, label) => app.prompt(text, label),
      notify: (message, level) => app.notify(message, level),
      confirm: async (title, message) => confirm(message ? `${title}\n\n${message}` : title),
      pick: (title, items) => pick(title, items),
      extensions: {
        list: async () => this.describe(),
        read: async (id) => this.entries.find((e) => e.manifest.id === id)?.source ?? null,
        install: (source) => this.installSource(source, "assistant"),
      },
    };
    this.host = new ExtensionHost(bridge);
    this.host.addEventListener("change", () => {
      this.pushToAgent();
      this.dispatchEvent(new Event("change"));
    });
    window.addEventListener("message", this.host.onWindowMessage);
  }

  /** Loads the library for this site (or none) and runs what is enabled. */
  async load(site?: { id: string; handle: FileSystemDirectoryHandle }) {
    this.site = site;
    const generation = ++this.generation;
    const entries = await listExtensions(site).catch((e) => {
      console.warn("Couldn't list extensions", e);
      return [] as LibraryEntry[];
    });
    if (generation !== this.generation) return;
    this.entries = entries;
    await this.host.run(entries.filter((e) => e.enabled && !e.error));
    this.dispatchEvent(new Event("change"));
  }

  /** Merges this browser's installed extensions with the server's library. */
  async sync() {
    const server = this.app.server();
    if (!server) return;
    try {
      if (await syncLibrary(server)) await this.load(this.site);
    } catch (e) {
      console.warn("Couldn't sync extensions", e);
    }
  }

  // ---- Editor events --------------------------------------------------------------

  postOpened() {
    clearTimeout(this.changeTimer);
    this.host.emit("post:open", this.app.snapshot() ?? null);
  }

  /** Debounced: extensions hear about typing once it pauses. */
  postChanged() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      const post = this.app.snapshot();
      if (post) this.host.emit("post:change", post);
    }, CHANGE_DELAY_MS);
  }

  /** Debounced: extensions hear about a selection once it settles. */
  selectionChanged() {
    clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => {
      const post = this.app.snapshot();
      if (!post) return;
      const { from, to } = post.selection;
      this.host.emit("selection", { from, to, text: post.text.slice(from, to) });
    }, SELECTION_DELAY_MS);
  }

  postSaved() {
    this.host.emit("post:save", this.app.snapshot() ?? null);
  }

  postClosed() {
    clearTimeout(this.changeTimer);
    this.host.emit("post:close", null);
  }

  /** Follows the assistant connection: run start/end events, and the extensions it may call. */
  watch(connection: AgentLink | undefined) {
    if (connection === this.connection) return;
    this.connection?.removeEventListener("change", this.onConnectionChange);
    this.connection = connection;
    this.busy = false;
    connection?.addEventListener("change", this.onConnectionChange);
    this.pushToAgent();
  }

  private onConnectionChange = () => {
    const view = this.connection?.view;
    const busy = !!view?.busy;
    if (busy === this.busy) return;
    this.busy = busy;
    if (busy) return this.host.emit("agent:run-start");
    // The run's last answer, so an extension can say what the assistant said.
    const last = [...(view?.items ?? [])].reverse().find((i) => i.kind === "assistant");
    this.host.emit("agent:run-end", last && last.kind === "assistant" ? { text: last.text, ...(last.error ? { error: last.error } : {}) } : {});
  };

  /** Lets another assistant (the site-wide one) call extension tools too. */
  attach(link: AgentLink) {
    this.others.add(link);
    link.setExtensions?.(this.host.agentSpecs, (call) => this.host.call(call));
  }

  detach(link: AgentLink | undefined) {
    if (link) this.others.delete(link);
  }

  private pushToAgent() {
    const specs = this.host.agentSpecs;
    for (const link of [this.connection, ...this.others]) link?.setExtensions?.(specs, (call) => this.host.call(call));
  }

  // ---- Managing extensions -----------------------------------------------------------

  /** A summary for the extension builder and the settings list. */
  describe() {
    return this.entries.map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      description: e.manifest.description,
      origin: e.origin,
      from: e.from,
      enabled: e.enabled,
      permissions: e.manifest.permissions,
      ...(e.unapproved.length ? { waitingForApproval: e.unapproved } : {}),
      ...this.host.status(e.manifest.id),
      ...(e.error ? { error: e.error } : {}),
    }));
  }

  /** Asks the author, then installs (or replaces) an extension and starts it. Resolves with how it started. */
  async installSource(source: string, from: string) {
    const { manifest } = parseExtension(source);
    const existing = this.entries.find((e) => e.manifest.id === manifest.id);
    if (existing && existing.origin !== "installed") throw new Error(`${manifest.id} is already used by a ${existing.origin} extension; pick another id.`);
    const asks = manifest.permissions.map((p) => `• ${PERMISSIONS[p]}`).join("\n") || "• Nothing beyond running";
    const verb = existing ? "Update" : "Install";
    if (!confirm(`${verb} the extension "${manifest.name}" (${manifest.id})${from === "assistant" ? ", written by the assistant" : ` from ${from}`}?\n\nIt asks to:\n${asks}`)) {
      return { id: manifest.id, status: "declined", error: "The author declined to install it." };
    }
    await install(source, from, this.app.server());
    await approve({ key: `installed:${manifest.id}`, manifest });
    await this.load(this.site);
    return { id: manifest.id, name: manifest.name, ...this.host.status(manifest.id) };
  }

  async approve(entry: LibraryEntry) {
    await approve(entry);
    await this.load(this.site);
  }

  async setEnabled(entry: LibraryEntry, enabled: boolean) {
    // Turning one on is the author's approval, even of an extension that asks for nothing.
    if (enabled) return this.approve(entry);
    await setEnabled(entry.key, enabled);
    await this.load(this.site);
  }

  async remove(entry: LibraryEntry) {
    if (entry.origin !== "installed") return;
    await uninstall(entry.manifest.id, this.app.server());
    await this.load(this.site);
  }

  dispose() {
    window.removeEventListener("message", this.host.onWindowMessage);
    this.host.stopAll();
  }
}

/** A small modal list to choose from; resolves with the choice or null. */
function pick(title: string, items: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "extension-pick";
    dialog.style.cssText = "background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:12px;padding:16px;min-width:280px";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("div");
    list.style.cssText = "display:grid;gap:6px;max-height:50vh;overflow:auto;margin:12px 0";
    let choice: string | null = null;
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item;
      button.style.cssText = "text-align:left;padding:6px 10px;font:inherit;cursor:pointer";
      button.onclick = () => ((choice = item), dialog.close());
      list.appendChild(button);
    }
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => dialog.close();
    dialog.replaceChildren(heading, list, cancel);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(choice);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

/** A one-line text prompt in a small modal; resolves with the text or null. */
function input(title: string, value = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "background:var(--bg);color:var(--fg);border:1px solid var(--border);border-radius:12px;padding:16px;min-width:320px";
    const form = document.createElement("form");
    form.method = "dialog";
    form.style.cssText = "display:grid;gap:10px";
    const label = document.createElement("label");
    label.textContent = title;
    label.style.cssText = "display:grid;gap:6px";
    const field = document.createElement("input");
    field.value = value;
    field.style.cssText = "font:inherit;padding:6px 8px";
    label.appendChild(field);
    const buttons = document.createElement("div");
    buttons.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "submit";
    ok.textContent = "OK";
    buttons.replaceChildren(cancel, ok);
    form.replaceChildren(label, buttons);
    dialog.appendChild(form);
    let result: string | null = null;
    cancel.onclick = () => dialog.close();
    form.onsubmit = () => void (result = field.value);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(result);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    field.select();
  });
}

/** A system notification, only while the editor is in the background (you can already see it otherwise). */
async function systemAlert(title: string, body: string | undefined): Promise<boolean> {
  if (document.visibilityState === "visible" && document.hasFocus()) return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "default") await Notification.requestPermission().catch(() => undefined);
  if (Notification.permission !== "granted") return false;
  const n = new Notification(title, { ...(body ? { body: body.slice(0, 300) } : {}), tag: "md-editor-extension" });
  n.onclick = () => {
    window.focus();
    n.close();
  };
  return true;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The Web Speech API's recognition, where the browser has it; one session at a time. */
function speech(): HostBridge["speech"] {
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Ctor) return undefined;
  let current: Recognition | undefined;
  return {
    start(lang, onResult, onEnd) {
      current?.stop();
      const r = new Ctor();
      current = r;
      r.lang = lang || navigator.language;
      r.continuous = true;
      r.interimResults = true;
      let error: string | undefined;
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) onResult(e.results[i][0].transcript, e.results[i].isFinal);
      };
      r.onerror = (e) => void (error = e.error);
      r.onend = () => {
        if (current === r) current = undefined;
        onEnd(error);
      };
      r.start();
    },
    stop() {
      current?.stop();
    },
  };
}
