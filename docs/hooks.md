# Hooks and events

Every place code can hook into the editor, across the three tiers: sandboxed **extensions** (Web Workers, [extensions.md](extensions.md)), first-party **modules** in the page ([modules.md](modules.md)), and the **agent server** on the Worker ([agents.md](agents.md)). A hook changes what happens; an event only tells you it happened.

## At a glance

| Hook | Tier | Runs | Can |
| --- | --- | --- | --- |
| `editor.onBeforeSave` | extension (`post:write`) | before every save of the open post | replace the text that is saved, or block the save with a reason |
| `editor.agent.onToolCall` | extension (`agent:hooks`) | before every assistant tool call | block the call, or replace its arguments |
| `editor.agent.onToolResult` | extension (`agent:hooks`) | after every assistant tool call | replace the result the model sees |
| `editor.on(event)` | extension | on editor, site and assistant events (below) | nothing: it's an event |
| `onImageFiles` | module | when images are dropped or pasted | take the files (the first handler to return `true` wins) |
| `provide` / `shell.service` | module | when code asks for a service by name | supply it (the last provider wins) |
| shell `change` event | module | after every render | nothing: it's an event |
| Pi Durable `hook(ToolTask, …)` | agent server | around every tool call in one conversation | `beforeTool`: block or change arguments; `afterTool`: change the result |
| Pi Durable `section(name, …)` | agent server | each time the system prompt is built | add text to it |
| `Profile.messages` | agent server | when the editor sends a message type a feature declared | answer it |
| `Route` | Worker | on a request to its `/api` path | answer it |

## Extension hooks

Everything an extension adds reaches the editor as a registration, and the editor checks its permission then:

| Registration | Made by | Needs |
| --- | --- | --- |
| `command` | `editor.registerCommand` | `ui` |
| `button` | `editor.ui.toolbarButton` | `ui` |
| `panel` | `editor.ui.panel` | `ui` |
| `tool` | `editor.agent.registerTool` | `agent` |
| `skill` | `editor.agent.registerSkill` | `agent` |
| `edit` | `editor.agent.registerEdit` | `agent` |
| `section` | `editor.agent.addSystemPrompt` | `agent` |
| `hook` | `editor.onBeforeSave` (`{ beforeSave }`), `editor.agent.onToolCall` (`{ beforeTool }`), `editor.agent.onToolResult` (`{ afterTool }`) | `post:write` for the save hook, `agent:hooks` for tool hooks |

The editor calls back into the extension's worker when a hook fires.

### Before save

```js
editor.onBeforeSave((post) => {
  if (post.text.includes("TODO")) return { block: "The post still has a TODO." };
  const lastmod = new Date().toISOString().slice(0, 10);
  return { text: post.text.replace(/^lastmod: .*$/m, `lastmod: ${lastmod}`) };
});
```

- Needs `post:write`. Gets the post snapshot that is about to be written.
- Return `{ text }` to save different text (the editor shows it too), `{ block: "reason" }` to stop the save, or nothing.
- Hooks run in extension order, each seeing the text the one before it returned. The first `block` wins.
- Each hook has 4 seconds. A timeout or an error lets the save go ahead without that hook (it fails open).

### Tool calls

```js
editor.agent.onToolCall(({ tool, args }) => {
  if (tool === "fetch_url" && new URL(args.url).hostname.endsWith(".internal")) return { block: "Internal hosts are off limits." };
});
editor.agent.onToolResult(({ tool, result }) => {
  if (tool === "web_search") return { text: result.text + "\n\nPrefer primary sources.", isError: result.isError };
});
```

- Needs `agent:hooks`. They see every tool call from both assistants (post and site), the built-in tools as well as other extensions' tools.
- `onToolCall` returns `{ block: "reason" }` (the model gets the reason as an error result), `{ args: {...} }` to run the call with other arguments, or nothing.
- `onToolResult` gets `result` as `{ text, isError }` and returns a new `{ text, isError? }` (or a string), or nothing to keep it.
- The hook runs in the editor, so the agent server asks the open editor over the WebSocket. The page gives a hook 4 seconds and the server 5. When the editor is closed, slow or throws, the call goes ahead unchanged.

### How a call reaches an extension

The agent server never runs extension code. For a tool or a tool hook, the conversation's Durable Object sends `extension_call` to the newest editor that described its extensions, and waits for `extension_result`:

```
model ─▶ Pi Durable tool / ToolTask hook (ext:<id>)          worker/agent/extension-bridge.ts
       ─▶ extension_call over the WebSocket                   worker/agent/conversation.ts
       ─▶ AgentConnection.runExtension                         src/lib/agent-client.ts
       ─▶ ExtensionHost.invoke(tool | beforeTool | afterTool)  src/extensions/host.ts
       ─▶ the extension's worker                               src/extensions/runtime.ts
```

The editor calls into a worker with one of these invocations (`Invocations` in `src/extensions/messages.ts`):

| Invocation | Sent when | Time limit |
| --- | --- | --- |
| `tool` | the assistant calls one of the extension's tools | 110 s (the server waits 120 s) |
| `beforeTool`, `afterTool` | around every assistant tool call, for extensions with tool hooks | 4 s (the server waits 5 s) |
| `beforeSave` | before each save, for extensions with a save hook | 4 s |
| `command`, `button` | the author runs a command or clicks a toolbar button | 60 s |
| `panel.message` | the extension's panel page calls `parent.postMessage` | |

Loading an extension (running its default export) has 10 seconds.

### Events

`editor.on(event, handler)` returns a function that removes the handler. The events and what each handler gets are in [extensions.md](extensions.md#events): `site:open`, `site:close`, `site:files-changed`, `settings:change`, `post:open`, `post:change`, `post:save`, `post:close`, `selection`, `agent:run-start`, `agent:run-end`, `speech:result` and `speech:end`.

## Module hooks

Modules run in the page with full access, so most of what they do is direct. The ones that hook in:

- **`shell.addEventListener("change", …)`**: after every render, with a `ShellChange` whose `detail` is the set of app state names that changed (`site`, `config`, `posts`, `notes`, `open`, `text`, ...). Check `detail.has("text")` and similar rather than redoing work on every render.
- **`onImageFiles(handler)`**: gets dropped or pasted images. Handlers run in module order; the first that resolves `true` has handled them, and the rest don't see them.
- **`provide(key, service)`** and **`shell.service(key)`**: one module supplies a named service (declared on `Services` by declaration merging) and other code calls it. The last provider wins; callers check for `undefined`, since the module may not be there.
- **`addCommands(() => commands)`**: asked for its commands each time the palette opens, so the list can depend on state.
- **`setEditorOption(key, value)`**: options for CodeMirror (`spellcheck`).

Every `add…` and `provide` returns a function that takes the contribution away again, and `activate()` can return a function that stops the module.

## Agent server hooks

On the Worker, an assistant is a Pi Durable harness whose registry holds Pi Durable extensions (`defineExtension({ name, tools, sections, hooks })`). Each conversation installs, in order:

1. Its profile's extensions (`worker/agent/profiles/<kind>.ts`): the writing or site tools, research tools and skills.
2. The author's configured tools (`tools:mcp:<id>`, `tools:http:<id>`), installed again before each prompt so changes in Settings take effect.
3. One `ext:<id>` per editor extension that adds tools, prompt sections or tool hooks, from the manifest the editor sent (`ExtensionBridge`).

A Pi Durable extension hooks in with:

- **`section(name, () => text)`**: a part of the system prompt, rebuilt each turn. Keep the text stable when nothing changed, so prompt caches stay warm (the skills catalog only changes when the set of skills does).
- **`hook(ToolTask, { beforeTool, afterTool })`**: around every tool call in the conversation. `beforeTool` returns `{ block }` or `{ arguments }`; `afterTool` returns a changed result. This is how editor extensions' tool hooks are carried out.
- **Native web tools**: `addNativeWebTools` wraps each provider so the request payload swaps `web_search` and `fetch_url` for the provider's own server-side tools when the model has them (`worker/tools/native.ts`).

### New message types

A feature that needs to talk between the editor and a conversation declares its messages next to its code, by declaration merging, rather than editing `src/shared/protocol.ts`:

```ts
declare module "../shared/protocol" {
  interface ClientMessages { "git:status": { paths: string[] } }   // editor → session
  interface ServerMessages { "git:result": { ok: boolean } }       // session → editor
}
```

The session handles it in a profile's `messages` (`{ "git:status": (self, message, ws) => self.send(ws, { type: "git:result", ok: true }) }`) and the editor listens with `AgentConnection.on("git:result", handler)`. A message type nobody handles gets an error back. The core types (`post`, `site`, `skills`, `prompt`, `abort`, `reset`, `extensions`, `extension_result`; and `view`, `error`, `extension_call` back) are handled by every conversation.

## Worker routes

An `/api` endpoint is a `Route` in a file in `worker/routes/` ([worker.md](worker.md)). Routes need the editor token unless they're marked `public`; the router answers unknown paths without the token with 401, so they can't be probed.

## Keeping this page current

`node scripts/check-docs.mjs` (part of `npm run gate` and CI) fails when a hook, invocation, registration kind or message type in the code isn't named in these docs. Change the docs in the same PR as the code.
