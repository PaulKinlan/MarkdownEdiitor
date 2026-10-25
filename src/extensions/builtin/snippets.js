// Snippets: saved bits of text to insert, from this browser or the site's
// .editor/snippets.json ({ "name": "text" }). {{date}}, {{time}} and {{title}}
// are filled in when inserted.

export const manifest = {
  id: "snippets",
  name: "Snippets",
  description: "Insert saved snippets of text (Mod-Shift-x), save the selection as one, or share them in the site's .editor/snippets.json.",
  version: "1.0.0",
  permissions: ["post:read", "post:write", "site:read", "ui"],
};

const SITE_FILE = ".editor/snippets.json";

const fill = (text, post) => {
  const now = new Date();
  return text
    .replaceAll("{{date}}", now.toISOString().slice(0, 10))
    .replaceAll("{{time}}", now.toTimeString().slice(0, 5))
    .replaceAll("{{title}}", post?.title ?? "");
};

export default function (editor) {
  const mine = async () => (await editor.storage.get("snippets")) ?? {};
  const fromSite = async () => {
    try {
      const text = await editor.site.readFile(SITE_FILE);
      return text ? JSON.parse(text) : {};
    } catch (e) {
      editor.ui.notify(`${SITE_FILE} isn't valid JSON: ${e.message}`, "warning");
      return {};
    }
  };
  const all = async () => ({ ...(await fromSite()), ...(await mine()) });

  const insert = async () => {
    const snippets = await all();
    const names = Object.keys(snippets).sort();
    if (!names.length) return editor.ui.notify("No snippets yet. Select some text and use “Save selection as snippet”.");
    const name = await editor.ui.pick("Insert snippet", names);
    if (name) await editor.document.insert(fill(String(snippets[name]), await editor.document.read()));
  };

  const save = async () => {
    const post = await editor.document.read();
    const text = post ? post.text.slice(post.selection.from, post.selection.to) : "";
    if (!text) return editor.ui.notify("Select the text to save as a snippet first.");
    const name = (await editor.ui.input("Name this snippet"))?.trim();
    if (!name) return;
    await editor.storage.set("snippets", { ...(await mine()), [name]: text });
    editor.ui.notify(`Saved snippet “${name}”.`);
  };

  const remove = async () => {
    const snippets = await mine();
    const name = await editor.ui.pick("Remove a snippet saved in this browser", Object.keys(snippets).sort());
    if (!name) return;
    delete snippets[name];
    await editor.storage.set("snippets", snippets);
  };

  editor.registerCommand({ id: "insert", title: "Insert snippet…", key: "Mod-Shift-x", run: insert });
  editor.registerCommand({ id: "save", title: "Save selection as snippet…", run: save });
  editor.registerCommand({ id: "remove", title: "Remove snippet…", run: remove });
}
