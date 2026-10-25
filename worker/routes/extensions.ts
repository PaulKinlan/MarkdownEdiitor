import type { Env } from "../env";
import { defineRoutes, type RouteContext } from "../route";

const store = (env: Env) => env.EXTENSION_STORE.get(env.EXTENSION_STORE.idFromName("library"));

/** Store errors (a bad manifest, say) are the caller's problem: 400. */
function guarded(handle: (context: RouteContext) => Promise<Response>) {
  return async (context: RouteContext) => {
    try {
      return await handle(context);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  };
}

// /api/extensions and /api/extensions/:id: the author's extension library.
export default defineRoutes(
  { method: "GET", pattern: /^\/api\/extensions$/, handle: guarded(async ({ env }) => Response.json(await store(env).list())) },
  {
    method: "PUT",
    pattern: /^\/api\/extensions\/([a-z][a-z0-9-]{0,62})$/,
    handle: guarded(async ({ request, env, match }) => {
      const body = (await request.json()) as { source?: unknown; from?: unknown; updatedAt?: unknown };
      if (typeof body.source !== "string") return Response.json({ error: "Expected { source }" }, { status: 400 });
      const at = typeof body.updatedAt === "number" ? body.updatedAt : undefined;
      return Response.json(await store(env).put(match[1], body.source, typeof body.from === "string" ? body.from : undefined, at));
    }),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/extensions\/([a-z][a-z0-9-]{0,62})$/,
    handle: guarded(async ({ url, env, match }) => {
      const at = Number(url.searchParams.get("at")) || undefined;
      return Response.json(await store(env).remove(match[1], at));
    }),
  },
);
