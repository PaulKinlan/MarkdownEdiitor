import type { Env } from "../env";
import { defineRoutes } from "../route";

export function observability(env: Env) {
  return env.OBSERVABILITY.get(env.OBSERVABILITY.idFromName("global"));
}

export default defineRoutes(
  { method: "GET", pattern: /^\/api\/observability\/summary$/, handle: async ({ env }) => Response.json(await observability(env).summary()) },
  {
    method: "GET",
    pattern: /^\/api\/observability\/errors$/,
    async handle({ url, env }) {
      const since = Number(url.searchParams.get("since") ?? 0) || 0;
      const limit = Number(url.searchParams.get("limit") ?? 100) || 100;
      return Response.json(await observability(env).errors(since, limit));
    },
  },
);
