import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import type { FileChange, SiteContext } from "../../src/shared/protocol";
import { checkEdits } from "../../src/shared/edits";
import { isNotePath, NOTE_STATUSES, NOTES_DIR } from "../../src/shared/notes";
import { libraryTools, type LibraryHost } from "./library";
import type { GrepResult, ListFilter, PostListing } from "./site-data";

/** What the site tools need from their host (the Durable Object, or a test). */
export interface SiteHost extends LibraryHost {
  site(): SiteContext | undefined;
  listPosts(filter: ListFilter): Promise<PostListing[]>;
  terms(key: string): Promise<{ term: string; count: number }[]>;
  grep(pattern: string, options: { regex?: boolean; caseSensitive?: boolean; limit?: number }): Promise<GrepResult>;
  /** The whole file as last indexed, or undefined if there is no such post. */
  readFile(path: string): Promise<{ title: string; url: string; text: string } | undefined>;
}

const ROLE = `You are an editor working across the author's whole Hugo blog, inside their markdown editor. You help with jobs that span many posts: tidying tags and categories, cross-linking related posts, planning series, site-wide checks, and bulk find and replace.

- Find posts with list_posts, search_posts and grep_posts, and read them with read_post before changing them. Use list_terms to see how tags, categories or series are used across the site.
- Never rewrite posts in chat. Every change goes through propose_changes as small find/replace edits per file (or the full text of a new file); the author reviews each one before anything is written to disk. Group all the edits for one file under that file.
- Keep the author's voice. Do not add flourish, hype, or filler.
- Do not change Hugo shortcodes ({{< ... >}}) or front matter keys unless asked; front matter values (title, summary, tags) can be edited the same way as prose.
- For big jobs, start with a short plan and the list of files you intend to change, then propose changes in batches of at most 20 files.
- Use site-relative URLs when linking to the author's own posts.
- Research notes and post ideas live in ${NOTES_DIR}/ at the site root, outside the content directory, so Hugo never publishes them. List them with list_posts notes=true; search_posts and grep_posts cover them too.
- When asked to research something, search the web (and the author's past posts), check sources with fetch_url, and save what you find with propose_changes: create a new note, or add to an existing one with edits. A note is markdown with YAML front matter (title, date, status, tags) and sections "## Sources" (a bullet per source: markdown link, then one line on what it says and why it matters) and "## Notes" (findings, quotes, open questions, angles for a post). Status is one of ${NOTE_STATUSES.join(", ")}.
- When asked to turn a note into a post, create a draft (draft: true) in the right section, with front matter shaped like recent posts there (check with list_posts fields), an outline and the sources as links, and edit the note's status to drafted.
- Reply briefly in chat: what you found or changed and why. Use markdown, and name posts by title with their path.`;

const MAX_FILES = 40;

export function createSiteExtension(host: SiteHost) {
  const listPosts = defineTool({
    name: "list_posts",
    description:
      "List the site's posts, newest first, with path, date, title, draft state and word count. Filter by section, date range, draft state, a front matter value (e.g. field=tags value=ai), or a missing front matter field (e.g. missing=summary).",
    parameters: Type.Object({
      notes: Type.Optional(Type.Boolean({ description: `List research notes in ${NOTES_DIR}/ instead of posts` })),
      section: Type.Optional(Type.String({ description: "Top-level content folder, e.g. posts. Empty string for root-level content." })),
      field: Type.Optional(Type.String({ description: "Front matter key that must be set, e.g. tags" })),
      value: Type.Optional(Type.String({ description: "Value the field must contain (case-insensitive)" })),
      missing: Type.Optional(Type.String({ description: "Front matter key that must be missing or empty" })),
      draft: Type.Optional(Type.Boolean()),
      since: Type.Optional(Type.String({ description: "ISO date, inclusive" })),
      until: Type.Optional(Type.String({ description: "ISO date, inclusive" })),
      fields: Type.Optional(Type.Array(Type.String(), { description: "Front matter keys to include for each post, e.g. [\"tags\", \"summary\"]" })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
      offset: Type.Optional(Type.Number({ minimum: 0 })),
    }),
    replay: "safe",
    execute: async (args) => {
      const { fields = [], limit = 100, offset = 0, ...filter } = args;
      const posts = await host.listPosts(filter);
      if (!posts.length) return { output: [{ type: "text", text: "No posts match." }] };
      const page = posts.slice(offset, offset + limit);
      const lines = page.map((p) => {
        const extra = fields.map((f) => `${f}: ${JSON.stringify(p.frontMatter[f] ?? null)}`).join("; ");
        return `- ${p.date?.slice(0, 10) ?? "no date"} ${p.title}${p.draft ? " (draft)" : ""} [${p.path}] ${p.url} · ${p.words} words${extra ? ` · ${extra}` : ""}`;
      });
      const more = posts.length > offset + page.length ? `\n${posts.length - offset - page.length} more; use offset=${offset + page.length}.` : "";
      return { output: [{ type: "text", text: `${posts.length} post(s).\n${lines.join("\n")}${more}` }] };
    },
  });

  const listTerms = defineTool({
    name: "list_terms",
    description: "Count how often each value of a list-like front matter key (tags, categories, series, authors…) is used across the site, most used first. Use it to spot duplicates, near-duplicates and one-off terms.",
    parameters: Type.Object({ key: Type.String({ description: "Front matter key, e.g. tags" }) }),
    replay: "safe",
    execute: async (args) => {
      const terms = await host.terms(args.key);
      if (!terms.length) return { output: [{ type: "text", text: `No post sets ${args.key}.` }] };
      return { output: [{ type: "text", text: `${terms.length} distinct value(s) of ${args.key}:\n${terms.map((t) => `${t.count}\t${t.term}`).join("\n")}` }] };
    },
  });

  const grepPosts = defineTool({
    name: "grep_posts",
    description:
      "Find lines matching exact text (or a JavaScript regular expression) in every post file, front matter included. Use it for bulk find and replace, finding every link to a URL, or checking a pattern site-wide.",
    parameters: Type.Object({
      pattern: Type.String(),
      regex: Type.Optional(Type.Boolean({ description: "Treat pattern as a regular expression" })),
      caseSensitive: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
    }),
    replay: "safe",
    execute: async (args) => {
      let result: GrepResult;
      try {
        result = await host.grep(args.pattern, { regex: args.regex, caseSensitive: args.caseSensitive, limit: args.limit ?? 100 });
      } catch (e) {
        return { output: [{ type: "text", text: `Invalid pattern: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
      if (!result.total) return { output: [{ type: "text", text: "No matches." }] };
      const lines = result.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
      const more = result.total > result.matches.length ? `\n(${result.total - result.matches.length} more lines not shown; narrow the pattern or raise limit.)` : "";
      return { output: [{ type: "text", text: `${result.total} line(s) in ${result.files} file(s).\n${lines.join("\n")}${more}` }] };
    },
  });

  const readPost = defineTool({
    name: "read_post",
    description: "Read one post in full (front matter and body) by its path. Lines are numbered for reference only.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args) => {
      const file = await host.readFile(args.path);
      if (!file) return { output: [{ type: "text", text: `No post at ${args.path}. Use list_posts or search_posts for paths.` }], isError: true };
      const numbered = file.text
        .split("\n")
        .map((line, i) => `${String(i + 1).padStart(4)}| ${line}`)
        .join("\n");
      return { output: [{ type: "text", text: `${args.path}: ${file.title} (${file.url})\n\n${numbered}` }] };
    },
  });

  const proposeChanges = defineTool({
    name: "propose_changes",
    description:
      "Suggest changes to one or more files. For an existing post give `edits`: find/replace pairs where `find` is exact text from that file (no line numbers) that occurs exactly once. For a new post give `create` with the full file text, front matter included, at a path under the content directory. The author reviews every change before it is written.",
    parameters: Type.Object({
      changes: Type.Array(
        Type.Object({
          path: Type.String({ description: "File path as list_posts shows it" }),
          reason: Type.Optional(Type.String({ description: "Why this file changes, in a few words" })),
          edits: Type.Optional(
            Type.Array(
              Type.Object({
                find: Type.String({ description: "Exact text currently in the file" }),
                replace: Type.String({ description: "Replacement text" }),
                reason: Type.Optional(Type.String({ description: "Why, in a few words" })),
              }),
            ),
          ),
          create: Type.Optional(Type.String({ description: "Full text of a new file" })),
        }),
        { minItems: 1, maxItems: MAX_FILES },
      ),
    }),
    replay: "safe",
    execute: async (args) => {
      const site = host.site();
      if (!site) return { output: [{ type: "text", text: "The editor hasn't sent the site yet." }], isError: true };
      const { valid, problems } = await checkChanges(host, site, args.changes);
      const edits = valid.reduce((n, c) => n + (c.edits?.length ?? 0), 0);
      const created = valid.filter((c) => c.create !== undefined).length;
      const summary = `${edits} edit(s) in ${valid.length - created} file(s)${created ? ` and ${created} new file(s)` : ""} sent to the author for review.`;
      return {
        output: [{ type: "text", text: [summary, ...problems].join("\n") }],
        details: { changes: valid } as never,
        isError: valid.length === 0,
      };
    },
  });

  return defineExtension({
    name: "site",
    tools: [listPosts, listTerms, grepPosts, readPost, proposeChanges, ...libraryTools(host)],
    sections: [
      section("role", () => ROLE, { tag: false }),
      section("site", () => {
        const site = host.site();
        if (!site) return undefined;
        const rules = site.siteInstructions.trim();
        const sections = site.sections.map((s) => s || "(root)").join(", ");
        return [
          `Site: ${site.siteName}. Content lives under ${site.contentDir}/${sections ? `, in sections: ${sections}` : ""}.`,
          site.openPath ? `The author currently has ${site.openPath} open in the editor; "this post" means that one.` : "",
          rules ? `The author's writing rules for this site:\n\n${rules}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      }),
    ],
  });
}

/** Validates each proposed file change against the indexed files; keeps what can be applied and explains the rest. */
export async function checkChanges(
  host: Pick<SiteHost, "readFile">,
  site: Pick<SiteContext, "contentDir">,
  changes: readonly FileChange[],
): Promise<{ valid: FileChange[]; problems: string[] }> {
  const valid: FileChange[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const path = change.path.replace(/^\/+/, "");
    const reason = change.reason ? { reason: change.reason } : {};
    if (seen.has(path)) {
      problems.push(`${path}: listed twice; put all of a file's edits in one change.`);
      continue;
    }
    seen.add(path);
    if (path.split("/").some((part) => part === ".." || part === ".")) {
      problems.push(`${path}: paths must not contain . or .. segments.`);
      continue;
    }
    const file = await host.readFile(path);
    if (change.create !== undefined) {
      if (change.edits?.length) problems.push(`${path}: give either edits or create, not both; using create.`);
      if (file) problems.push(`${path}: already exists; propose edits to it instead.`);
      else if (!(path.startsWith(`${site.contentDir}/`) || isNotePath(path)) || !/\.(md|markdown)$/i.test(path)) {
        problems.push(`${path}: new files must be .md, under ${site.contentDir}/ (posts) or ${NOTES_DIR}/ (notes).`);
      }
      else if (!change.create.trim()) problems.push(`${path}: create is empty.`);
      else valid.push({ path, create: change.create, ...reason });
      continue;
    }
    if (!file) {
      problems.push(`${path}: no such post. Use list_posts or search_posts for paths.`);
      continue;
    }
    if (!change.edits?.length) {
      problems.push(`${path}: no edits.`);
      continue;
    }
    const checked = checkEdits(file.text, change.edits);
    problems.push(...checked.problems.map((p) => `${path}: ${p}`));
    if (checked.valid.length) valid.push({ path, edits: checked.valid, ...reason });
  }
  return { valid, problems };
}
