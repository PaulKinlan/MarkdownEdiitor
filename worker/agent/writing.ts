import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import type { Edit, PostContext } from "../../src/shared/protocol";
import { checkEdits } from "../../src/shared/edits";
import { libraryTools, type LibraryHost, type SearchHit } from "./library";
import { analyzePost } from "./post-stats";

export { checkEdits };

export type { SearchHit };

/** What the writing tools need from their host (the Durable Object, or a test). */
export interface WritingHost extends LibraryHost {
  post(): PostContext | undefined;
  readPastPost(path: string): Promise<{ title: string; url: string; body: string } | undefined>;
}

const ROLE = `You are an editor working alongside the author of a Hugo blog, inside their markdown editor.

- Read the post with read_post before commenting on it or changing it.
- Never rewrite the post in chat. Every change to the post goes through propose_edits as small find/replace edits; the author accepts or rejects each one. Keep each edit as small as the change allows and give a short reason.
- Keep the author's voice. Do not add flourish, hype, or filler.
- Do not change Hugo shortcodes ({{< ... >}}) or front matter keys unless asked; front matter values (title, summary, tags) can be edited the same way as prose.
- When suggesting links, prefer primary sources (specs, docs, papers, repos) and the author's own past posts (search_posts). Use the site-relative URL for the author's posts.
- Reply briefly in chat: what you changed or found and why. Use markdown.`;

export function createWritingExtension(host: WritingHost) {
  const readPost = defineTool({
    name: "read_post",
    description: "Read the post being edited, exactly as it is in the editor (front matter and markdown body). Lines are numbered for reference only.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const post = host.post();
      if (!post) return { output: [{ type: "text", text: "No post is open." }], isError: true };
      const numbered = post.text
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)}| ${line}`)
        .join("\n");
      return { output: [{ type: "text", text: `${post.path} (${post.url})\n\n${numbered}` }] };
    },
  });

  const proposeEdits = defineTool({
    name: "propose_edits",
    description:
      "Suggest changes to the post as find/replace pairs. `find` is exact text from the post (no line numbers) and must occur exactly once; include enough surrounding words to make it unique. The author reviews each edit.",
    parameters: Type.Object({
      edits: Type.Array(
        Type.Object({
          find: Type.String({ description: "Exact text currently in the post" }),
          replace: Type.String({ description: "Replacement text" }),
          reason: Type.Optional(Type.String({ description: "Why, in a few words" })),
        }),
        { minItems: 1 },
      ),
    }),
    replay: "safe",
    execute: async (args) => {
      const post = host.post();
      if (!post) return { output: [{ type: "text", text: "No post is open." }], isError: true };
      const { valid, problems } = checkEdits(post.text, args.edits);
      const lines = [`${valid.length} edit(s) sent to the author for review.`, ...problems];
      return {
        output: [{ type: "text", text: lines.join("\n") }],
        details: { edits: valid as unknown as Edit[] } as never,
        isError: valid.length === 0,
      };
    },
  });

  const readPastPost = defineTool({
    name: "read_past_post",
    description: "Read another post on this site in full, by the path search_posts returned.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      const post = await host.readPastPost(args.path);
      if (!post) return { output: [{ type: "text", text: `No post at ${args.path}` }], isError: true };
      return { output: [{ type: "text", text: `${post.title} (${post.url})\n\n${post.body}` }] };
    },
  });

  const analyze = defineTool({
    name: "analyze_post",
    description:
      "Measure the post being edited: word count and reading time, heading outline, paragraph and sentence lengths, links (including vague link text), images without alt text, and front matter field lengths. Line numbers match read_post.",
    parameters: Type.Object({}),
    replay: "safe",
    execute: async () => {
      const post = host.post();
      if (!post) return { output: [{ type: "text", text: "No post is open." }], isError: true };
      return { output: [{ type: "text", text: analyzePost(post.text) }] };
    },
  });

  const tools = [readPost, proposeEdits, readPastPost, analyze, ...libraryTools(host)];

  return defineExtension({
    name: "writing",
    tools,
    sections: [
      section("role", () => ROLE, { tag: false }),
      section("site", () => {
        const post = host.post();
        if (!post) return undefined;
        const rules = post.siteInstructions.trim();
        const shortcodes = post.shortcodes?.length ? `\n\nHugo shortcodes this site defines: ${post.shortcodes.join(", ")}` : "";
        return `Site: ${post.siteName}${shortcodes}${rules ? `\n\nThe author's writing rules for this site:\n\n${rules}` : ""}`;
      }),
      section("post", () => {
        const post = host.post();
        return post ? `Editing ${post.path}, published at ${post.url}` : undefined;
      }),
    ],
  });
}

