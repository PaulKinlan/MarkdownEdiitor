# Extensions

Extensions add to every part of the editor: commands and shortcuts, toolbar buttons, status bar items, underlines with notes in the text, side panel tabs, and the assistant's tools, skills, quick edits, system prompt and tool-call hooks. They are written like [Pi](https://github.com/badlogic/pi-mono) extensions: one module whose default export gets an `editor` object.

```js
export const manifest = { id: "word-goal", name: "Word goal", permissions: ["post:read", "ui"] };
export default function (editor) {
  const status = editor.ui.status("goal", "");
  editor.on("post:change", (post) => status.set(`${post.text.slice(post.bodyStart).split(/\s+/).length} / 1,500 words`));
}
```

- **Isolated.** Each extension runs in its own Web Worker, with no DOM or folder access. Built, the worker is served with a Content-Security-Policy that blocks the network unless the extension asks for it (`public/_headers`). The editor checks every call against the permissions in its manifest, and a crash stops only that extension.
- **Agent tools from the browser.** Both assistants (post and site) install one Pi Durable extension per editor extension (`ext:<id>`). When the model calls one of its tools, or a hook runs, the Durable Object asks the editor over the WebSocket, and the editor asks the worker. Tools work while the editor is open.
- **Where they come from.** Built in; a site's own `.editor/extensions/<id>.js` (versioned with the blog); or installed from a URL or file in Settings → Extensions. Installed extensions are kept in an `ExtensionStore` Durable Object so every browser gets them. Nothing but the built-ins runs until you approve its permissions, and an update that asks for more waits for approval again.
- **The assistant can write them.** The built-in Extension builder gives the assistant the full API reference as a `write-extension` skill, and tools to list, read and install extensions. You approve each install.
- **Built in** (all in `src/extensions/builtin/`, each can be turned off in Settings → Extensions):
  - Writing: Word count, Word goal, Edit and save times, Writing streak (with a history panel), Outline panel.
  - Checks: Readability, Repetition (off by default), Style guide (rules from `.editor/style-guide.json`, a skill from `.editor/style-guide.md`), SEO check, Link checker, Data checker (Claims panel).
  - Helpers: Tag suggester, Autosave (off by default), Dictation (Web Speech API), Emoji picker, Snippets (`.editor/snippets.json` or saved in the browser), Assistant alerts (a system notification when a reply lands in the background), and the Extension builder.
- **Command palette.** Ctrl/⌘+Shift+P lists every command, the assistant's quick edits and a few editor actions.

The API is in [docs/extensions.md](../extensions.md). With `DEMO_MODEL=1`, a prompt like `/tool readability_report {}` makes the faux model call that tool, to try extension tools without keys.
