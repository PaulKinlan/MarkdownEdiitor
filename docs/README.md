# Developer docs

How the Hugo Editor is put together and how to add to it. For what it does, start with the [README](../README.md) and the feature pages in [features/](features/).

## The pieces

```
Browser                                                     Cloudflare Worker
───────                                                     ─────────────────
app shell (src/components/app.ts)                           /api routes (worker/routes/*.ts)
 ├─ modules: trusted, in the page (src/modules/<id>/)        ├─ AgentSession / SiteSession: Pi Durable conversations
 │   └─ assistant ─ backends ── WebSocket ──────────────────▶│    with a profile each (worker/agent/profiles/)
 ├─ extensions: sandboxed Web Workers                        ├─ SiteIndex, ToolStore, ExtensionStore,
 │   (src/extensions/, built-ins in builtin/)               │   FeatureStore, Observability
 └─ the site folder (File System Access)                    └─ /api/mcp/sites/<id> for other agents
```

The editor has two tiers of add-on that share one set of ideas: **modules** are first-party code with full access to the page, and **extensions** are sandboxed code the author or the assistant writes. Both can add commands, side tabs and status items; only extensions can be installed at run time, and they reach the assistant through the agent server.

## Pages

| Page | |
| --- | --- |
| [extensions.md](extensions.md) | The extension API: manifest, permissions, events, `editor.document`, `editor.site`, `editor.ui`, `editor.agent` and the rest. The assistant reads this page too, when it writes an extension. |
| [hooks.md](hooks.md) | Every hook and event across extensions, modules and the agent server, how a tool call reaches an extension, and how to add message types. |
| [modules.md](modules.md) | First-party modules: the shell, what a module can add, services, and the boot budget. |
| [agents.md](agents.md) | The agent server: conversations and profiles, built-in tools, skills, the author's tools, extensions in the agent, models, backends, MCP and the protocol. |
| [worker.md](worker.md) | The Worker: routes, Durable Objects, FeatureStore and the folder registries. |
| [adr/](adr/) | Decisions, including what was deliberately not done. |
| [features/](features/) | One page per feature, for people using the editor. |

## Where to add what

| To add | Add a file | Read |
| --- | --- | --- |
| A built-in skill | `src/skills/<name>/SKILL.md` | [agents.md](agents.md#skills-and-quick-edits) |
| A built-in quick edit | `src/quick-edits/<id>.md` | [agents.md](agents.md#skills-and-quick-edits) |
| A built-in extension | `src/extensions/builtin/<id>.js` | [extensions.md](extensions.md) |
| A feature in the page (side tab, settings, dialog, commands, services) | `src/modules/<id>/module.ts` | [modules.md](modules.md) |
| Tools or prompt sections for an assistant | a Pi Durable extension in its profile, `worker/agent/profiles/<kind>.ts` | [agents.md](agents.md#profiles) |
| A place the model loop runs | `src/modules/assistant/backends/<id>.ts` | [agents.md](agents.md#backends) |
| Messages between the editor and a conversation | declaration merging on `ClientMessages` / `ServerMessages`, next to the feature | [hooks.md](hooks.md#new-message-types) |
| An `/api` endpoint | `worker/routes/<area>.ts` | [worker.md](worker.md#routes) |
| Data kept on the server | a `FeatureStore` (`featureStore(env, "<feature>", scope)`) | [worker.md](worker.md#featurestore) |
| Documentation for a feature | `docs/features/<name>.md`, linked from the README | |

## Keeping the docs current

These pages describe the code as it is on `main`. A change to the extension API, a hook, a module context, a backend, a profile, a route, a message type or a built-in tool updates the page that describes it in the same PR (see `AGENTS.md`).

`node scripts/check-docs.mjs` runs in `npm run gate` and in CI. It reads the code and fails when something isn't named in these docs:

- **extensions.md**: every permission, event, `editor` method and manifest field.
- **hooks.md**: every hook, invocation and registration kind.
- **modules.md**: every `Shell`, `ModuleContext` and `Services` member, and every module folder.
- **agents.md**: every `AgentBackend` and `Profile` member, backend and profile file, built-in tool, and message type.
- **worker.md**: every route file, `Route` field and Durable Object class.
- **features/extensions.md**: every built-in extension.
- Every relative link in `docs/` and the README goes somewhere.

It says what's missing and where, so the fix is to describe the new thing, not to quiet the check.
