# The Worker

One Cloudflare Worker serves the built editor and the `/api` routes (`worker/index.ts`). Everything that isn't `/api/…` is a static asset. The agent conversations it hosts are in [agents.md](agents.md).

## Routes

An endpoint is a `Route` in a file in `worker/routes/`, which default-exports `defineRoutes(...)` (`worker/route.ts`). `scripts/registries.mjs` collects the files into the gitignored `worker/routes.gen.ts`, so a new endpoint never edits `worker/index.ts`.

```ts
export default defineRoutes({
  method: "GET",                       // or a list; any method when left out
  pattern: /^\/api\/git\/([\w-]+)$/,   // anchored; groups arrive as `match`
  decode: false,                       // match against the decoded path
  public: false,                       // true: answered without the editor token
  handle: ({ request, url, env, match }) => Response.json({ site: match[1] }),
});
```

The router picks the first route whose method and pattern match. Every route needs the editor token (`Authorization: Bearer <EDITOR_TOKEN>`, or `?token=` for WebSockets) unless it's `public`, and an unknown path without the token is a 401 rather than a 404. Responses get a `default-src 'none'` CSP, and CORS headers only for origins in `ALLOWED_ORIGINS`.

| File | Endpoints |
| --- | --- |
| `config.ts` | `GET /api/config`: the models the Worker has keys for, and whether web search is set up |
| `sessions.ts` | `/api/sessions/<id>/ws` (a post conversation), `/api/sites/<id>/session/ws` (the site conversation), `POST /api/sites/<id>/index/sync` and `…/upload` (the site's search index) |
| `tools.ts` | `GET`, `PUT /api/tools` (MCP and HTTP tool settings, secrets masked), `POST /api/tools/mcp/discover` |
| `extensions.ts` | `GET /api/extensions`, `PUT` and `DELETE /api/extensions/<id>` (the extension library) |
| `features.ts` | `/api/features/<feature>/<scope>[/<key>]`: list (`?prefix=`), `GET`, `PUT`, `DELETE` a FeatureStore value |
| `mcp.ts` | `/api/mcp/sites/<id>`: the site's read-only tools as an MCP server |
| `observability.ts` | `GET /api/observability/summary`, `GET /api/observability/errors` |
| `health.ts` | `/api/health` (public: the deployed commit and the service worker kill switch), `POST /api/reports` (public: CSP reports, errors, Web Vitals) |

## Durable Objects

| Class | Binding | One per | Holds |
| --- | --- | --- | --- |
| `AgentSession` | `AGENT_SESSION` | post | a post conversation (`worker/agent/session.ts`) |
| `SiteSession` | `SITE_SESSION` | site | the site conversation (`worker/agent/site-session.ts`) |
| `SiteIndex` | `SITE_INDEX` | site | the site's posts and notes, with full-text search (`worker/agent/site-index.ts`) |
| `ToolStore` | `TOOL_STORE` | editor | the author's MCP and HTTP tools (`worker/tools/store.ts`) |
| `ExtensionStore` | `EXTENSION_STORE` | editor | installed extensions, with tombstones for removed ones (`worker/extension-store.ts`) |
| `Observability` | `OBSERVABILITY` | editor | error and CSP reports and Web Vitals (`worker/observability/store.ts`) |
| `FeatureStore` | `FEATURE_STORE` | feature and scope | JSON values by key, for any feature (`worker/feature-store.ts`) |

A new class needs an ADR, and its migration in `wrangler.jsonc` lands on `main` on its own first, with a tag named `YYYY-MM-DD-<feature>`. Never rename or reorder existing tags.

### FeatureStore

So a feature doesn't need a class of its own, it keeps its data in a `FeatureStore`:

```ts
const store = featureStore(env, "git", siteId);   // one instance per feature and scope ("global" by default)
await store.put("last-push", { at: Date.now() });
await store.get("last-push");                     // { key, value, updatedAt } or null
await store.list("last-");                        // [{ key, updatedAt }], in key order, up to 1,000
await store.delete("last-push");
```

From the browser, the same is `/api/features/<feature>/<scope>/<key>`. Feature names are lowercase letters, digits and dashes; keys are up to 512 characters and values up to 1 MB of JSON.

## Registries

A feature is a folder or a file, never an edit to a shared list. Front-end code finds files with `import.meta.glob`; code the Worker needs gets a generated registry from `scripts/registries.mjs`, which npm's pre-scripts and the Vite plugin run. Generated files (`*.gen.ts`) are gitignored.

| Add | Found by |
| --- | --- |
| `src/modules/<id>/module.ts` | `import.meta.glob` in `src/core/load-modules.ts` |
| `src/modules/assistant/backends/<id>.ts` | `import.meta.glob` in `src/modules/assistant/backend.ts` |
| `src/extensions/builtin/<id>.js` | `import.meta.glob` in `src/extensions/builtin/index.ts` |
| `src/quick-edits/<id>.md` | `import.meta.glob` in `src/lib/actions.ts` |
| `src/skills/<name>/SKILL.md` | `scripts/registries.mjs` → `src/shared/builtin-skills.gen.ts` |
| `worker/routes/<area>.ts` | `scripts/registries.mjs` → `worker/routes.gen.ts` |
| `worker/agent/profiles/<kind>.ts` | imported by its Durable Object class |

Order comes from an `order` value in the file itself, lower first.
