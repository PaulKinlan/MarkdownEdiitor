// Extension builder: lets the assistant write, install and fix extensions for
// the author. The API reference is filled in by builtin/index.ts.

export const manifest = {
  id: "extension-builder",
  name: "Extension builder",
  description: "Lets the assistant write and install editor extensions for you. You approve each one before it runs.",
  version: "1.0.0",
  permissions: ["agent", "extensions"],
};

const API_REFERENCE = "__API_REFERENCE__";

export default function (editor) {
  editor.agent.registerSkill({
    name: "write-extension",
    description: "Write, install or fix an editor extension (commands, status items, underlines, panels, assistant tools, skills, hooks) when the author asks for a new editor feature.",
    scope: "both",
    instructions: [
      "You can extend this editor by writing an extension: one JavaScript module that runs in a Web Worker and uses the `editor` API below.",
      "",
      "How to work:",
      "1. Ask what the author wants if it is unclear. Check list_extensions first; to change one, read it with read_extension.",
      "2. Write the whole module. Follow the reference exactly; it is the only API there is.",
      "3. Install it with install_extension. The author approves its permissions. The result says whether it started, and any error.",
      "4. If it failed or the author wants changes, fix it and install again (same id replaces it).",
      "5. Tell the author in one or two sentences what it adds and where to find it. Don't paste the code in chat unless asked.",
      "",
      API_REFERENCE,
    ].join("\n"),
  });

  editor.agent.registerTool({
    name: "list_extensions",
    description: "List the editor's extensions: id, name, where it comes from, whether it is running, its permissions, and recent errors.",
    parameters: { type: "object", properties: {} },
    replay: "safe",
    scope: "both",
    execute: async () => JSON.stringify(await editor.extensions.list(), null, 2),
  });

  editor.agent.registerTool({
    name: "read_extension",
    description: "Read the source of an installed, site or built-in extension by id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    replay: "safe",
    scope: "both",
    execute: async ({ id }) => (await editor.extensions.read(id)) ?? { text: `No extension ${id}.`, isError: true },
  });

  editor.agent.registerTool({
    name: "install_extension",
    description:
      "Install or replace an extension from its full module source (with `export const manifest` and a default export). The author is asked to approve its permissions first. Returns whether it started and any error, so you can fix it.",
    parameters: { type: "object", properties: { source: { type: "string", description: "The whole JavaScript module" } }, required: ["source"] },
    scope: "both",
    execute: async ({ source }) => {
      const result = await editor.extensions.install(source);
      return { text: JSON.stringify(result, null, 2), isError: !result || result.status !== "running" };
    },
  });
}
