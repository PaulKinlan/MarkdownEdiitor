import type { ClientToServer, ModelInfo, PostContext, ServerToClient } from "../shared/protocol";

const SETTINGS_KEY = "md-editor:agent-settings";

export interface AgentSettings {
  /** Base URL of the Worker serving the agent API; empty means this origin. */
  server: string;
  token: string;
  model?: string; // "provider/modelId"
}

export function loadAgentSettings(): AgentSettings {
  try {
    return { server: "", token: "", ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { server: "", token: "" };
  }
}

export function saveAgentSettings(settings: AgentSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function apiUrl(settings: AgentSettings, path: string): URL {
  return new URL(path, settings.server || location.origin);
}

async function api<T>(settings: AgentSettings, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(settings, path), {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}) },
  });
  if (res.status === 401) throw new Error("The agent server needs an access token (Assistant settings).");
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function fetchAgentConfig(settings: AgentSettings) {
  return api<{ models: ModelInfo[]; webSearch: boolean }>(settings, "/api/config");
}

export function syncManifest(settings: AgentSettings, siteId: string, manifest: { path: string; lastModified: number }[]) {
  return api<{ stale: string[] }>(settings, `/api/sites/${siteId}/index/sync`, { method: "POST", body: JSON.stringify(manifest) });
}

export function uploadPosts(settings: AgentSettings, siteId: string, posts: unknown[]) {
  return api<{ count: number }>(settings, `/api/sites/${siteId}/index/upload`, { method: "POST", body: JSON.stringify(posts) });
}

export function sessionId(siteId: string, path: string): string {
  return `${siteId}:${path.replace(/[^\w.-]+/g, "-")}`.slice(0, 200);
}

type ViewMessage = Extract<ServerToClient, { type: "view" }>;

/**
 * A WebSocket to one AgentSession. Reconnects with backoff, and re-sends the
 * post context on every (re)connect, since the session may have been evicted.
 */
export class AgentConnection extends EventTarget {
  view?: ViewMessage;
  status: "connecting" | "open" | "closed" = "connecting";
  private ws?: WebSocket;
  private retry = 0;
  private closed = false;
  private post?: PostContext;
  private postTimer?: ReturnType<typeof setTimeout>;

  constructor(private settings: AgentSettings, readonly id: string) {
    super();
    this.connect();
  }

  private connect() {
    const url = apiUrl(this.settings, `/api/sessions/${encodeURIComponent(this.id)}/ws`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (this.settings.token) url.searchParams.set("token", this.settings.token);
    this.status = "connecting";
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.status = "open";
      if (this.post) this.send({ type: "post", post: this.post });
      this.changed();
    };
    ws.onmessage = (e) => {
      const message = JSON.parse(e.data) as ServerToClient;
      if (message.type === "view") {
        this.view = message;
        this.changed();
      } else {
        this.dispatchEvent(new CustomEvent("error", { detail: message.message }));
      }
    };
    ws.onclose = () => {
      this.status = "closed";
      this.changed();
      if (this.closed) return;
      const delay = Math.min(30_000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.closed && this.connect(), delay);
    };
  }

  /** Debounced: typing in the editor sends the text at most every 750 ms. */
  updatePost(post: PostContext) {
    this.post = post;
    clearTimeout(this.postTimer);
    this.postTimer = setTimeout(() => this.send({ type: "post", post }), 750);
  }

  /** Sends the latest post immediately, then the prompt, so the agent reads what is on screen. */
  prompt(text: string, model: { provider: string; modelId: string }, label?: string) {
    clearTimeout(this.postTimer);
    if (this.post) this.send({ type: "post", post: this.post });
    this.send({ type: "prompt", text, model, label, requestId: crypto.randomUUID() });
  }

  abort() {
    this.send({ type: "abort" });
  }

  reset() {
    this.send({ type: "reset" });
  }

  close() {
    this.closed = true;
    clearTimeout(this.postTimer);
    this.ws?.close();
  }

  private send(message: ClientToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
    else this.dispatchEvent(new CustomEvent("error", { detail: "Not connected to the agent server." }));
  }

  private changed() {
    this.dispatchEvent(new Event("change"));
  }
}
