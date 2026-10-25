// Runs inside an extension's worker: loads the extension module and gives it
// the `editor` API. Every API call becomes a message to the host, which does
// the work (and checks permissions); the host calls back in to run tools,
// commands and hooks the extension registered.

import type { HostToWorker, Invocation, Invocations, Method, Methods, Port, Registration, WorkerToHost } from "./messages";
import type { Annotation, EditorEvent, ExtensionManifest, PostSnapshot, ToolOutcome, ToolSpec } from "./types";

type Listener = (data: never) => unknown;

export interface RuntimeOptions {
  /** Turns module source into an importable URL. Defaults to a blob: URL. */
  moduleUrl?: (source: string) => string;
  /** Removes network APIs from the worker unless the manifest asks for "network". */
  lockNetwork?: boolean;
}

export function startRuntime(port: Port, options: RuntimeOptions = {}) {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<EditorEvent, Set<Listener>>();
  const tools = new Map<string, (args: never) => unknown>();
  const commands = new Map<string, () => unknown>();
  const buttons = new Map<string, () => unknown>();
  const panelHandlers = new Map<string, Set<(message: unknown) => unknown>>();
  const beforeTool: ((call: { tool: string; args: unknown }) => unknown)[] = [];
  const afterTool: ((call: { tool: string; args: unknown; result: ToolOutcome }) => unknown)[] = [];
  let post: PostSnapshot | null = null;

  const send = (message: WorkerToHost) => port.postMessage(message);
  const request = <M extends Method>(method: M, params: Methods[M]["params"]): Promise<Methods[M]["result"]> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      send({ type: "request", id, method, params });
    });
  const register = (registration: Registration) => void request("register", registration).catch(report);
  const report = (e: unknown) => send({ type: "log", level: "error", message: e instanceof Error ? e.stack || e.message : String(e) });

  const editor = {
    on(event: EditorEvent, listener: Listener) {
      let set = listeners.get(event);
      if (!set) listeners.set(event, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
    registerCommand(spec: { id: string; title: string; key?: string; run: () => unknown }) {
      commands.set(spec.id, spec.run);
      register({ kind: "command", spec: { id: spec.id, title: spec.title, ...(spec.key ? { key: spec.key } : {}) } });
      return () => (commands.delete(spec.id), void request("unregister", { kind: "command", id: spec.id }));
    },
    document: {
      /** The post as of the last event; `read()` asks the editor for the current one. */
      get post() {
        return post;
      },
      get text() {
        return post?.text ?? "";
      },
      async read() {
        post = await request("document.read", {});
        return post;
      },
      applyEdits: (edits: { find: string; replace: string }[]) => request("document.applyEdits", { edits }),
      insert: (text: string) => request("document.insert", { text }),
      annotate: (set: string, annotations: Annotation[]) => request("document.annotate", { set, annotations }),
      select: (from: number, to?: number) => request("document.select", { from, ...(to === undefined ? {} : { to }) }),
      save: () => request("document.save", {}),
    },
    site: {
      readFile: (path: string) => request("site.readFile", { path }),
      posts: () => request("site.posts", {}),
    },
    ui: {
      notify: (message: string, level?: "info" | "warning" | "error") => request("ui.notify", { message, level }),
      confirm: (title: string, message?: string) => request("ui.confirm", { title, message }),
      pick: (title: string, items: string[]) => request("ui.pick", { title, items }),
      input: (title: string, value?: string) => request("ui.input", { title, ...(value === undefined ? {} : { value }) }),
      alert: (title: string, body?: string) => request("ui.alert", { title, ...(body === undefined ? {} : { body }) }),
      status(id: string, text: string, title?: string) {
        void request("ui.status", { id, text, title }).catch(report);
        return {
          set: (next: string, nextTitle?: string) => void request("ui.status", { id, text: next, title: nextTitle }).catch(report),
          remove: () => void request("ui.status", { id, text: null }).catch(report),
        };
      },
      toolbarButton(spec: { id: string; label: string; title?: string; run: () => unknown }) {
        buttons.set(spec.id, spec.run);
        register({ kind: "button", spec: { id: spec.id, label: spec.label, ...(spec.title ? { title: spec.title } : {}) } });
        return () => (buttons.delete(spec.id), void request("unregister", { kind: "button", id: spec.id }));
      },
      /** A side panel tab, drawn in a sandboxed iframe. Its page talks back with `parent.postMessage(...)`. */
      panel(spec: { id: string; title: string; html?: string }) {
        register({ kind: "panel", spec: { id: spec.id, title: spec.title } });
        if (spec.html !== undefined) void request("ui.panel.render", { id: spec.id, html: spec.html }).catch(report);
        return {
          render: (html: string) => request("ui.panel.render", { id: spec.id, html }),
          post: (message: unknown) => request("ui.panel.post", { id: spec.id, message }),
          onMessage(handler: (message: unknown) => unknown) {
            let set = panelHandlers.get(spec.id);
            if (!set) panelHandlers.set(spec.id, (set = new Set()));
            set.add(handler);
            return () => set!.delete(handler);
          },
        };
      },
    },
    agent: {
      registerTool(spec: ToolSpec & { execute: (args: never) => unknown }) {
        const { execute, ...rest } = spec;
        tools.set(spec.name, execute);
        register({ kind: "tool", spec: { ...rest, parameters: rest.parameters ?? { type: "object", properties: {} } } });
      },
      registerSkill: (spec: { name: string; description: string; instructions: string; scope?: "post" | "site" | "both" }) => register({ kind: "skill", spec }),
      registerEdit: (spec: { id: string; name: string; prompt: string }) => register({ kind: "edit", spec }),
      addSystemPrompt: (name: string, text: string) => register({ kind: "section", spec: { name, text } }),
      onToolCall(handler: (call: { tool: string; args: unknown }) => unknown) {
        beforeTool.push(handler);
        register({ kind: "hook", spec: { beforeTool: true } });
      },
      onToolResult(handler: (call: { tool: string; args: unknown; result: ToolOutcome }) => unknown) {
        afterTool.push(handler);
        register({ kind: "hook", spec: { afterTool: true } });
      },
      prompt: (text: string, label?: string) => request("agent.prompt", { text, label }),
    },
    /** Only for built-in extensions with the "extensions" permission. */
    extensions: {
      list: () => request("extensions.list", {}),
      read: (id: string) => request("extensions.read", { id }),
      install: (source: string) => request("extensions.install", { source }),
    },
    speech: {
      start: (options: { lang?: string } = {}) => request("speech.start", { ...(options.lang ? { lang: options.lang } : {}) }),
      stop: () => request("speech.stop", {}),
    },
    storage: {
      get: (key: string) => request("storage.get", { key }),
      set: (key: string, value: unknown) => request("storage.set", { key, value }),
    },
  };

  const invocations: { [K in Invocation]: (params: Invocations[K]["params"]) => Promise<Invocations[K]["result"]> } = {
    async tool({ name, args }) {
      const execute = tools.get(name);
      if (!execute) return { text: `No tool called ${name}.`, isError: true };
      return toOutcome(await execute(args as never));
    },
    async command({ id }) {
      await commands.get(id)?.();
    },
    async button({ id }) {
      await buttons.get(id)?.();
    },
    async beforeTool(call) {
      for (const handler of beforeTool) {
        const answer = (await handler(call)) as { block?: string; args?: Record<string, unknown> } | undefined;
        if (answer?.block) return { block: String(answer.block) };
        if (answer?.args) return { args: answer.args };
      }
      return undefined;
    },
    async afterTool(call) {
      let result: ToolOutcome | undefined;
      for (const handler of afterTool) {
        const answer = await handler({ ...call, result: result ?? call.result });
        if (answer !== undefined) result = toOutcome(answer);
      }
      return result;
    },
    async "panel.message"({ id, message }) {
      for (const handler of panelHandlers.get(id) ?? []) await handler(message);
    },
  };

  const onMessage = async (e: MessageEvent) => {
    const message = e.data as HostToWorker;
    switch (message.type) {
      case "reply": {
        const waiting = pending.get(message.id);
        if (!waiting) return;
        pending.delete(message.id);
        if (message.ok) waiting.resolve(message.value);
        else waiting.reject(new Error(message.error));
        return;
      }
      case "event": {
        if (message.name === "post:open" || message.name === "post:change" || message.name === "post:save") post = message.data as PostSnapshot;
        if (message.name === "post:close") post = null;
        if (message.name === "selection" && post) {
          const { from, to } = message.data as { from: number; to: number };
          post = { ...post, selection: { from, to } };
        }
        for (const listener of listeners.get(message.name) ?? []) {
          try {
            await listener(message.data as never);
          } catch (err) {
            report(err);
          }
        }
        return;
      }
      case "invoke": {
        try {
          const run = invocations[message.name] as (params: unknown) => Promise<unknown>;
          send({ type: "reply", id: message.id, ok: true, value: await run(message.params) });
        } catch (err) {
          send({ type: "reply", id: message.id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      case "load":
        post = message.post;
        send({ type: "loaded", ...(await load(message.manifest, message.source)) });
        return;
    }
  };

  async function load(manifest: ExtensionManifest, source: string): Promise<{ error?: string }> {
    if (options.lockNetwork && !manifest.permissions.includes("network")) lockNetwork();
    const url = (options.moduleUrl ?? blobUrl)(source);
    try {
      const module = await import(/* @vite-ignore */ url);
      if (typeof module.default !== "function") return { error: "The module has no default export function." };
      await module.default(editor);
      return {};
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  port.addEventListener("message", (e) => void onMessage(e));
  return editor;
}

function toOutcome(value: unknown): ToolOutcome {
  if (typeof value === "string") return { text: value };
  if (value && typeof value === "object" && "text" in value && typeof (value as ToolOutcome).text === "string") {
    return { text: (value as ToolOutcome).text, isError: Boolean((value as ToolOutcome).isError) };
  }
  return { text: value === undefined ? "" : JSON.stringify(value, null, 2) };
}

function blobUrl(source: string): string {
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

/**
 * Takes the network APIs away from an extension that didn't ask for them.
 * This keeps honest extensions honest; a determined one could still reach
 * the network through import(). Extensions run only after you allow them.
 */
function lockNetwork() {
  const scope = globalThis as Record<string, unknown>;
  for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "importScripts"]) {
    for (let target: object | null = scope; target; target = Object.getPrototypeOf(target)) {
      if (Object.prototype.hasOwnProperty.call(target, name)) {
        try {
          Object.defineProperty(target, name, { value: undefined, configurable: false, writable: false });
        } catch {
          // Not configurable here; leave it.
        }
      }
    }
  }
}
