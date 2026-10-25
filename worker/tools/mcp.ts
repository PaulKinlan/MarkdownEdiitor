import type { McpToolInfo } from "../../src/shared/tools";

const PROTOCOL_VERSION = "2025-06-18";

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  | { type: "resource_link"; uri: string; name?: string };

export interface McpCallResult {
  content: McpContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

/**
 * A minimal client for a remote MCP server over Streamable HTTP: JSON-RPC
 * requests POSTed to one endpoint, answered with JSON or an SSE stream.
 * Enough for tools/list and tools/call; it keeps the session id the server
 * hands out and initializes lazily. Servers that need OAuth aren't supported
 * yet: pass a token in a header instead.
 */
export class McpClient {
  private session?: string;
  private ready?: Promise<void>;
  private nextId = 1;

  constructor(
    private url: string,
    private headers: Record<string, string> = {},
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async listTools(): Promise<McpToolInfo[]> {
    await this.initialize();
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    do {
      const page = (await this.request("tools/list", cursor ? { cursor } : {})) as { tools?: McpToolInfo[]; nextCursor?: string };
      for (const t of page.tools ?? []) tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema ?? { type: "object" } });
      cursor = page.nextCursor;
    } while (cursor && tools.length < 500);
    return tools;
  }

  async callTool(name: string, args: unknown, signal?: AbortSignal): Promise<McpCallResult> {
    await this.initialize();
    return (await this.request("tools/call", { name, arguments: args ?? {} }, signal)) as McpCallResult;
  }

  private initialize(): Promise<void> {
    this.ready ??= (async () => {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "hugo-editor", version: "1.0.0" },
      });
      await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
    })().catch((e) => {
      this.ready = undefined;
      throw e;
    });
    return this.ready;
  }

  private async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const id = this.nextId++;
    const res = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
    const message = await readResponse(res, id);
    if (message.error) throw new Error(`MCP ${method} failed: ${message.error.message ?? JSON.stringify(message.error)}`);
    return message.result;
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<Response> {
    const res = await this.fetcher(this.url, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        ...(this.session ? { "Mcp-Session-Id": this.session } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
    const session = res.headers.get("Mcp-Session-Id");
    if (session) this.session = session;
    if (res.status === 401 || res.status === 403) throw new Error(`MCP server refused the request (${res.status}); check its token or headers.`);
    if (!res.ok && res.status !== 202) throw new Error(`MCP server returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
}

type RpcMessage = { id?: number | string; result?: unknown; error?: { code?: number; message?: string } };

/** Finds the reply to `id` in a JSON body or an SSE stream (which may carry notifications first). */
async function readResponse(res: Response, id: number): Promise<RpcMessage> {
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/event-stream")) {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += value;
        let end: number;
        while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, "");
          const data = event
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const found = pick(JSON.parse(data), id);
          if (found) return found;
        }
        if (done) break;
      }
    } finally {
      void reader.cancel().catch(() => {});
    }
    throw new Error("MCP server closed the stream without answering");
  }
  const found = pick(await res.json(), id);
  if (!found) throw new Error("MCP server sent no reply");
  return found;
}

function pick(payload: RpcMessage | RpcMessage[], id: number): RpcMessage | undefined {
  return (Array.isArray(payload) ? payload : [payload]).find((m) => m.id === id && ("result" in m || "error" in m));
}
