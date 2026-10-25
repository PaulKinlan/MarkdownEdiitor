import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolRegistration } from "@earendil-works/pi-durable";
import { serveMcp } from "../mcp-server";
import { analyzePost } from "../agent/post-stats";
import { createResearchExtension } from "../agent/research";
import { createSiteExtension, type SiteHost } from "../agent/site";
import { defineRoutes } from "../route";

// /api/mcp/sites/:siteId: the editor's read-only tools over one site's search
// index, as an MCP server for other agents (Claude Code, Gemini CLI, an ACP
// harness). Same token as the rest of /api, as a Bearer header. Changes
// aren't offered here: they go through the editor, where the author reviews them.

/** Tools that change files, or need the editor's open post, stay with the assistant. */
const LEFT_OUT = new Set(["propose_changes", "web_search", "fetch_url"]);

export type IndexHost = Omit<SiteHost, "site" | "webSearch" | "fetchUrl">;

/** The tools served for one site. */
export function siteMcpTools(host: IndexHost): ToolRegistration[] {
  const site = createSiteExtension({ ...host, site: () => undefined });
  const analyze = defineTool({
    name: "analyze_post",
    description:
      "Measure a post: word count and reading time, heading outline, paragraph and sentence lengths, links (including vague link text), images without alt text, and front matter field lengths. Line numbers match read_post.",
    parameters: Type.Object({ path: Type.String({ description: "File path as list_posts shows it" }) }),
    replay: "safe",
    execute: async (args) => {
      const file = await host.readFile(args.path);
      if (!file) return { output: [{ type: "text", text: `No post at ${args.path}. Use list_posts or search_posts for paths.` }], isError: true };
      return { output: [{ type: "text", text: analyzePost(file.text) }] };
    },
  });
  return [...(site.tools ?? []).filter((t) => !LEFT_OUT.has(t.name)), analyze as ToolRegistration, ...(createResearchExtension().tools ?? [])];
}

export default defineRoutes({
  pattern: /^\/api\/mcp\/sites\/([\w-]{1,100})$/,
  handle({ request, env, url, match }) {
    const index = env.SITE_INDEX.get(env.SITE_INDEX.idFromName(match[1]));
    // Sections in list_posts are folders under the content directory, which only the editor knows; Hugo's default otherwise.
    const contentDir = url.searchParams.get("contentDir") || "content";
    const tools = siteMcpTools({
      listPosts: (filter) => index.list(contentDir, filter),
      terms: (key) => index.terms(key),
      grep: (pattern, options) => index.grep(pattern, options),
      readFile: async (path) => (await index.file(path)) ?? undefined,
      searchPosts: (query, limit) => index.search(query, limit),
    });
    return serveMcp(request, tools, {
      name: "hugo-editor",
      version: "1.0.0",
      instructions:
        "Tools over the author's Hugo blog as the editor last indexed it: list, search, grep and read posts and research notes, count tags and categories, and measure a post. They read only; to change a post, describe the change for the author.",
    });
  },
});
