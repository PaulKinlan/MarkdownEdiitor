import type { ToolSettings } from "../../src/shared/tools";
import type { Env } from "../env";
import { defineRoutes } from "../route";
import { McpClient } from "../tools/mcp";
import { mergeHeaders } from "../tools/secrets";

const store = (env: Env) => env.TOOL_STORE.get(env.TOOL_STORE.idFromName("default"));

// Tool settings: MCP servers, HTTP API tools, native web tools. Secrets go in, never out.
export default defineRoutes(
  { method: "GET", pattern: /^\/api\/tools$/, handle: async ({ env }) => Response.json(await store(env).publicSettings()) },
  {
    method: "PUT",
    pattern: /^\/api\/tools$/,
    async handle({ request, env }) {
      // RPC typing can't see through the JSON Schema values, so name the result type here.
      const result = (await store(env).save((await request.json()) as ToolSettings)) as { settings?: ToolSettings; problems?: string[] };
      return Response.json(result, { status: result.problems ? 400 : 200 });
    },
  },
  // Connects to an MCP server and lists its tools. `id` names a saved server whose stored secrets fill masked headers.
  {
    method: "POST",
    pattern: /^\/api\/tools\/mcp\/discover$/,
    async handle({ request, env }) {
      const body = (await request.json()) as { url: string; headers?: Record<string, string>; id?: string };
      const headers = mergeHeaders(body.headers ?? {}, body.id ? await store(env).headersFor(body.id) : {});
      try {
        const target = new URL(body.url);
        if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("The MCP server URL must be http(s).");
        return Response.json({ tools: await new McpClient(target.href, headers).listTools() });
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
    },
  },
);
