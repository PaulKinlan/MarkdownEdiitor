import type { IndexedPost } from "../../src/shared/protocol";
import { defineRoutes } from "../route";

export default defineRoutes(
  // /api/sessions/:id/ws, where id names one conversation (site + post).
  {
    pattern: /^\/api\/sessions\/([\w:-]{1,2048})\/ws$/,
    decode: true,
    handle: ({ request, env, match }) => env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(match[1])).fetch(request),
  },
  // /api/sites/:siteId/session/ws: the site-wide assistant.
  {
    pattern: /^\/api\/sites\/([\w-]{1,100})\/session\/ws$/,
    handle: ({ request, env, match }) => env.SITE_SESSION.get(env.SITE_SESSION.idFromName(match[1])).fetch(request),
  },
  // /api/sites/:siteId/index/(sync|upload)
  {
    method: "POST",
    pattern: /^\/api\/sites\/([\w-]{1,100})\/index\/(sync|upload)$/,
    async handle({ request, env, match }) {
      const index = env.SITE_INDEX.get(env.SITE_INDEX.idFromName(match[1]));
      if (match[2] === "sync") {
        const manifest = (await request.json()) as { path: string; lastModified: number }[];
        return Response.json({ stale: await index.sync(manifest) });
      }
      const posts = (await request.json()) as IndexedPost[];
      return Response.json({ count: await index.upsert(posts) });
    },
  },
);
