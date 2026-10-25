import type { IndexedPost } from "../src/shared/protocol";
import type { Env } from "./env";
import { createConfiguredModels, listModels } from "./agent/models";

export { AgentSession } from "./agent/session";
export { SiteIndex } from "./agent/site-index";

// The editor runs in the browser against local folders. The Worker serves the
// built app and the agent API: one AgentSession Durable Object per post
// conversation, and one SiteIndex per site for searching past posts.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (url.pathname === "/api/health") return Response.json({ ok: true });
    if (!authorised(request, url, env)) return Response.json({ error: "Unauthorised" }, { status: 401 });

    if (url.pathname === "/api/config" && request.method === "GET") {
      return Response.json({
        models: listModels(createConfiguredModels(env)),
        webSearch: Boolean(env.BRAVE_API_KEY || env.TAVILY_API_KEY),
      });
    }

    // /api/sessions/:id/ws, where id names one conversation (site + post).
    let m = decodeURIComponent(url.pathname).match(/^\/api\/sessions\/([\w.:-]{1,200})\/ws$/);
    if (m) {
      const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(m[1]));
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
  },
} satisfies ExportedHandler<Env>;

function authorised(request: Request, url: URL, env: Env): boolean {
  if (!env.EDITOR_TOKEN) return true;
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("token");
  return token === env.EDITOR_TOKEN;
}
