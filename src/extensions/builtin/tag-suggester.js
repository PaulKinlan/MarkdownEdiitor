// Tag suggester: suggests the site's existing tags that fit the post, so
// new posts reuse tags instead of inventing near-duplicates.
import { frontMatter, prose } from "./text.js";

export const manifest = {
  id: "tag-suggester",
  name: "Tag suggester",
  description: "Suggests tags the site already uses that fit the post, and gives the assistant a suggest_tags tool.",
  version: "1.0.0",
  permissions: ["post:read", "site:read", "ui", "agent"],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Existing tags that fit the post, best first, with how often the post and the site use them. */
export function suggest(post, posts, field = "tags") {
  const fm = frontMatter(post);
  const current = new Set((Array.isArray(fm[field]) ? fm[field] : fm[field] ? [fm[field]] : []).map((t) => t.toLowerCase()));
  const usage = new Map();
  for (const p of posts) if (p.path !== post.path) for (const t of p[field] ?? []) usage.set(t, (usage.get(t) ?? 0) + 1);
  const text = `${post.title} ${prose(post)}`.toLowerCase();
  const scored = [];
  for (const [tag, used] of usage) {
    if (current.has(tag.toLowerCase())) continue;
    const phrase = tag.toLowerCase().replace(/[-_]+/g, " ");
    const hits = (text.match(new RegExp(`\\b${escapeRe(phrase)}s?\\b`, "g")) ?? []).length;
    if (hits) scored.push({ tag, hits, used, score: hits * (1 + Math.log(1 + used)) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 12);
}

export default function (editor) {
  editor.registerCommand({
    id: "suggest",
    title: "Suggest tags…",
    run: async () => {
      const post = await editor.document.read();
      if (!post) return editor.ui.notify("Open a post first.");
      const list = suggest(post, await editor.site.posts());
      if (!list.length) return editor.ui.notify("None of the site's tags appear in this post.");
      const choice = await editor.ui.pick("Add a tag (the assistant proposes the edit)", list.map((s) => `${s.tag} — mentioned ${s.hits}×, on ${s.used} posts`));
      if (!choice) return;
      const tag = choice.split(" — ")[0];
      await editor.agent.prompt(`Propose an edit that adds the tag "${tag}" to this post's front matter tags, keeping the existing format.`, `Add tag ${tag}`);
    },
  });
  editor.agent.registerTool({
    name: "suggest_tags",
    description: "Tags (or categories) the site already uses that fit the open post, scored by how often the post mentions them and how many posts use them. Prefer these to new tags.",
    parameters: { type: "object", properties: { field: { type: "string", enum: ["tags", "categories"], description: "Which taxonomy (default tags)" } } },
    replay: "safe",
    execute: async ({ field }) => {
      const post = await editor.document.read();
      if (!post) return { text: "No post is open.", isError: true };
      const list = suggest(post, await editor.site.posts(), field === "categories" ? "categories" : "tags");
      return list.length ? list.map((s) => `- ${s.tag}: mentioned ${s.hits}×, used on ${s.used} posts`).join("\n") : "None of the site's existing terms appear in this post.";
    },
  });
  editor.agent.registerEdit({
    id: "tags",
    name: "Suggest tags",
    prompt: "Call suggest_tags, pick the 3 to 5 that fit best (only invent a new tag if nothing fits), and propose an edit to the front matter tags.",
  });
}
