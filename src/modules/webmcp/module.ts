import { defineModule } from "../../core/modules";
import { BUILTIN_ACTIONS, loadCustomActions } from "../../lib/actions";
import { registerEditorTools, type EditorToolHost } from "./webmcp";

/** Edits that run on the open post (WebMCP tools only drive the post assistant). */
function postActions() {
  return [...BUILTIN_ACTIONS, ...loadCustomActions().filter((a) => (a.scope ?? "post") === "post")];
}

// Tools for agents in the browser (WebMCP): read, open, edit and save posts,
// and run the assistant's quick edits.
export default defineModule({
  id: "webmcp",
  name: "Tools for browser agents",
  order: 50,
  activate({ shell }) {
    const host: EditorToolHost = {
      currentPost: () => shell.open && { path: shell.open.summary.path, url: shell.open.summary.url, title: shell.open.summary.title, text: shell.text, unsaved: shell.dirty },
      listPosts: (query, limit) => {
        const q = query.toLowerCase();
        return shell.posts
          .filter((p) => !q || p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
          .slice(0, limit)
          .map((p) => ({ path: p.path, title: p.title, url: p.url, date: p.date?.toISOString().slice(0, 10), draft: p.draft }));
      },
      openPost: async (path) => {
        if (!shell.posts.some((p) => p.path === path)) return `No post at ${path}. Use list_posts for paths.`;
        return shell.openPath(path);
      },
      insertText: (text) => (shell.insert(text) ? undefined : "No post is open."),
      applyEdits: (edits) => {
        const problems: string[] = [];
        let applied = 0;
        edits.forEach((edit, i) => (shell.applyEdit(edit) ? applied++ : problems.push(`Edit ${i + 1}: find text not found exactly once.`)));
        return { applied, problems };
      },
      save: async () => {
        if (!shell.open) return "No post is open.";
        if (!shell.dirty) return "Nothing to save.";
        await shell.save();
        return shell.dirty ? "Not saved." : `Saved ${shell.open.summary.path}.`;
      },
      listEdits: () => postActions().map((a) => ({ name: a.name, instruction: a.prompt })),
      runEdit: (name) => {
        const action = postActions().find((a) => a.name.toLowerCase() === name.toLowerCase());
        if (!action) return `No edit called "${name}". Use list_edits.`;
        const problem = shell.prompt(action.prompt, action.name);
        return problem ?? `Started "${action.name}". Its suggestions will appear in the Assistant panel for the author to review.`;
      },
    };
    return registerEditorTools(host);
  },
});
