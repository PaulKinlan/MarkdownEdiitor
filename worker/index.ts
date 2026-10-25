import type { IndexedPost } from "../src/shared/protocol";
import type { Env } from "./env";
import { createConfiguredModels, listModels } from "./agent/models";
import { parseReports, readLimited } from "./observability/ingest";

export { AgentSession } from "./agent/session";
export { SiteIndex } from "./agent/site-index";
export { SiteSession } from "./agent/site-session";
export { Observability } from "./observability/store";

// The editor runs in the browser against local folders. The Worker serves the
// built app and the agent API: one AgentSession Durable Object per post
// conversation, one SiteSession per site for the site-wide assistant, and one
// SiteIndex per site for searching and reading past posts.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const cors = corsHeaders(request, env);
    // Preflights carry no Authorization header, so answer them before checking the token.
    if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors });
    const response = await route(request, url, env);
    if (response.webSocket) return response;
    const withHeaders = new Response(response.body, response);
    for (const [k, v] of Object.entries({ ...API_HEADERS, ...cors })) withHeaders.headers.set(k, v);
    return withHeaders;
  },
} satisfies ExportedHandler<Env>;

/** API responses are data, never documents: nothing in them may run or be framed. */
const API_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

async function route(request: Request, url: URL, env: Env): Promise<Response> {
    // Unauthenticated: the page compares `commit` with its own build to spot a new deploy,
    // and KILL_SW=1 tells installed copies to drop their service worker and caches.
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, commit: env.COMMIT ?? "dev", killSw: env.KILL_SW === "1" }, { headers: { "Cache-Control": "no-store" } });
    }
    // Unauthenticated too: browsers send CSP and Reporting API reports without credentials.
    if (url.pathname === "/api/reports" && request.method === "POST") return collectReports(request, env);
    if (!authorised(request, url, env)) return Response.json({ error: "Unauthorised" }, { status: 401 });

    if (url.pathname === "/api/observability/summary" && request.method === "GET") {
      return Response.json(await observability(env).summary());
    }
    if (url.pathname === "/api/observability/errors" && request.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? 0) || 0;
      const limit = Number(url.searchParams.get("limit") ?? 100) || 100;
      return Response.json(await observability(env).errors(since, limit));
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      return Response.json({
        models: listModels(createConfiguredModels(env)),
        webSearch: Boolean(env.BRAVE_API_KEY || env.TAVILY_API_KEY),
      });
    }

    // /api/sessions/:id/ws, where id names one conversation (site + post).
    let m = decodeURIComponent(url.pathname).match(/^\/api\/sessions\/([\w:-]{1,2048})\/ws$/);
    if (m) {
      const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(m[1]));
      return stub.fetch(request);
    }

    // /api/sites/:siteId/session/ws: the site-wide assistant.
    m = url.pathname.match(/^\/api\/sites\/([\w-]{1,100})\/session\/ws$/);
    if (m) {
      const stub = env.SITE_SESSION.get(env.SITE_SESSION.idFromName(m[1]));
      return stub.fetch(request);
    }

    // /api/sites/:siteId/index/(sync|upload)
    m = url.pathname.match(/^\/api\/sites\/([\w-]{1,100})\/index\/(sync|upload)$/);
    if (m && request.method === "POST") {
      const index = env.SITE_INDEX.get(env.SITE_INDEX.idFromName(m[1]));
      if (m[2] === "sync") {
        const manifest = (await request.json()) as { path: string; lastModified: number }[];
        return Response.json({ stale: await index.sync(manifest) });
      }
      const posts = (await request.json()) as IndexedPost[];
      return Response.json({ count: await index.upsert(posts) });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
}

function observability(env: Env) {
  return env.OBSERVABILITY.get(env.OBSERVABILITY.idFromName("global"));
}

/** POST /api/reports: CSP reports, Reporting API batches and the page's own error and Web Vitals beacons. */
async function collectReports(request: Request, env: Env): Promise<Response> {
  const text = await readLimited(request);
  if (text === null) return Response.json({ error: "Too large" }, { status: 413 });
  const events = parseReports(text, request.headers.get("Content-Type") ?? "");
  if (events.length) {
    const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
    await observability(env).record(events, client, env.COMMIT ?? "dev");
  }
  return new Response(null, { status: 204 });
}

/**
 * CORS for editors served from another origin (Assistant settings → Agent
 * server). Only origins listed in ALLOWED_ORIGINS get headers; same-origin
 * requests need none. WebSockets aren't subject to CORS and use ?token=.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> | undefined {
  const origin = request.headers.get("Origin");
  if (!origin || origin === new URL(request.url).origin) return undefined;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim());
  if (!allowed.includes(origin) && !allowed.includes("*")) return undefined;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function authorised(request: Request, url: URL, env: Env): boolean {
  if (!env.EDITOR_TOKEN) return true;
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
  return token === env.EDITOR_TOKEN;
}
