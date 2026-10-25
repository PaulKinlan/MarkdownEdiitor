# Hugo Editor

A markdown editor for Hugo blogs (built for [aifoc.us](https://aifoc.us) and [paul.kinlan.me](https://paul.kinlan.me)). It runs in the browser, is hosted on Cloudflare Workers, and edits the site folders on your machine directly through the File System Access API.

## What it does

| | |
| --- | --- |
| [The editor](docs/features/editor.md) | Local Hugo site folders, CodeMirror, a front matter form with minimal-diff saves, new posts from section templates, images, safe saves, and a live preview from your `hugo server`. |
| [The assistant](docs/features/assistant.md) | Pi Durable agents per post and per site, any model with a key, quick edits, skills (built in, from the site folder or GitHub), research notes, web search, MCP servers and HTTP tools. The model loop runs on the agent server or on the device, and other agents can read the site over MCP. |
| [Extensions](docs/features/extensions.md) | Pi-style extensions in Web Workers: commands, toolbar buttons, status items, underlines, panels, and agent tools, skills and hooks. The API is in [docs/extensions.md](docs/extensions.md). |
| [Chrome features](docs/features/chrome.md) | On-device model, Summarizer drafts, folder watching, WebMCP tools and a spell check dictionary, where Chrome has them. |
| [Installing it as an app](docs/features/pwa.md) | Offline PWA with updates on demand, file handling and share target. |
| [Security and telemetry](docs/features/security.md) | Permissions-Policy, CSP with Trusted Types, and the Observability Durable Object. |
| [Deploys and branch previews](docs/features/deploys.md) | `main` deploys to Cloudflare; every branch gets its own preview Worker. |

## Adding to it

A feature should be a folder or a file, not an edit to a shared list:

- a built-in skill: `src/skills/<name>/SKILL.md`
- a built-in quick edit: `src/quick-edits/<id>.md`
- a built-in extension: `src/extensions/builtin/<id>.js`
- a feature that runs in the page (side tab, settings, dialog, commands, services): `src/modules/<id>/module.ts` (see [docs/modules.md](docs/modules.md))
- an `/api` endpoint: `worker/routes/<area>.ts`
- a kind of assistant: `worker/agent/profiles/<kind>.ts`
- an agent backend (where the model loop runs): `src/modules/assistant/backends/<id>.ts`
- its documentation: `docs/features/<name>.md`, linked from the table above

See `AGENTS.md` for the rest of the rules.

## Running it

```sh
npm install
npm run dev        # Vite dev server at http://localhost:5173 (proxies /api to :8787)
npm run dev:worker # the Worker and Durable Objects at http://localhost:8787
npm test           # unit tests (front matter, permalinks, templates)
npm run typecheck
npm run gate       # typecheck, tests, build, discovery files and the performance budget
npm run deploy     # build and deploy to Cloudflare Workers
```

## Layout

```
src/lib/frontmatter.ts   Post parsing and minimal-diff front matter edits (YAML/TOML/JSON)
src/lib/hugo.ts          Hugo config, permalinks, shortcode discovery
src/lib/posts.ts         Post index and new-post templates
src/lib/fs.ts            File System Access helpers
src/lib/sites.ts         Persisted directory handles and permissions
src/components/          Lit elements: app shell, editor, front matter form, command palette
src/core/modules.ts      The module API: Shell, ModuleContext, Services, Contributions
src/modules/<id>/        One first-party module each: hugo-preview, spelling, images, webmcp, assistant
src/modules/assistant/   The assistant: agent panel, skills and tools dialogs, connections, search index, backends/
src/lib/agent-client.ts  WebSocket client for agent sessions, settings
src/lib/actions.ts       Quick edits: the built-in ones (src/quick-edits/) and the author's own
src/quick-edits/<id>.md  One built-in quick edit each (front matter: name, scope, order)
src/lib/site-skills.ts   Loads, installs and removes SKILL.md folders in the site
src/lib/skill-install.ts Finds and downloads skills from GitHub; skills installed in the browser
src/shared/skills.ts     The skill format (SKILL.md parsing, merging, scopes)
src/skills/<name>/SKILL.md  One built-in skill each (an `order` key sets its place)
src/shared/builtin-skills.ts  Loads them (via a generated registry the Worker can import too)
scripts/registries.mjs   Writes the gitignored *.gen.ts registries; npm's pre-scripts and Vite run it
src/lib/indexer.ts       Syncs the site's posts to the search index
src/lib/pwa.ts           Service worker registration and updates, file/share/shortcut launches
src/sw/service-worker.ts Service worker (built to dist/sw.js by the plugin in vite.config.ts)
public/                  Web app manifest, icons, Cloudflare _headers
src/shared/protocol.ts   Messages between the editor and agent sessions
worker/index.ts          Cloudflare Worker: app assets, auth and CORS, and the router over worker/routes
worker/route.ts          The Route type (defineRoutes, findRoute)
worker/routes/           One file per area of /api, collected into the gitignored routes.gen.ts
worker/mcp-server.ts     Serves Pi tools as an MCP server; worker/routes/mcp.ts offers the site's read-only tools at /api/mcp/sites/<id>
worker/feature-store.ts  FeatureStore Durable Object: JSON values per feature and scope, so features need no class of their own
worker/agent/conversation.ts  Base class for both sessions: Pi Durable harness, WebSocket, alarms; the Profile type
worker/agent/profiles/   One file per kind of assistant (post, site): its context, Pi extensions and extra messages
worker/agent/session.ts  AgentSession Durable Object (one conversation per post)
worker/agent/site-session.ts  SiteSession Durable Object (one conversation per site)
worker/agent/writing.ts  The writing extension (post assistant): tools and system prompt sections
worker/agent/site.ts     The site extension (site assistant): tools over every post, multi-file changes
worker/agent/library.ts  search_posts, web_search and fetch_url, shared by both
worker/agent/skills.ts   The skills extension: skill catalog section and load_skill (both scopes)
worker/agent/research.ts calculate, table_stats and browser_support (both scopes)
worker/agent/post-stats.ts  analyze_post
worker/agent/site-index.ts  SiteIndex Durable Object (SQLite FTS5, full files and front matter)
worker/agent/extension-bridge.ts  Editor extensions as Pi Durable extensions (tools, sections, hooks forwarded to the editor)
worker/extension-store.ts  ExtensionStore Durable Object (the author's installed extensions)
src/extensions/          Extension host (page), runtime (worker), library, loader
src/extensions/builtin/  One built-in extension per .js file (manifest `order` sets its place)
docs/extensions.md       The extension API (also the assistant's write-extension skill)
src/shared/tools.ts      Tool settings shared by the editor and the Worker: MCP servers, HTTP tools, presets
worker/tools/            The tool registry both sessions install: ToolStore Durable Object, MCP client,
                         HTTP tools, and the providers' native web tools (installConfiguredTools, addNativeWebTools)
```

## Plan

1. **Editor** (done): local folders, editing, front matter, live Hugo preview.
2. **Agents** (done). Pi Durable harnesses in Durable Objects, one per post conversation. Configurable models (Claude, DeepSeek, …). Tools for web search, search across past posts, and grammar/style edits returned as diffs to accept. User-defined edits.
3. **Demos, ACP and publishing.** A builder for aifoc.us-style inline demos and infographics, and ACP connections to external agent harnesses. Also git commit/push and an optional hosted preview. Running ACP, git and `hugo server` from the browser goes through a small local helper app.
