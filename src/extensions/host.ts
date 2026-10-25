// The page side of editor extensions: starts a worker per enabled extension,
// answers its requests after checking its permissions, keeps what it
// registered (commands, buttons, status items, tools, ...), and calls back
// into it to run them. The app renders the contributions and tells the host
// about editor events; the agent connection routes tool calls here.

import { get as idbGet, set as idbSet } from "idb-keyval";
import { type AgentExtensionSpec, type ExtensionCall, type ExtensionCallResults } from "../shared/extensions";
import {
  METHOD_PERMISSIONS,
  REGISTRATION_PERMISSIONS,
  type HostToWorker,
  type Invocation,
  type Invocations,
  type Method,
  type Methods,
  type Port,
  type Registration,
  type WorkerToHost,
} from "./messages";
import type {
  AgentSkill,
  Annotation,
  ButtonSpec,
  CommandSpec,
  EditorEvent,
  ExtensionRecord,
  PanelSpec,
  Permission,
  PostSnapshot,
  QuickEditSpec,
  SkillSpec,
  ToolSpec,
} from "./types";

/** What the host needs from the app. */
export interface HostBridge {
  post(): PostSnapshot | undefined;
  applyEdits(edits: { find: string; replace: string }[]): { applied: number; problems: string[] };
  insert(text: string): boolean;
  readSiteFile(path: string): Promise<string | null>;
  /** Starts an assistant run; throws with a reason if the assistant isn't ready. */
  prompt(text: string, label: string): void;
  notify(message: string, level: "info" | "warning" | "error"): void;
  confirm(title: string, message?: string): Promise<boolean>;
  pick(title: string, items: string[]): Promise<string | null>;
  /** For the built-in extension builder. */
  extensions?: {
    list(): Promise<unknown>;
    read(id: string): Promise<string | null>;
    /** Asks the author to approve, then installs and runs it. Resolves with how loading went. */
    install(source: string): Promise<unknown>;
  };
}

export interface WorkerLike extends Port {
  terminate(): void;
  addEventListener(type: "message" | "error", listener: (e: never) => void): void;
}

export interface HostOptions {
  createWorker?: (name: string) => WorkerLike;
  /** Per-extension key/value storage. Defaults to IndexedDB. */
  storage?: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  timeouts?: Partial<Record<"load" | "tool" | "hook" | "command", number>>;
}

const TIMEOUTS = { load: 10_000, tool: 110_000, hook: 4_000, command: 60_000 };
const MAX_ANNOTATIONS = 500;
const MAX_STATUS_CHARS = 80;

export type ExtensionStatus = "loading" | "running" | "failed" | "stopped";

interface Running {
  record: ExtensionRecord;
  worker: WorkerLike;
  status: ExtensionStatus;
  error?: string;
  logs: string[];
  nextId: number;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  commands: Map<string, CommandSpec>;
  buttons: Map<string, ButtonSpec>;
  panels: Map<string, PanelSpec & { html: string }>;
  statuses: Map<string, { text: string; title?: string }>;
  annotations: Map<string, Annotation[]>;
  tools: Map<string, ToolSpec>;
  skills: Map<string, SkillSpec>;
  edits: Map<string, QuickEditSpec>;
  sections: Map<string, string>;
  hooks: { beforeTool: boolean; afterTool: boolean };
  loaded: Promise<void>;
}

export class ExtensionHost extends EventTarget {
  private running = new Map<string, Running>();
  private changeQueued = false;
  private readonly timeouts: typeof TIMEOUTS;
  private readonly storage: NonNullable<HostOptions["storage"]>;
  private readonly createWorker: (name: string) => WorkerLike;
  /** Messages a panel iframe posts are routed by its window. */
  private panelWindows = new Map<Window, { id: string; panel: string }>();

  constructor(
    private bridge: HostBridge,
    options: HostOptions = {},
  ) {
    super();
    this.timeouts = { ...TIMEOUTS, ...options.timeouts };
    this.storage = options.storage ?? { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v) };
    this.createWorker =
      options.createWorker ?? ((name) => new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name }) as unknown as WorkerLike);
  }

  // ---- Lifecycle ---------------------------------------------------------------

  /** Runs exactly these extensions: starts new ones, restarts changed ones, stops the rest. */
  async run(records: ExtensionRecord[]): Promise<void> {
    const wanted = new Map(records.map((r) => [r.manifest.id, r]));
    for (const [id, ext] of this.running) {
      const next = wanted.get(id);
      if (!next || next.source !== ext.record.source || JSON.stringify(next.manifest) !== JSON.stringify(ext.record.manifest)) this.stop(id);
    }
    const starting: Promise<void>[] = [];
    for (const [id, record] of wanted) if (!this.running.has(id)) starting.push(this.start(record));
    await Promise.all(starting);
  }

  stop(id: string) {
    const ext = this.running.get(id);
    if (!ext) return;
    ext.worker.terminate();
    for (const { reject, timer } of ext.pending.values()) {
      clearTimeout(timer);
      reject(new Error(`${ext.record.manifest.name} was stopped.`));
    }
    this.running.delete(id);
    for (const [win, owner] of this.panelWindows) if (owner.id === id) this.panelWindows.delete(win);
    this.changed();
  }

  stopAll() {
    for (const id of [...this.running.keys()]) this.stop(id);
  }

  status(id: string): { status: ExtensionStatus; error?: string; logs: string[] } {
    const ext = this.running.get(id);
    return ext ? { status: ext.status, error: ext.error, logs: ext.logs } : { status: "stopped", logs: [] };
  }

  private start(record: ExtensionRecord): Promise<void> {
    const { manifest } = record;
    const worker = this.createWorker(`extension:${manifest.id}`);
    const ext: Running = {
      record,
      worker,
      status: "loading",
      logs: [],
      nextId: 1,
      pending: new Map(),
      commands: new Map(),
      buttons: new Map(),
      panels: new Map(),
      statuses: new Map(),
      annotations: new Map(),
      tools: new Map(),
      skills: new Map(),
      edits: new Map(),
      sections: new Map(),
      hooks: { beforeTool: false, afterTool: false },
      loaded: Promise.resolve(),
    };
    this.running.set(manifest.id, ext);
    ext.loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.fail(ext, "It took too long to start.");
        resolve();
      }, this.timeouts.load);
      worker.addEventListener("message", ((e: MessageEvent) => {
        const message = e.data as WorkerToHost;
        if (message.type === "loaded") {
          clearTimeout(timer);
          if (message.error) this.fail(ext, message.error);
          else ext.status = "running";
          this.changed();
          resolve();
        } else {
          void this.onWorkerMessage(ext, message);
        }
      }) as never);
      worker.addEventListener("error", ((e: ErrorEvent) => {
        clearTimeout(timer);
        e.preventDefault?.();
        this.fail(ext, e.message || "The extension's worker crashed.");
        resolve();
      }) as never);
    });
    const post = this.granted(ext, "post:read") ? (this.bridge.post() ?? null) : null;
    this.post(ext, { type: "load", manifest, source: record.source, post });
    return ext.loaded;
  }

  /** A crashed or broken extension is stopped and loses its contributions; the others keep running. */
  private fail(ext: Running, error: string) {
    if (this.running.get(ext.record.manifest.id) !== ext) return;
    ext.status = "failed";
    ext.error = error;
    ext.worker.terminate();
    for (const { reject, timer } of ext.pending.values()) {
      clearTimeout(timer);
      reject(new Error(`${ext.record.manifest.name} failed: ${error}`));
    }
    ext.pending.clear();
    for (const map of [ext.commands, ext.buttons, ext.panels, ext.statuses, ext.annotations, ext.tools, ext.skills, ext.edits, ext.sections]) map.clear();
    ext.hooks = { beforeTool: false, afterTool: false };
    this.changed();
  }

  // ---- Requests from extensions ---------------------------------------------------

  private granted(ext: Running, permission: Permission): boolean {
    if (permission === "extensions" && ext.record.origin !== "builtin") return false;
    return ext.record.manifest.permissions.includes(permission);
  }

  private missing(ext: Running, needed: Permission[]): Permission[] {
    return needed.filter((p) => !this.granted(ext, p));
  }

  private async onWorkerMessage(ext: Running, message: WorkerToHost) {
    if (this.running.get(ext.record.manifest.id) !== ext) return;
    switch (message.type) {
      case "log":
        ext.logs = [...ext.logs.slice(-19), message.message];
        console.warn(`[extension ${ext.record.manifest.id}]`, message.message);
        this.changed();
        return;
      case "reply": {
        const waiting = ext.pending.get(message.id);
        if (!waiting) return;
        ext.pending.delete(message.id);
        clearTimeout(waiting.timer);
        if (message.ok) waiting.resolve(message.value);
        else waiting.reject(new Error(message.error || "The extension failed."));
        return;
      }
      case "request": {
        const needed = METHOD_PERMISSIONS[message.method];
        if (!needed) return this.reply(ext, message.id, false, undefined, `Unknown method ${String(message.method)}`);
        const missing = this.missing(ext, needed);
        if (message.method === "register" || message.method === "unregister") {
          missing.push(...this.missing(ext, REGISTRATION_PERMISSIONS[(message.params as Registration).kind] ?? ["ui"]));
        }
        if (missing.length) {
          return this.reply(ext, message.id, false, undefined, `${message.method} needs the ${missing.map((p) => `"${p}"`).join(", ")} permission in the manifest.`);
        }
        try {
          const value = await this.handle(ext, message.method, message.params as never);
          this.reply(ext, message.id, true, value);
        } catch (e) {
          this.reply(ext, message.id, false, undefined, e instanceof Error ? e.message : String(e));
        }
        return;
      }
    }
  }

  private reply(ext: Running, id: number, ok: boolean, value?: unknown, error?: string) {
    this.post(ext, { type: "reply", id, ok, ...(ok ? { value } : { error }) });
  }

  private async handle<M extends Method>(ext: Running, method: M, params: Methods[M]["params"]): Promise<unknown> {
    const { name } = ext.record.manifest;
    const p = params as Record<string, unknown>;
    switch (method) {
      case "document.read":
        return this.bridge.post() ?? null;
      case "document.applyEdits":
        return this.bridge.applyEdits(asEdits(p.edits));
      case "document.insert":
        return this.bridge.insert(String(p.text ?? ""));
      case "document.annotate": {
        const set = String(p.set ?? "default").slice(0, 64);
        const list = asAnnotations(p.annotations);
        if (list.length) ext.annotations.set(set, list);
        else ext.annotations.delete(set);
        this.changed();
        return;
      }
      case "site.readFile":
        return this.bridge.readSiteFile(String(p.path ?? ""));
      case "ui.notify":
        this.bridge.notify(`${name}: ${String(p.message ?? "")}`, (p.level as "info") ?? "info");
        return;
      case "ui.confirm":
        return this.bridge.confirm(`${name}: ${String(p.title ?? "")}`, p.message === undefined ? undefined : String(p.message));
      case "ui.pick":
        return this.bridge.pick(`${name}: ${String(p.title ?? "")}`, Array.isArray(p.items) ? p.items.map(String).slice(0, 100) : []);
      case "ui.status": {
        const id = String(p.id ?? "status");
        if (p.text === null) ext.statuses.delete(id);
        else ext.statuses.set(id, { text: String(p.text ?? "").slice(0, MAX_STATUS_CHARS), ...(p.title ? { title: String(p.title) } : {}) });
        this.changed();
        return;
      }
      case "ui.panel.render": {
        const panel = ext.panels.get(String(p.id));
        if (!panel) throw new Error(`No panel ${String(p.id)}; create it with editor.ui.panel() first.`);
        panel.html = String(p.html ?? "");
        this.changed();
        return;
      }
      case "ui.panel.post": {
        for (const [win, owner] of this.panelWindows) {
          if (owner.id === ext.record.manifest.id && owner.panel === p.id) win.postMessage(p.message, "*");
        }
        return;
      }
      case "storage.get":
        return this.storage.get(`extension:${ext.record.manifest.id}:${String(p.key)}`);
      case "storage.set":
        return this.storage.set(`extension:${ext.record.manifest.id}:${String(p.key)}`, p.value);
      case "agent.prompt":
        this.bridge.prompt(String(p.text ?? ""), (p.label as string) || name);
        return;
      case "extensions.list":
        return this.need(this.bridge.extensions).list();
      case "extensions.read":
        return this.need(this.bridge.extensions).read(String(p.id ?? ""));
      case "extensions.install":
        return this.need(this.bridge.extensions).install(String(p.source ?? ""));
      case "register":
        this.register(ext, params as Registration);
        return;
      case "unregister": {
        const map = this.registrationMap(ext, String(p.kind));
        map?.delete(String(p.id));
        this.changed();
        return;
      }
    }
    throw new Error(`Unknown method ${method}`);
  }

  private need<T>(value: T | undefined): T {
    if (!value) throw new Error("Not available in this editor.");
    return value;
  }

  private register(ext: Running, registration: Registration) {
    const spec = registration.spec as unknown as Record<string, unknown>;
    const id = (key: string) => {
      const value = String(spec[key] ?? "");
      if (!/^[A-Za-z][\w-]{0,63}$/.test(value)) throw new Error(`Invalid ${registration.kind} ${key}: ${JSON.stringify(value)}`);
      return value;
    };
    switch (registration.kind) {
      case "command":
        ext.commands.set(id("id"), registration.spec);
        break;
      case "button":
        ext.buttons.set(id("id"), registration.spec);
        break;
      case "panel":
        ext.panels.set(id("id"), { ...registration.spec, html: ext.panels.get(registration.spec.id)?.html ?? "" });
        break;
      case "tool":
        ext.tools.set(id("name"), registration.spec);
        break;
      case "skill":
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(registration.spec.name)) throw new Error("Skill names are kebab-case, e.g. plain-english.");
        ext.skills.set(registration.spec.name, registration.spec);
        break;
      case "edit":
        ext.edits.set(id("id"), registration.spec);
        break;
      case "section":
        if (!/^[a-z0-9_-]{1,64}$/.test(registration.spec.name)) throw new Error("Section names are lowercase letters, digits, _ and -.");
        ext.sections.set(registration.spec.name, String(registration.spec.text ?? ""));
        break;
      case "hook":
        ext.hooks = { beforeTool: ext.hooks.beforeTool || !!registration.spec.beforeTool, afterTool: ext.hooks.afterTool || !!registration.spec.afterTool };
        break;
    }
    this.changed();
  }

  private registrationMap(ext: Running, kind: string): Map<string, unknown> | undefined {
    return ({ command: ext.commands, button: ext.buttons, panel: ext.panels, tool: ext.tools, skill: ext.skills, edit: ext.edits } as Record<string, Map<string, unknown>>)[kind];
  }

  // ---- Calling into extensions ------------------------------------------------------

  private post(ext: Running, message: HostToWorker) {
    ext.worker.postMessage(message);
  }

  private invoke<K extends Invocation>(id: string, name: K, params: Invocations[K]["params"], timeoutMs: number): Promise<Invocations[K]["result"]> {
    const ext = this.running.get(id);
    if (!ext || ext.status !== "running") return Promise.reject(new Error(`The ${id} extension isn't running.`));
    return new Promise((resolve, reject) => {
      const callId = ext.nextId++;
      const timer = setTimeout(() => {
        ext.pending.delete(callId);
        reject(new Error(`${ext.record.manifest.name} didn't answer within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      ext.pending.set(callId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.post(ext, { type: "invoke", id: callId, name, params });
    });
  }

  /** Tells every extension that may see it about an editor event. */
  emit(event: EditorEvent, data?: unknown) {
    const postEvent = event.startsWith("post:");
    // Annotations belong to one post; extensions send new ones for the next.
    if (event === "post:open" || event === "post:close") {
      for (const ext of this.running.values()) ext.annotations.clear();
      this.changed();
    }
    for (const ext of this.running.values()) {
      if (ext.status !== "running") continue;
      if (postEvent && !this.granted(ext, "post:read")) continue;
      this.post(ext, { type: "event", name: event, data: data ?? null });
    }
  }

  runCommand(id: string, command: string) {
    return this.invoke(id, "command", { id: command }, this.timeouts.command).catch((e) => this.bridge.notify(String(e.message ?? e), "error"));
  }

  clickButton(id: string, button: string) {
    return this.invoke(id, "button", { id: button }, this.timeouts.command).catch((e) => this.bridge.notify(String(e.message ?? e), "error"));
  }

  /** Runs an extension command bound to this key, if any. Returns true when one ran. */
  handleKey(e: KeyboardEvent): boolean {
    for (const { extension, spec } of this.commands) {
      if (spec.key && matchesKey(e, spec.key)) {
        e.preventDefault();
        void this.runCommand(extension, spec.id);
        return true;
      }
    }
    return false;
  }

  /** An agent session's call into an extension (see AgentConnection). */
  async call<C extends ExtensionCall>(call: C): Promise<ExtensionCallResults[C["kind"]]> {
    const ext = this.running.get(call.extension);
    if (!ext || ext.status !== "running") throw new Error(`The ${call.extension} extension isn't running in the editor.`);
    switch (call.kind) {
      case "tool":
        if (!ext.tools.has(call.name)) throw new Error(`${ext.record.manifest.name} has no tool ${call.name}.`);
        return (await this.invoke(call.extension, "tool", { name: call.name, args: call.args }, this.timeouts.tool)) as never;
      case "beforeTool":
        if (!ext.hooks.beforeTool) return undefined as never;
        return (await this.invoke(call.extension, "beforeTool", { tool: call.tool, args: call.args }, this.timeouts.hook)) as never;
      case "afterTool":
        if (!ext.hooks.afterTool) return undefined as never;
        return (await this.invoke(call.extension, "afterTool", { tool: call.tool, args: call.args, result: call.result }, this.timeouts.hook)) as never;
    }
    throw new Error("Unknown call");
  }

  // ---- Panels ---------------------------------------------------------------------------

  /** Connects a panel's iframe window, so its postMessage calls reach the extension. */
  attachPanel(id: string, panel: string, win: Window | null) {
    for (const [w, owner] of this.panelWindows) if (owner.id === id && owner.panel === panel) this.panelWindows.delete(w);
    if (win) this.panelWindows.set(win, { id, panel });
  }

  /** Routes a message event from a panel iframe; ignores everything else. */
  onWindowMessage = (e: MessageEvent) => {
    const owner = e.source ? this.panelWindows.get(e.source as Window) : undefined;
    if (!owner) return;
    void this.invoke(owner.id, "panel.message", { id: owner.panel, message: e.data }, this.timeouts.command).catch(() => {});
  };

  // ---- What extensions contributed ----------------------------------------------------

  private collect<T>(pick: (ext: Running) => Iterable<T>): { extension: string; name: string; spec: T }[] {
    const out: { extension: string; name: string; spec: T }[] = [];
    for (const ext of this.running.values()) {
      if (ext.status !== "running") continue;
      for (const spec of pick(ext)) out.push({ extension: ext.record.manifest.id, name: ext.record.manifest.name, spec });
    }
    return out;
  }

  get commands() {
    return this.collect((e) => e.commands.values());
  }

  get buttons() {
    return this.collect((e) => e.buttons.values());
  }

  get panels() {
    return this.collect((e) => e.panels.values());
  }

  get statuses() {
    return this.collect((e) => [...e.statuses].map(([id, s]) => ({ id, ...s })));
  }

  get quickEdits() {
    return this.collect((e) => e.edits.values());
  }

  /** Every annotation, across extensions and sets. */
  get annotations(): Annotation[] {
    return this.collect((e) => [...e.annotations.values()].flat()).map((a) => a.spec);
  }

  /** Skills in the agent harness's shape. */
  get skills(): AgentSkill[] {
    return this.collect((e) => e.skills.values()).map(({ extension, spec }) => ({
      name: spec.name,
      description: spec.description,
      instructions: spec.instructions,
      source: `extension:${extension}`,
      ...(spec.scope ? { scope: spec.scope } : {}),
    }));
  }

  /** What the agent session installs, one entry per running extension that adds anything to the agent. */
  get agentSpecs(): AgentExtensionSpec[] {
    const specs: AgentExtensionSpec[] = [];
    for (const ext of this.running.values()) {
      if (ext.status !== "running") continue;
      const spec: AgentExtensionSpec = {
        id: ext.record.manifest.id,
        name: ext.record.manifest.name,
        tools: [...ext.tools.values()].map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? { type: "object", properties: {} },
          ...(t.replay ? { replay: t.replay } : {}),
          ...(t.scope ? { scope: t.scope } : {}),
        })),
        sections: [...ext.sections].map(([name, text]) => ({ name, text })),
        hooks: { ...ext.hooks },
      };
      if (spec.tools.length || spec.sections.length || spec.hooks.beforeTool || spec.hooks.afterTool) specs.push(spec);
    }
    return specs;
  }

  /** Dispatches one `change` event per task, however many things changed. */
  private changed() {
    if (this.changeQueued) return;
    this.changeQueued = true;
    queueMicrotask(() => {
      this.changeQueued = false;
      this.dispatchEvent(new Event("change"));
    });
  }
}

/** Matches CodeMirror-style keys: "Mod-Shift-r", "Alt-k", "Ctrl-Enter". Mod is ⌘ on Apple platforms, Ctrl elsewhere. */
export function matchesKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, key: string, mac = isMac()): boolean {
  const parts = key.split("-");
  const base = parts.pop()!.toLowerCase();
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const ctrl = mods.has("ctrl") || (!mac && mods.has("mod"));
  const meta = mods.has("meta") || mods.has("cmd") || (mac && mods.has("mod"));
  return e.key.toLowerCase() === base && e.ctrlKey === ctrl && e.metaKey === meta && e.altKey === mods.has("alt") && e.shiftKey === mods.has("shift");
}

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function asEdits(value: unknown): { find: string; replace: string }[] {
  if (!Array.isArray(value)) throw new Error("edits must be an array of {find, replace}");
  return value.slice(0, 100).map((e) => ({ find: String(e?.find ?? ""), replace: String(e?.replace ?? "") }));
}

function asAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return [];
  const out: Annotation[] = [];
  for (const a of value.slice(0, MAX_ANNOTATIONS)) {
    const from = Number(a?.from);
    const to = Number(a?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) continue;
    const severity = a.severity === "warning" || a.severity === "error" ? a.severity : "info";
    out.push({ from, to, severity, message: String(a.message ?? "").slice(0, 500) });
  }
  return out;
}
