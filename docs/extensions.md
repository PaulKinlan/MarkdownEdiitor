# Writing editor extensions

An extension is one JavaScript module (ES2022, no imports, no build step). It runs in its own Web Worker: it has no DOM, no `window`, no folder access, and no network unless its manifest asks for `"network"`. It does everything through the `editor` object it is given, and the editor checks every call against the permissions in its manifest.

## Shape

```js
export const manifest = {
  id: "word-goal",              // lowercase letters, digits, dashes; starts with a letter; unique
  name: "Word goal",
  description: "Shows progress towards a word count goal.",
  version: "1.0.0",
  permissions: ["post:read", "ui"],
};

export default function (editor) {
  const status = editor.ui.status("goal", "");
  const update = (post) => {
    if (!post) return status.set("");
    const words = post.text.slice(post.bodyStart).split(/\s+/).filter(Boolean).length;
    status.set(`${words} / 1,500 words`);
  };
  editor.on("post:open", update);
  editor.on("post:change", update);
  if (editor.document.post) update(editor.document.post);
}
```

Rules:

- `manifest` must be a plain object literal (strings, numbers, booleans, arrays). The editor reads it without running the module, to show the author what the extension asks for.
- The default export runs once when the extension starts. It may be `async`. Register everything there.
- Everything on `editor` that talks to the editor returns a Promise, except the `register*` calls, `editor.on`, `ui.status`, `ui.toolbarButton` and `ui.panel`, which return at once.
- An error thrown at start marks the extension as failed (shown in Settings → Extensions). Errors in event handlers are logged there too; the extension keeps running.
- Keep it self-contained: helpers go in the same file.

## Permissions

| Permission | Allows |
| --- | --- |
| `post:read` | `editor.document.*` reads, post events, `document.annotate` (with `ui`) |
| `post:write` | `document.applyEdits`, `document.insert` (undoable, never saved for the author) |
| `site:read` | `editor.site.readFile(path)` |
| `ui` | commands, toolbar buttons, status items, notices, dialogs, panels |
| `agent` | tools, skills, quick edits, system prompt sections, `agent.prompt` |
| `agent:hooks` | `agent.onToolCall`, `agent.onToolResult` (see and change every assistant tool call) |
| `network` | `fetch`, `WebSocket`, `EventSource` in the worker |

Ask for the fewest permissions that do the job. A call without its permission rejects with an error naming the missing permission.

## The post

A post snapshot is:

```js
{
  path: "content/posts/agents.md",   // from the site root
  url: "/agents/",                   // where Hugo publishes it
  title: "agents",
  siteName: "AI Focus",
  text: "---\ntitle: agents\n---\n\nBody…",  // the whole file, front matter included, as in the editor (saved or not)
  bodyStart: 22,                     // offset where the markdown body starts in `text`
  selection: { from: 30, to: 42 },   // offsets in `text`
  unsaved: true,
}
```

All offsets (selection, annotations) are character offsets into `text`.

## Events

`editor.on(event, handler)` returns a function that removes the handler. Post events need `post:read`.

| Event | Handler gets |
| --- | --- |
| `post:open` | the post snapshot, when a post opens |
| `post:change` | the post snapshot, after the author stops typing for a moment (about 300 ms) |
| `post:save` | the post snapshot, after a save |
| `post:close` | `null`, when no post is open any more |
| `agent:run-start` | `null`, when the assistant starts working |
| `agent:run-end` | `null`, when it finishes |

## editor.document

- `editor.document.post`: the snapshot from the last event (or `null`). Synchronous.
- `editor.document.text`: shorthand for `editor.document.post?.text ?? ""`.
- `await editor.document.read()`: the current snapshot from the editor (use it inside tools).
- `await editor.document.applyEdits([{ find, replace }])` (`post:write`): each `find` must occur exactly once in `text`, inside the body (front matter can't be edited by extensions). Returns `{ applied, problems }`. Edits go through the editor's undo history.
- `await editor.document.insert(text)` (`post:write`): inserts at the cursor, replacing the selection.
- `await editor.document.annotate(set, annotations)` (`post:read` + `ui`): underlines ranges of the post, with a note on hover. `set` names a group (say `"long-sentences"`); calling it again replaces that group, and `[]` clears it. Each annotation is `{ from, to, severity: "info" | "warning" | "error", message }`. At most 500 per set. Annotations follow edits until you send new ones.

## editor.site

- `await editor.site.readFile(path)` (`site:read`): the text of a file in the site folder, by path from the site root (`data/stats.json`, `static/demo/data.csv`, `hugo.toml`), or `null` if there is none.

## editor.ui

All need `ui`.

- `editor.ui.notify(message, level?)`: a short notice in the status bar. `level` is `"info"` (default), `"warning"` or `"error"`.
- `await editor.ui.confirm(title, message?)`: `true` if the author agrees.
- `await editor.ui.pick(title, items)`: one of `items` (strings), or `null` if the author cancels.
- `const s = editor.ui.status(id, text, title?)`: an item in the status bar. `s.set(text, title?)` changes it, `s.set("")` hides it, `s.remove()` removes it. Keep `text` under 80 characters; `title` is the hover text.
- `editor.ui.toolbarButton({ id, label, title?, run })`: a button in the editor toolbar. Returns a function that removes it.
- `editor.registerCommand({ id, title, key?, run })`: a command in the toolbar's Extensions menu. `key` is a CodeMirror-style shortcut: `"Mod-Shift-l"` (Mod is ⌘ on a Mac, Ctrl elsewhere), `"Alt-k"`, `"Ctrl-Enter"`. Returns a function that removes it.
- `const panel = editor.ui.panel({ id, title, html? })`: a tab in the side panel next to Preview and Assistant. It shows `html` as a whole page in a sandboxed iframe (scripts run; no access to the editor page, its storage or the network beyond what the page itself loads).
  - `await panel.render(html)`: replaces the page.
  - `panel.onMessage(handler)`: messages the page sends with `parent.postMessage(data, "*")`.
  - `await panel.post(data)`: sends `data` to the page (`window.addEventListener("message", …)` there).
  - Include `<meta name="color-scheme" content="light dark">` and system colours so the panel follows the editor's theme.

## editor.agent

All need `agent`, except the hooks, which need `agent:hooks`. Tools run in the extension, so the assistant can only use them while the editor is open.

- `editor.agent.registerTool({ name, description, parameters, replay?, scope?, execute })`: a tool the assistant can call.
  - `name`: letters, digits, `_` and `-`, starting with a letter. Prefix it with something about your extension; names of the built-in tools (`read_post`, `propose_edits`, `search_posts`, `read_past_post`, `web_search`, `fetch_url`, …) are refused.
  - `description`: what it does and when to use it. The model reads this to decide.
  - `parameters`: a JSON Schema object, e.g. `{ type: "object", properties: { path: { type: "string" } }, required: ["path"] }`. Arguments are validated against it before `execute` runs.
  - `execute(args)`: return a string, `{ text, isError? }`, or any JSON value (sent as JSON). Throwing gives the model an error result. It has 110 seconds.
  - `replay: "safe"` for tools without side effects, so they can be re-run after the server restarts.
  - `scope`: `"post"` (default, the post assistant), `"site"` (the site-wide assistant) or `"both"`.
  - The assistant changes the post only through `propose_edits`, which the author reviews. A tool that wants a change should return the text for the assistant to propose, not edit the post itself.
- `editor.agent.registerSkill({ name, description, instructions, scope? })`: a skill the assistant can load. `name` is kebab-case; `description` says when to use it; `instructions` is the markdown body, like a SKILL.md.
- `editor.agent.registerEdit({ id, name, prompt })`: a quick edit button in the Assistant panel that sends `prompt`.
- `editor.agent.addSystemPrompt(name, text)`: a section of the assistant's system prompt (`name`: lowercase letters, digits, `_`, `-`). Keep it short; it is sent with every request.
- `await editor.agent.prompt(text, label?)`: starts an assistant run with `text`, shown in the chat as `label`.
- `editor.agent.onToolCall(({ tool, args }) => …)` (`agent:hooks`): runs before every tool call. Return `{ block: "reason" }` to stop it, `{ args: {...} }` to replace its arguments, or nothing to let it run. It has 4 seconds; on timeout or error the call goes ahead.
- `editor.agent.onToolResult(({ tool, args, result }) => …)` (`agent:hooks`): runs after every tool call, with `result` as `{ text, isError }`. Return a new `{ text, isError? }` (or a string) to replace it, or nothing to keep it.

## editor.storage

- `await editor.storage.get(key)`, `await editor.storage.set(key, value)`: JSON values kept for this extension in this browser.

## Where extensions live

- **In a site:** `.editor/extensions/<id>.js` or `.editor/extensions/<id>/index.js` in the blog's folder. They travel with the blog's git repo, and the author approves each one once per site.
- **Installed:** from a URL or a file in Settings → Extensions, or written by the assistant. Kept in the editor's library on the server, so every browser gets them.
- Changing an extension's permissions needs the author's approval again.

## Checklist for a new extension

1. Pick an id and the fewest permissions.
2. Do the work in small functions at the top of the file; keep the default export to wiring.
3. Recompute on `post:open` and `post:change`, and call your update once at start with `editor.document.post`.
4. Inside tools, read the post with `await editor.document.read()`.
5. Give tools clear names, descriptions and JSON Schemas, and return plain text the model can read.
6. Never block the worker for long: work on `post:change` must take milliseconds.
