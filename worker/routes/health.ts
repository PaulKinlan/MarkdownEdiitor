import { defineRoutes } from "../route";
import { parseReports, readLimited } from "../observability/ingest";
import { observability } from "./observability";

export default defineRoutes(
  // Unauthenticated: the page compares `commit` with its own build to spot a new deploy,
  // and KILL_SW=1 tells installed copies to drop their service worker and caches.
  {
    pattern: /^\/api\/health$/,
    public: true,
    handle: ({ env }) => Response.json({ ok: true, commit: env.COMMIT ?? "dev", killSw: env.KILL_SW === "1" }, { headers: { "Cache-Control": "no-store" } }),
  },
  // Unauthenticated too: browsers send CSP and Reporting API reports without credentials.
  // CSP reports, Reporting API batches and the page's own error and Web Vitals beacons.
  {
    method: "POST",
    pattern: /^\/api\/reports$/,
    public: true,
    async handle({ request, env }) {
      const text = await readLimited(request);
      if (text === null) return Response.json({ error: "Too large" }, { status: 413 });
      const events = parseReports(text, request.headers.get("Content-Type") ?? "");
      if (events.length) {
        const client = request.headers.get("CF-Connecting-IP") ?? "unknown";
        await observability(env).record(events, client, env.COMMIT ?? "dev");
      }
      return new Response(null, { status: 204 });
    },
  },
);
