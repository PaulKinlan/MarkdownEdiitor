import { DurableObject } from "cloudflare:workers";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createRegistry, Harness, type Conversation, type Wake } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { DurableObjectSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import type { ClientToServer, ModelRef, PostContext, ServerToClient } from "../../src/shared/protocol";
import type { Env } from "../env";
import { createConfiguredModels } from "./models";
import { projectView } from "./view";
import { fetchReadable, webSearcher } from "./web";
import { createWritingExtension } from "./writing";

const HEARTBEAT_MS = 60_000;

/**
 * One agent conversation about one post, durable across restarts and
 * evictions. The editor talks to it over a hibernatable WebSocket: it sends
 * the post text and prompts, and gets the chat view back after each commit.
 * Post text lives here only as context; edits go back to the editor as
 * proposals, and the editor writes files.
 */
export class AgentSession extends DurableObject<Env> {
  private harness!: Harness;
  private root!: Conversation;
  private database: DurableObjectSqliteDatabase;
  private post?: PostContext;
  private lastView = "";
  private pending?: ReturnType<typeof setTimeout>;
  private latest: unknown;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.database = new DurableObjectSqliteDatabase(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      // A fallback alarm before anything can throw, so a failed open is retried.
      const fallback = Date.now() + HEARTBEAT_MS;
      const current = await ctx.storage.getAlarm();
      if (current === null || current > fallback) await ctx.storage.setAlarm(fallback);

      await this.database.exec("CREATE TABLE IF NOT EXISTS editor_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      const row = await this.database.get<{ value: string }>("SELECT value FROM editor_state WHERE key = 'post'");
      if (row) this.post = JSON.parse(row.value);

      const registry = createRegistry();
      registry.install(
        createWritingExtension({
          post: () => this.post,
          searchPosts: (query, limit) => this.index()?.search(query, limit) ?? Promise.resolve([]),
          readPastPost: async (path) => (await this.index()?.get(path)) ?? undefined,
          webSearch: webSearcher(env),
          fetchUrl: fetchReadable,
        }),
      );
      const storage = await SqliteStorage.open(this.database, { prefix: "pi_" });
      this.harness = await Harness.open(
        storage,
        {
          models: createConfiguredModels(env),
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
          this.post = message.post;
          await this.database.run(
            "INSERT INTO editor_state (key, value) VALUES ('post', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
            JSON.stringify(message.post),
          );
          break;
        case "prompt":
          await this.prompt(message.text, message.model, message.requestId, message.label);
          break;
        case "abort":
          await this.root.abort(context);
          break;
        case "reset":
          await this.arm({ ...this.harness.wake(), active: true });
          await this.root.reset(undefined, context);
          break;
      }
    } catch (e) {
      this.send(ws, { type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  async alarm() {
    await this.arm({ ...this.harness.wake(), active: true });
    this.harness.resume();
  }

  private async prompt(text: string, model: ModelRef, requestId: string, label?: string) {
    const current = (await this.root.agent(context)).model;
    if (!current || current.provider !== model.provider || current.modelId !== model.modelId) {
      await this.root.configure({ model }, context);
    }
    // Arm before any call that can start work; a missing alarm would strand it after an eviction.
    await this.arm({ ...this.harness.wake(), active: true });
    await this.root.submit(
      { type: "input", content: text, requestId, ...(label ? { entry: { kind: "editor.prompt", data: { label } } } : {}) },
      context,
    );
  }

  private index() {
    return this.post ? this.env.SITE_INDEX.get(this.env.SITE_INDEX.idFromName(this.post.siteId)) : undefined;
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
