// Style guide: the site's own writing rules. Words to replace or avoid come
// from .editor/style-guide.json and are underlined; the prose guide in
// .editor/style-guide.md becomes a skill the assistant follows.
import { lineOf, prose } from "./text.js";

export const manifest = {
  id: "style-guide",
  name: "Style guide",
  description: "Underlines words your site's style guide replaces or avoids (.editor/style-guide.json) and gives the assistant the guide (.editor/style-guide.md).",
  version: "1.0.0",
  permissions: ["post:read", "site:read", "ui", "agent"],
};

const RULES_FILE = ".editor/style-guide.json";
const GUIDE_FILE = ".editor/style-guide.md";
const EXAMPLE = '{ "replace": { "utilise": "use", "e-mail": "email" }, "avoid": ["very", "just", "basically"] }';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rules as [pattern, message, replacement?]. */
function compile(rules) {
  const out = [];
  const flags = rules.caseSensitive ? "g" : "gi";
  for (const [from, to] of Object.entries(rules.replace ?? {})) out.push({ re: new RegExp(`\\b${escapeRe(from)}\\b`, flags), word: from, replace: String(to) });
  for (const word of rules.avoid ?? []) out.push({ re: new RegExp(`\\b${escapeRe(word)}\\b`, flags), word });
  return out;
}

function findIssues(post, rules) {
  const text = prose(post);
  const issues = [];
  for (const rule of rules) {
    for (const m of text.matchAll(rule.re)) {
      issues.push({ from: m.index, to: m.index + m[0].length, found: m[0], replace: rule.replace, message: rule.replace ? `Style guide: “${rule.replace}”, not “${m[0]}”` : `Style guide: avoid “${m[0]}”` });
    }
  }
  return issues.sort((a, b) => a.from - b.from);
}

export default function (editor) {
  const status = editor.ui.status("style", "");
  let rules = [];
  let loadedFor = null;
  let guide = "";

  const load = async (post) => {
    if (!post || loadedFor === post.siteName) return;
    loadedFor = post.siteName;
    rules = [];
    try {
      const json = await editor.site.readFile(RULES_FILE);
      if (json) rules = compile(JSON.parse(json));
    } catch (e) {
      editor.ui.notify(`${RULES_FILE} isn't valid: ${e.message}. It looks like ${EXAMPLE}`, "warning");
    }
    guide = (await editor.site.readFile(GUIDE_FILE)) ?? "";
    // The quick edit only makes sense for a site that has a guide.
    if (rules.length || guide.trim()) {
      editor.agent.registerEdit({
        id: "apply",
        name: "Apply style guide",
        prompt: "Call style_guide_issues and load the style-guide skill if there is one, then propose edits that bring the post in line with the guide. Rewrite around avoided words rather than just deleting them.",
      });
    }
    if (guide.trim()) {
      editor.agent.registerSkill({
        name: "style-guide",
        description: "This site's own style guide. Use it whenever you write or edit prose for this site.",
        instructions: guide,
        scope: "both",
      });
    }
  };

  const update = async (post) => {
    if (!post) return status.set("");
    await load(post);
    if (!rules.length) {
      status.set("");
      return editor.document.annotate("style", []);
    }
    const issues = findIssues(post, rules);
    status.set(issues.length ? `Style: ${issues.length}` : "Style ✓", issues.length ? `${issues.length} places break the style guide` : "Follows the style guide");
    editor.document.annotate("style", issues.slice(0, 300).map((i) => ({ from: i.from, to: i.to, severity: "warning", message: i.message })));
  };

  editor.agent.registerTool({
    name: "style_guide_issues",
    description: `Places in the open post that break the site's style guide word rules (${RULES_FILE}), with the replacement where there is one.`,
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: async () => {
      const post = await editor.document.read();
      if (!post) return { text: "No post is open.", isError: true };
      await load(post);
      if (!rules.length) return `This site has no ${RULES_FILE}. It looks like ${EXAMPLE}.`;
      const issues = findIssues(post, rules);
      return issues.length ? issues.map((i) => `- line ${lineOf(post.text, i.from)}: ${i.message}`).join("\n") : "The post follows the style guide.";
    },
  });
  editor.on("post:open", update);
  editor.on("post:change", update);
  editor.on("post:close", () => status.set(""));
  if (editor.document.post) void update(editor.document.post);
}
