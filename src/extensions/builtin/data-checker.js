// Data checker: finds the numbers, dates and quotes in a post so the
// assistant can check each against the site's data files and its sources.
import { lineOf, prose } from "./text.js";

export const manifest = {
  id: "data-checker",
  name: "Data checker",
  order: 100,
  description: "Lists every number, date, money amount and quote in the post, and adds a skill and tools for checking them.",
  version: "1.0.0",
  permissions: ["post:read", "site:read", "ui", "agent"],
};

const PATTERNS = [
  ["money", /[$£€¥]\s?\d[\d,]*(?:\.\d+)?\s?(?:k|m|bn|billion|million|thousand)?\b/gi],
  ["percent", /\b\d+(?:\.\d+)?\s?(?:%|percent\b|per cent\b)/gi],
  ["date", /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}|(?:19|20)\d{2})\b/g],
  ["number", /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s?(?:x|×|times|k|m|ms|s|GB|MB|KB|tokens|users|people)\b|\b\d+\.\d+\b|\b\d{2,}\b/g],
  ["quote", /[“"][^”"\n]{12,300}[”"]/g],
];

/** Claims in the post: each match with its kind, line and sentence, without overlaps. */
export function findClaims(post) {
  const text = prose(post);
  const found = [];
  for (const [kind, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const from = m.index;
      const to = from + m[0].length;
      if (found.some((c) => from < c.to && to > c.from)) continue;
      found.push({ kind, from, to, value: post.text.slice(from, to).trim() });
    }
  }
  found.sort((a, b) => a.from - b.from);
  return found.map((c) => {
    const start = Math.max(text.lastIndexOf("\n\n", c.from), Math.max(text.lastIndexOf(". ", c.from), 0));
    const end = [text.indexOf(". ", c.to), text.indexOf("\n\n", c.to), text.length].filter((i) => i >= 0).sort((a, b) => a - b)[0];
    return { ...c, line: lineOf(post.text, c.from), context: post.text.slice(start, end + 1).replace(/^[.\s]+/, "").replace(/\s+/g, " ").trim() };
  });
}

const DATA_FILE = /^(data|static|assets)\/.+\.(json|csv|tsv|ya?ml|toml|txt)$/;

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default function (editor) {
  const status = editor.ui.status("claims", "");
  const panel = editor.ui.panel({ id: "claims", title: "Claims" });
  let claims = [];

  const render = () =>
    panel.render(`<!doctype html><meta name="color-scheme" content="light dark">
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 12px; }
  li { margin: 0 0 10px; } .kind { font-size: 11px; text-transform: uppercase; opacity: .6; }
  button { font: inherit; font-size: 12px; margin-left: 6px; cursor: pointer; }
  p { opacity: .7; }
</style>
${claims.length ? `<p>${claims.length} things to check. "Check" asks the assistant to verify one.</p>` : "<p>No numbers, dates or quotes found.</p>"}
<ol>${claims
      .map(
        (c, i) =>
          `<li><span class="kind">${c.kind} · line ${c.line}</span><br><strong>${escape(c.value)}</strong><button data-i="${i}">Check</button><br><span>${escape(c.context)}</span></li>`,
      )
      .join("")}</ol>
<script>
  document.addEventListener("click", (e) => {
    const i = e.target.dataset && e.target.dataset.i;
    if (i !== undefined) parent.postMessage({ check: Number(i) }, "*");
  });
</script>`);

  const update = (post) => {
    claims = post ? findClaims(post) : [];
    status.set(post && claims.length ? `${claims.length} claims` : "", "Numbers, dates and quotes to check (Claims panel)");
    void render();
  };
  editor.on("post:open", update);
  editor.on("post:change", update);
  editor.on("post:close", () => update(null));
  if (editor.document.post) update(editor.document.post);

  panel.onMessage(async (message) => {
    const claim = claims[message?.check];
    if (!claim) return;
    await editor.agent.prompt(
      `Check this ${claim.kind} on line ${claim.line}: "${claim.value}" in "${claim.context}". Use read_site_data for the site's data files and web_search/fetch_url for public sources. Say whether it is confirmed, wrong or unverifiable, with the source, and propose an edit only if it is wrong.`,
      `Check: ${claim.value}`,
    );
  });

  editor.agent.registerTool({
    name: "list_claims",
    description: "List every number, percentage, money amount, date and quote in the post, with its line and sentence, so each can be checked.",
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: async () => {
      const post = await editor.document.read();
      if (!post) return { text: "No post is open.", isError: true };
      const found = findClaims(post);
      if (!found.length) return "No numbers, dates or quotes found.";
      return found.map((c, i) => `${i + 1}. [${c.kind}] line ${c.line}: ${c.value}\n   ${c.context}`).join("\n");
    },
  });

  editor.agent.registerTool({
    name: "read_site_data",
    description: "Read a data file from the site folder (under data/, static/ or assets/; JSON, CSV, TSV, YAML, TOML or text), to check figures in the post against it.",
    parameters: { type: "object", properties: { path: { type: "string", description: "Path from the site root, e.g. data/benchmarks.json" } }, required: ["path"] },
    replay: "safe",
    execute: async ({ path }) => {
      const clean = String(path).replace(/^\/+/, "");
      if (!DATA_FILE.test(clean) || clean.split("/").includes("..")) return { text: `Only data files under data/, static/ or assets/ can be read, not ${clean}.`, isError: true };
      const text = await editor.site.readFile(clean);
      if (text === null) return { text: `No file at ${clean}.`, isError: true };
      return text.length > 40_000 ? `${text.slice(0, 40_000)}\n… (cut at 40,000 characters)` : text;
    },
  });

  editor.agent.registerSkill({
    name: "check-data",
    description: "Check every number, date, money amount and quote in the post against the site's data files and primary sources.",
    instructions: [
      "1. Call list_claims to get every claim with its line.",
      "2. For each claim, find its source: the site's data files (read_site_data, e.g. data/*.json or static/*.csv), the post's own links (fetch_url), or a web search for the primary source.",
      "3. Report a table in chat: claim, line, status (confirmed / wrong / unverifiable), source link.",
      "4. Propose edits with propose_edits only for claims that are wrong, with the source in the reason. Do not touch claims you could not verify; list them instead.",
    ].join("\n"),
  });

  editor.agent.registerEdit({
    id: "check-numbers",
    name: "Check numbers",
    prompt: "Check every number, date, money amount and quote in the post: call list_claims, verify each against the site's data files (read_site_data) and primary sources, report a table of claim, status and source, and propose edits only for claims that are wrong.",
  });
}
