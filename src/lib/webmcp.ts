// WebMCP (origin trial, Chrome 149 to 156): registers the editor's actions as
// tools that an agent in the browser, such as Gemini in Chrome, can call while
// the author watches. Edits made this way go through the editor like typing,
// so Ctrl/⌘+Z undoes them, and nothing reaches disk until a save.

import type { Edit } from "../shared/protocol";

export interface EditorToolHost {
  currentPost(): { path: string; url: string; title: string; text: string; unsaved: boolean } | undefined;
  listPosts(query: string, limit: number): { path: string; title: string; url: string; date?: string; draft: boolean }[];
  /** Resolves to an error message, or undefined once the post is open. */
  openPost(path: string): Promise<string | undefined>;
  insertText(text: string): string | undefined;
  applyEdits(edits: Edit[]): { applied: number; problems: string[] };
  save(): Promise<string>;
  listEdits(): { name: string; instruction: string }[];
  runEdit(name: string): string;
}

export function modelContext(): ModelContext | undefined {
  return document.modelContext ?? navigator.modelContext;
}

const editSchema = {
  type: "object",
  properties: {
    find: { type: "string", description: "Text copied exactly from the post. It must occur exactly once." },
    replace: { type: "string", description: "The text to put in its place." },
    reason: { type: "string" },
  },
  required: ["find", "replace"],
};

export function editorTools(host: EditorToolHost): ModelContextTool[] {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return [
    {
      name: "get_current_post",
      title: "Read the open post",
      description: "Returns the post open in the editor: its path, URL, title, whether it has unsaved changes, and its full text including front matter.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => json(host.currentPost() ?? { error: "No post is open." }),
    },
    {
      name: "list_posts",
      title: "List posts",
      description: "Lists posts on the current site, newest first. Optionally filters by words in the title or path.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "number", description: "At most this many (default 20, max 100)." } },
      },
      annotations: { readOnlyHint: true },
      execute: async ({ query, limit }) => json(host.listPosts(typeof query === "string" ? query : "", Math.max(1, Math.min(100, Math.floor(Number(limit)) || 20)))),
    },
    {
      name: "open_post",
      title: "Open a post",
      description: "Opens a post in the editor by its path from list_posts. Fails if the current post has unsaved changes the author doesn't discard.",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      execute: async ({ path }) => (await host.openPost(String(path))) ?? `Opened ${path}.`,
    },
    {
      name: "insert_text",
      title: "Insert text at the cursor",
      description: "Inserts markdown at the cursor in the post body, replacing any selection. Unsaved until the author saves.",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async ({ text }) => host.insertText(String(text)) ?? "Inserted.",
    },
    {
      name: "apply_edits",
      title: "Edit the post",
      description: "Applies find/replace edits to the open post. Each find must occur exactly once in the text from get_current_post. Edits are undoable and unsaved until the author saves.",
      inputSchema: { type: "object", properties: { edits: { type: "array", items: editSchema } }, required: ["edits"] },
      execute: async ({ edits }) => json(host.applyEdits(Array.isArray(edits) ? (edits as Edit[]) : [])),
    },
    {
      name: "save_post",
      title: "Save the post",
      description: "Saves the open post to the author's site folder on disk.",
      inputSchema: { type: "object", properties: {} },
      annotations: { consequentialHint: true },
      execute: async () => host.save(),
    },
    {
      name: "list_edits",
      title: "List saved edits",
      description: "Lists the author's saved editing passes (built-in and their own), which run_edit can start.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => json(host.listEdits()),
    },
    {
      name: "run_edit",
      title: "Run a saved edit",
      description: "Starts one of the saved editing passes in the editor's assistant. Its suggestions appear in the Assistant panel for the author to accept or reject.",
      inputSchema: { type: "object", properties: { name: { type: "string", description: "A name from list_edits." } }, required: ["name"] },
      execute: async ({ name }) => host.runEdit(String(name)),
    },
  ];
}

/** Registers the tools if the browser supports WebMCP. Returns a function that unregisters them. */
export function registerEditorTools(host: EditorToolHost): () => void {
  const context = modelContext();
  if (!context) return () => {};
  const controller = new AbortController();
  const handles: { unregister?: () => void }[] = [];
  for (const tool of editorTools(host)) {
    try {
      const result = context.registerTool(tool, { signal: controller.signal });
      if (result instanceof Promise) result.catch((e) => console.warn(`WebMCP: couldn't register ${tool.name}`, e));
      else if (result && typeof result === "object") handles.push(result);
    } catch (e) {
      console.warn(`WebMCP: couldn't register ${tool.name}`, e);
    }
  }
  return () => {
    controller.abort();
    for (const h of handles) h.unregister?.();
  };
}
