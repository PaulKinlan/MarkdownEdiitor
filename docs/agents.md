# The agent server

How the assistant is built: the conversations on the Worker, the tools they get, how editor extensions and the author's own tools reach them, and the backends the editor can talk to. What the assistant does for a writer is in [features/assistant.md](features/assistant.md); the hooks are in [hooks.md](hooks.md).

```
editor (browser)                                   Worker
───────────────                                    ──────
assistant panel ─▶ backend (src/modules/assistant/backends/)
                    ├─ pi ──── WebSocket ─────────▶ AgentSession (one per post)   ┐ ConversationObject
                    │                               SiteSession  (one per site)   ┘ + a Profile
                    │                                 └─ Pi Durable harness: profile extensions,
                    │                                    configured tools, ext:<id> per editor extension
                    └─ chrome-on-device (the Prompt API, in the page)
other agents ──── MCP (Streamable HTTP) ──────────▶ /api/mcp/sites/<id> (read-only tools over the SiteIndex)
```

## Conversations

Both assistants are one class, `ConversationObject` (`worker/agent/conversation.ts`), a Durable Object running a [Pi Durable](https://earendil.com/posts/pi-durable/) harness on its own SQLite storage. It survives reloads, deploys and evictions: an alarm keeps it alive while it works, and it resumes after a restart.

- `AgentSession` (`worker/agent/session.ts`): one conversation per post, at `/api/sessions/<session id>/ws`.
- `SiteSession` (`worker/agent/site-session.ts`): one per site, at `/api/sites/<site id>/session/ws`.

The editor sends its context (the post, or the site) on every connect and whenever it changes, and the conversation sends the chat view back after each commit, at most one frame every 80 ms. The model only proposes changes (`propose_edits`, `propose_changes`); the editor shows them for review and writes files.

### Profiles

What makes one assistant different from another is its profile, one file per kind in `worker/agent/profiles/`:

```ts
export interface Profile<K extends keyof Contexts> {
  kind: K;                                            // "post" or "site": the context message it takes
  extensions(self: ConversationObject<K>, env: Env): Extension[];   // its Pi Durable extensions
  messages?: { [type]: (self, message, ws) => … };   // handlers for feature message types (hooks.md)
}
```

| Profile | Context | Extensions |
| --- | --- | --- |
| `post` (`profiles/post.ts`) | `PostContext`: the post's text, path, URL, site rules, shortcodes | writing, research, skills (post scope) |
| `site` (`profiles/site.ts`) | `SiteContext`: content folder, sections, the open post, site rules | site, research, skills (site scope) |

`self` gives a profile the latest context (`self.context()`), the site's `SiteIndex` (`self.index()`), every skill (`self.allSkills()`) and `self.send(ws, message)`. To add tools or prompt sections to an assistant, add a Pi Durable extension to its profile. A new kind of assistant is a new profile and a class that extends `ConversationObject` with it; a new Durable Object class needs an ADR and a migration (see `AGENTS.md`).

## Built-in tools

Each Pi Durable extension is `defineExtension({ name, tools, sections, hooks })`, with tools from `defineTool({ name, description, parameters, replay?, execute })`.

| Extension | File | Tools | Assistants |
| --- | --- | --- | --- |
| writing | `worker/agent/writing.ts` | `read_post`, `propose_edits`, `read_past_post`, `analyze_post`, and from the library: `search_posts`, `web_search`, `fetch_url` | post |
| site | `worker/agent/site.ts` | `list_posts`, `list_terms`, `grep_posts`, `read_post`, `propose_changes`, and from the library: `search_posts`, `web_search`, `fetch_url` | site |
| research | `worker/agent/research.ts` | `calculate`, `table_stats`, `browser_support` | both |
| skills | `worker/agent/skills.ts` | `load_skill` | both |

- The library (`worker/agent/library.ts`) holds the search tools both assistants share. `web_search` is only there when the Worker has a search key (Brave, Tavily or DeepSeek); `fetch_url` uses DeepSeek Fetch with a DeepSeek key and reads the page itself without one (`worker/agent/web.ts`).
- Prompt sections: writing and site add `role` and `site` (and writing `post`); skills adds the catalog of every skill's name and description, so the model loads one with `load_skill` when it needs it.
- Tool names are reserved: an editor extension can't register a tool with a built-in tool's name.

## Skills and quick edits

- **Skills** are `SKILL.md` files: built in (`src/skills/<name>/SKILL.md`, compiled into `builtin-skills.gen.ts` for the Worker), from the site folder (`.agents/skills/`, `.claude/skills/`), installed from GitHub, or registered by extensions. The editor sends every non-built-in skill in a `skills` message; a later skill replaces an earlier one with the same name. `scope: post | site | both` decides which assistant sees it.
- **Quick edits** are prompts behind a button, one file each in `src/quick-edits/<id>.md` (front matter `name`, `scope`, `order`), plus the author's own and those extensions register with `editor.agent.registerEdit`. They run in the editor: a quick edit sends its prompt.

## The author's tools

Settings → Assistant → Tools and MCP servers configures tools every agent gets (`worker/tools/`):

- **MCP servers** (Streamable HTTP) and **HTTP API tools**, kept in the `ToolStore` Durable Object with their secrets. The browser only ever sees headers masked.
- `loadToolSettings(env)` reads them and `installConfiguredTools(registry, settings, previous)` installs one Pi Durable extension per enabled source (`tools:mcp:<id>`, `tools:http:<id>`), replacing what it installed last time. Conversations call it before each prompt. Any new agent can do the same.
- **Native web tools**: `addNativeWebTools(models, enabled)` gives Claude models Anthropic's server-side `web_search` and `web_fetch`, and OpenAI models their `web_search`, in place of the editor's `web_search` and `fetch_url`.

## Editor extensions in the agent

An editor extension with `agent` or `agent:hooks` adds tools, prompt sections and tool hooks to both assistants. The editor sends the enabled extensions' specs (`AgentExtensionSpec`: tools with their JSON Schemas and scope, sections, which hooks) in an `extensions` message, and `ExtensionBridge` (`worker/agent/extension-bridge.ts`) keeps one Pi Durable extension `ext:<id>` installed for each. Running one of its tools, or one of its hooks, is a call back to the editor (see [hooks.md](hooks.md#how-a-call-reaches-an-extension)), so they only work while the editor is open.

Limits: 32 extensions and 32 tools each, prompt sections up to 8,000 characters. Tools scoped to the other assistant are left out.

## Models

`createConfiguredModels(env)` (`worker/agent/models.ts`) offers every provider the Worker has a key for: Anthropic, DeepSeek, OpenAI, Google and OpenRouter (keys and secrets are listed in [features/assistant.md](features/assistant.md#agent-configuration)). With `DEMO_MODEL=1` a scripted faux model is added (`worker/agent/demo-model.ts`), which can call any tool with `/tool <name> {json}`. The editor picks the model per prompt.

## Backends

The assistant panel doesn't talk to the Worker directly: it talks to a backend, one file each in `src/modules/assistant/backends/` that default-exports `defineBackend()` (`src/modules/assistant/backend.ts`):

```ts
export interface AgentBackend {
  id: string;
  name: string;
  order?: number;          // place in the model picker
  server?: boolean;        // the agent server: the site index, extension library and server tools need it (at most one)
  providers?: string[];    // providers that are always this backend's
  models(settings): Promise<BackendListing>;              // { models, error?, webSearch? }
  connect(settings, sessionId): AgentLink;                // a conversation about one post
  connectSite?(settings, siteId): AgentConnection;        // one about the whole site, if it can
}
```

| Backend | File | |
| --- | --- | --- |
| `pi` | `backends/pi.ts` | The agent server (this Worker, or the one in Assistant settings). Every model it has a key for, the site index and every tool; post and site conversations. |
| `chrome-on-device` | `backends/chrome-on-device.ts` | Chrome's built-in model through the Prompt API: private and offline, one post at a time, and no tools beyond proposing edits. |

An `AgentLink` is what the panel sees: `view` (chat items, busy, usage), `status`, `updatePost`, `updateSkills`, `prompt`, `abort`, `reset`, `close`, and `setExtensions` for backends that can run extension tools. A new backend (an ACP harness through a local helper, say) is a new file implementing it.

## For other agents (MCP)

`/api/mcp/sites/<site id>` serves the site's read-only tools as an MCP server (`worker/routes/mcp.ts`, `worker/mcp-server.ts`): everything the site assistant has except `propose_changes`, `web_search` and `fetch_url`, plus `analyze_post` by path. `serveMcp` can serve any list of Pi tools.

## The protocol

Messages between the editor and a conversation are JSON over the WebSocket, typed in `src/shared/protocol.ts`:

| Editor → session (`ClientMessages`) | |
| --- | --- |
| `post` / `site` | the context, on connect and whenever it changes |
| `skills` | every skill beyond the built-in ones |
| `prompt` | `{ text, model, requestId, label? }` |
| `abort`, `reset` | stop the run; start the conversation again |
| `extensions` | the enabled editor extensions' agent specs |
| `extension_result` | the answer to an `extension_call` |

| Session → editor (`ServerMessages`) | |
| --- | --- |
| `view` | `{ items, busy, partial?, usage? }`: the whole chat, after each commit |
| `error` | `{ message }` |
| `extension_call` | run an extension's tool or hook: `{ callId, call }`, where `call.kind` is `tool`, `beforeTool` or `afterTool` |

Features add their own message types by declaration merging; see [hooks.md](hooks.md#new-message-types).
