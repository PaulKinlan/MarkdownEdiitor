import { featureStore, validFeatureName } from "../feature-store";
import { defineRoutes, type RouteContext } from "../route";

// /api/features/:feature/:scope[/:key]: JSON values a feature keeps on the
// server (see worker/feature-store.ts). GET without a key lists keys
// (?prefix=); with one it reads the value.
const BASE = String.raw`^\/api\/features\/([a-z][a-z0-9-]{0,62})\/([\w-]{1,100})`;

function store({ env, match }: RouteContext) {
  if (!validFeatureName(match[1], match[2])) throw new Error("Bad feature or scope.");
  return featureStore(env, match[1], match[2]);
}

async function guarded(context: RouteContext, run: () => Promise<Response>) {
  try {
    return await run();
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export default defineRoutes(
  {
    method: "GET",
    pattern: new RegExp(`${BASE}$`),
    handle: (c) => guarded(c, async () => Response.json(await store(c).list(c.url.searchParams.get("prefix") ?? ""))),
  },
  {
    method: "GET",
    pattern: new RegExp(`${BASE}\\/(.{1,512})$`),
    decode: true,
    handle: (c) =>
      guarded(c, async () => {
        const entry = await store(c).get(c.match[3]);
        return entry ? Response.json(entry) : Response.json({ error: "Not found" }, { status: 404 });
      }),
  },
  {
    method: "PUT",
    pattern: new RegExp(`${BASE}\\/(.{1,512})$`),
    decode: true,
    handle: (c) => guarded(c, async () => Response.json(await store(c).put(c.match[3], await c.request.json()))),
  },
  {
    method: "DELETE",
    pattern: new RegExp(`${BASE}\\/(.{1,512})$`),
    decode: true,
    handle: (c) => guarded(c, async () => Response.json({ deleted: await store(c).delete(c.match[3]) })),
  },
);
