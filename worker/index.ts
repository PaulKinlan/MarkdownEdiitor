import type { Env } from "./env";
import { findRoute } from "./route";
import { ROUTES } from "./routes.gen";

export { AgentSession } from "./agent/session";
export { SiteIndex } from "./agent/site-index";
export { SiteSession } from "./agent/site-session";
export { ToolStore } from "./tools/store";
export { ExtensionStore } from "./extension-store";
export { Observability } from "./observability/store";
export { FeatureStore } from "./feature-store";

// The editor runs in the browser against local folders. The Worker serves the
// built app and the /api routes, one file per area in worker/routes (collected
// by scripts/registries.mjs): agent sessions per post and per site, the site
// index, tools, extensions, feature storage and observability.
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
  const found = findRoute(ROUTES, request, url);
  // Without the token, an unknown path is unauthorised rather than missing, so paths can't be probed.
  if (!found?.route.public && !authorised(request, url, env)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  return found.route.handle({ request, url, env, match: found.match });
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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
