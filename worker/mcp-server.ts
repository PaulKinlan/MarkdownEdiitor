import { validateToolArguments } from "@earendil-works/pi-ai";
import type { ToolRegistration } from "@earendil-works/pi-durable";

// A minimal MCP server over Streamable HTTP, for other agents (Claude Code,
// Gemini CLI, an ACP harness) to use the editor's tools. It serves Pi tool
// definitions as they are, so a tool written for the assistant needs nothing
// more to be offered here. Stateless: every request is a JSON-RPC message
// POSTed to one endpoint and answered with JSON; there are no sessions,
// server-sent events or notifications to the client.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type Reply = { result: unknown } | { error: { code: number; message: string } };

export interface McpServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

/** Answers one MCP request (or a batch) with the given tools. */
export async function serveMcp(request: Request, tools: readonly ToolRegistration[], info: McpServerInfo): Promise<Response> {
  if (request.method !== "POST") return new Response("MCP over Streamable HTTP: POST JSON-RPC messages here.", { status: 405, headers: { Allow: "POST" } });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(failure(null, -32700, "Parse error"), { status: 400 });
  }
  const messages = Array.isArray(body) ? body : [body];
  const replies = [];
  for (const message of messages) {
    if (!isRequest(message)) {
      replies.push(failure(null, -32600, "Invalid request"));
      continue;
    }
    // Notifications (no id) get no reply.
    if (message.id === undefined) continue;
    const reply = await handle(message, tools, info);
    replies.push({ jsonrpc: "2.0", id: message.id, ...reply });
  }
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0]);
}

async function handle({ method, params = {} }: JsonRpcRequest, tools: readonly ToolRegistration[], info: McpServerInfo): Promise<Reply> {
  switch (method) {
    case "initialize": {
      const asked = String(params.protocolVersion ?? "");
      return {
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: info.name, version: info.version },
          ...(info.instructions ? { instructions: info.instructions } : {}),
        },
      };
    }
    case "ping":
      return { result: {} };
    case "tools/list":
      return { result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) } };
    case "tools/call":
      return { result: await call(tools, String(params.name ?? ""), params.arguments) };
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** Runs a tool. Problems with the call itself come back as a tool error, which the calling model can read and fix. */
async function call(tools: readonly ToolRegistration[], name: string, args: unknown) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return toolError(`No tool named ${name}. Call tools/list for the tools.`);
  let valid: unknown;
  try {
    valid = validateToolArguments(tool, { type: "toolCall", id: "mcp", name, arguments: (args ?? {}) as never });
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e));
  }
  try {
    // The editor's tools don't use the harness's execution API or context, which only exist inside a conversation.
    const result = await tool.execute(valid as never, {} as never, {} as never);
    const content = (result.output ?? []).filter((part) => part.type === "text" || part.type === "image");
    return { content, ...(result.isError ? { isError: true } : {}) };
  } catch (e) {
    return toolError(e instanceof Error ? e.message : String(e));
  }
}

function toolError(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

function failure(id: JsonRpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return typeof value === "object" && value !== null && (value as JsonRpcRequest).jsonrpc === "2.0" && typeof (value as JsonRpcRequest).method === "string";
}
