import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createRegistry, Harness, type Conversation, type Extension, type Registry, type Wake } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { DurableObjectSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import type { ClientToServer, ModelRef, PostContext, ServerToClient, SiteContext } from "../../src/shared/protocol";
import type { ExtensionCall, ExtensionCallResults } from "../../src/shared/extensions";
import { ExtensionBridge } from "./extension-bridge";
import { mergeSkills, type Skill } from "../../src/shared/skills";
import type { ToolSettings } from "../../src/shared/tools";
import type { Env } from "../env";
import { addNativeWebTools, installConfiguredTools, loadToolSettings } from "../tools";
import { createConfiguredModels } from "./models";
import { projectView } from "./view";

const HEARTBEAT_MS = 60_000;

type Contexts = { post: PostContext; site: SiteContext };

/**
 * One durable agent conversation, shared by the per-post and the site-wide
 * assistants. The editor talks to it over a hibernatable WebSocket: it sends
 * its context (the post, or the site) and prompts, and gets the chat view back
 * after each commit. Edits go back to the editor as proposals; the editor
 * writes files.
 *
 * Subclasses pick which context message they accept and which extensions
 * (tools and prompt sections) the agent gets.
 */
export abstract class ConversationObject<K extends keyof Contexts> extends DurableObject<Env> {
  protected harness!: Harness;
  protected root!: Conversation;
  protected database: DurableObjectSqliteDatabase;
  /** The latest context the editor sent; persisted so tools work after an eviction. */
  protected current?: Contexts[K];
  /** Skills beyond the built-in ones, sent separately from the context because they can be large. */
  protected skills: Skill[] = [];
  private lastView = "";
  private pending?: ReturnType<typeof setTimeout>;
  private latest: unknown;
  private registry!: Registry;
  private toolSettings?: ToolSettings;
  private toolExtensions: Extension[] = [];
  private bridge!: ExtensionBridge;
  /** Calls waiting on an editor extension, by call id. */
  private calls = new Map<string, { ws: WebSocket; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(ctx: DurableObjectState, env: Env, private readonly kind: K, extensions: (self: ConversationObject<K>) => Extension[]) {
    super(ctx, env);
    this.database = new DurableObjectSqliteDatabase(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      // A fallback alarm before anything can throw, so a failed open is retried.
      const fallback = Date.now() + HEARTBEAT_MS;
      const current = await ctx.storage.getAlarm();
      if (current === null || current > fallback) await ctx.storage.setAlarm(fallback);

      await this.database.exec("CREATE TABLE IF NOT EXISTS editor_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const row = await this.database.get<{ value: string }>("SELECT value FROM editor_state WHERE key = ?", kind);
      if (row) this.current = JSON.parse(row.value);
      const skills = await this.database.get<{ value: string }>("SELECT value FROM editor_state WHERE key = 'skills'");
      if (skills) this.skills = JSON.parse(skills.value);

      const registry = (this.registry = createRegistry());
      const builtin = extensions(this);
      for (const extension of builtin) registry.install(extension);
      await this.refreshTools();
      // Editor extensions, installed again from their last manifest so pending calls to their tools can resume.
      this.bridge = new ExtensionBridge(registry, { call: (call, timeoutMs) => this.callEditor(call, timeoutMs) }, {
        scope: kind,
        reserved: new Set(builtin.flatMap((e) => (e.tools ?? []).map((t) => t.name))),
      });
      const saved = await this.database.get<{ value: string }>("SELECT value FROM editor_state WHERE key = 'extensions'");
      if (saved) this.bridge.sync(JSON.parse(saved.value));
      const storage = await SqliteStorage.open(this.database, { prefix: "pi_" });
      this.harness = await Harness.open(
        storage,
        {
          models: addNativeWebTools(createConfiguredModels(env), () => this.toolSettings?.nativeWebTools ?? true),
          registry,
          identity: { attribution: { name: "hugo-editor", url: "https://github.com/PaulKinlan/MarkdownEdiitor" } },
          onWake: (wake) => void this.arm(wake).catch(() => ctx.abort("Alarm write failed")),
        },
        context,
      );
      this.root = await this.harness.root(context);
      await this.arm(this.harness.wake());
      this.harness.resume();
      const view = await this.root.viewState(context);
      view.subscribe(() => this.scheduleBroadcast(view.value));
    });
  }

  /** Skills sent with a `skills` message, then any that came with the context (older editors, extensions). */
  protected allSkills(): Skill[] {
    return mergeSkills(this.skills, this.current?.skills);
  }

  /** The SiteIndex for the site in the current context. */
  protected index(siteId: string | undefined) {
    return siteId ? this.env.SITE_INDEX.get(this.env.SITE_INDEX.idFromName(siteId)) : undefined;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    this.lastView = "";
    this.send(server, projectView((await this.root.viewState(context)).value as never));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let message: ClientToServer;
    try {
      message = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { type: "error", message: "Malformed message" });
    }
    try {
      switch (message.type) {
        case "post":
        case "site":
          if (message.type !== this.kind) return this.send(ws, { type: "error", message: `This session takes ${this.kind} context, not ${message.type}.` });
          await this.setContext((message.type === "post" ? message.post : message.site) as Contexts[K]);
          break;
        case "skills":
          this.skills = message.skills;
          await this.database.run(
            "INSERT INTO editor_state (key, value) VALUES ('skills', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            JSON.stringify(message.skills),
          );
          break;
        case "prompt":
          await this.prompt(message.text, message.model, message.requestId, message.label);
          break;
        case "abort":
          await this.root.abort(context);
          break;
        case "extensions": {
          // The newest editor to describe its extensions is the one that runs them.
          ws.serializeAttachment({ extensionsAt: Date.now() });
          const problems = this.bridge.sync(message.extensions);
          await this.database.run(
            "INSERT INTO editor_state (key, value) VALUES ('extensions', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            JSON.stringify(message.extensions),
          );
          if (problems.length) this.send(ws, { type: "error", message: problems.join("\n") });
          break;
        }
        case "extension_result": {
          const pending = this.calls.get(message.callId);
          if (!pending) break;
          this.calls.delete(message.callId);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message.value);
          else pending.reject(new Error(message.error || "The extension failed."));
          break;
        }
        case "reset":
          await this.arm({ ...this.harness.wake(), active: true });
          await this.root.reset(undefined, context);
          break;
      }
    } catch (e) {
      this.send(ws, { type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  webSocketClose(ws: WebSocket) {
    for (const [id, pending] of this.calls) {
      if (pending.ws !== ws) continue;
      this.calls.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new Error("The editor closed before the extension answered."));
    }
  }

  /** Asks the editor that last sent its extensions to run a tool or hook. */
  private callEditor<C extends ExtensionCall>(call: C, timeoutMs: number): Promise<ExtensionCallResults[C["kind"]]> {
    const ws = this.ctx
      .getWebSockets()
      .map((socket) => ({ socket, at: (socket.deserializeAttachment() as { extensionsAt?: number } | null)?.extensionsAt ?? 0 }))
      .filter((s) => s.at > 0)
      .sort((a, b) => b.at - a.at)[0]?.socket;
    if (!ws) return Promise.reject(new Error("The editor isn't open, so its extensions can't run. Ask the author to open it."));
    const callId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(callId);
        reject(new Error(`The extension didn't answer within ${Math.round(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.calls.set(callId, { ws, resolve: resolve as (value: unknown) => void, reject, timer });
      this.send(ws, { type: "extension_call", callId, call });
    });
  }

  async alarm() {
    await this.arm({ ...this.harness.wake(), active: true });
    this.harness.resume();
  }

  private async setContext(value: Contexts[K]) {
    this.current = value;
    await this.database.run(
      "INSERT INTO editor_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      this.kind,
      JSON.stringify(value),
    );
  }

  private async prompt(text: string, model: ModelRef, requestId: string, label?: string) {
    const current = (await this.root.agent(context)).model;
    if (!current || current.provider !== model.provider || current.modelId !== model.modelId) {
      await this.root.configure({ model }, context);
    }
    await this.refreshTools();
    // Arm before any call that can start work; a missing alarm would strand it after an eviction.
    await this.arm({ ...this.harness.wake(), active: true });
    await this.root.submit(
      { type: "input", content: text, requestId, ...(label ? { entry: { kind: "editor.prompt", data: { label } } } : {}) },
      context,
    );
  }

  /** Installs the author's MCP and HTTP tools (worker/tools), picking up changes since the last prompt. A settings outage keeps the tools we had. */
  private async refreshTools() {
    try {
      this.toolSettings = await loadToolSettings(this.env);
    } catch {
      return;
    }
    this.toolExtensions = installConfiguredTools(this.registry, this.toolSettings, this.toolExtensions);
  }

  private async arm(wake: Wake) {
    const heartbeat = wake.active ? Date.now() + HEARTBEAT_MS : undefined;
    const at = heartbeat === undefined || wake.at === undefined ? (heartbeat ?? wake.at) : Math.min(heartbeat, wake.at);
    if (at === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** Coalesces commits (partial answers commit every 100 ms) into at most one frame every 80 ms. */
  private scheduleBroadcast(value: unknown) {
    this.latest = value;
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      const view = projectView(this.latest as never);
      const json = JSON.stringify(view);
      if (json === this.lastView) return;
      this.lastView = json;
      for (const ws of this.ctx.getWebSockets()) ws.send(json);
    }, 80);
  }

  private send(ws: WebSocket, message: ServerToClient) {
    ws.send(JSON.stringify(message));
  }
}
