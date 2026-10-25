# Modules

The editor has two kinds of add-on, with one set of ideas between them:

- **Modules** (this page) are first-party code that runs in the page with full access: the Hugo preview, spell check, images, WebMCP and the assistant. They live in this repository.
- **Extensions** ([extensions.md](extensions.md)) run sandboxed in Web Workers. They're for code the author or the assistant writes, and can be installed at run time.

A module is a folder, `src/modules/<id>/`, with a `module.ts` that default-exports `defineModule()`. Modules are found by folder (`src/core/load-modules.ts`), so adding one never edits a shared list, and two modules added on different branches don't conflict.

```ts
import { html } from "lit";
import { defineModule, type ShellChange } from "../../core/modules";

export default defineModule({
  id: "word-goal",
  name: "Word goal",
  order: 40,
  activate({ shell, addSideTab, setStatus }) {
    const onChange = (e: Event) => {
      if ((e as ShellChange).detail.has("text")) setStatus(`${shell.text.split(/\s+/).length} / 1000 words`);
    };
    shell.addEventListener("change", onChange);
    return () => shell.removeEventListener("change", onChange);
  },
});
```

## The shell

`activate()` gets a context whose `shell` is the app as modules see it (`Shell` in `src/core/modules.ts`):

- **State:** `site`, `ready`, `config`, `posts`, `notes`, `shortcodes`, `open`, `text`, `dirty`, `narrow`, `sideTab` (the side tab on screen) and `extensions` (the sandboxed extensions' controller).
- **Actions:** `flash`, `fail`, `save`, `openPath`, `insert`, `applyEdit`, `updateSite`, `writeSiteFile`, `showSideTab`, `prompt` and `update` (re-render after the module's own state changed).
- **Events:** `change`, after every render, with the names of the app state that changed (`site`, `config`, `posts`, `notes`, `open`, `text`, ...). The set can be empty when a module asked for the render.

## What a module adds

Each `add…` returns a function that takes the contribution away again.

| | |
| --- | --- |
| `addSideTab` | A tab in the side panel, placed by `order` (preview 10, assistant 20). With an `icon` it's on the phone's bottom bar too. |
| `addSettingsSection` | A section in Site settings, by `order` (name 0, preview server 10, spelling 30, appearance 50, extensions 60, assistant 70, folder 90). |
| `addDialog` | Rendered after the app's own dialogs. |
| `addCommands` | Commands for the palette, asked for each time it opens. |
| `onImageFiles` | Dropped or pasted images; the first handler that returns true has them. |
| `setEditorOption` | Editor options (`spellcheck`). |
| `setStatus` | This module's item in the status bar. |
| `provide` | A service other code can use (below). |

## Services

A service is something one module provides for the app and other modules, by name. The `Services` interface lists them, and a module adds its own with declaration merging:

```ts
declare module "../../core/modules" {
  interface Services {
    preview(path: string): string | undefined;
  }
}
```

The assistant provides `prompt` (used by `shell.prompt`, WebMCP and extensions' `ctx.prompt`) and `agentServer` (the agent server's settings while it's reachable, which the extension library syncs to). Code that uses a service checks for it, since the module providing it may not be there: `shell.service("preview")?.(path)`.

## Keeping the boot bundle small

Modules load with the app, so they count against the boot JavaScript budget (`npm run gate`). Import big components when they're first shown, as the assistant does with its panel (`void import("./agent-panel")` in the tab's `render`) and its tools dialog.
