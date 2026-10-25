import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

export interface SearchHit {
  path: string;
  title: string;
  url: string;
  date?: string;
  snippet: string;
}

/** Search over the author's posts and the web, shared by the post and site agents. */
export interface LibraryHost {
  searchPosts(query: string, limit: number): Promise<SearchHit[]>;
  webSearch?(query: string, limit: number): Promise<{ title: string; url: string; snippet: string }[]>;
  fetchUrl?(url: string): Promise<string>;
}

export function libraryTools(host: LibraryHost) {
  const searchPosts = defineTool({
    name: "search_posts",
    description: "Full-text search over the author's published and draft posts on this site. Use it to find related posts to link to, or to check what the author has said before.",
    parameters: Type.Object({
      query: Type.String(),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    }),
    replay: "safe",
    execute: async (args) => {
      const hits = await host.searchPosts(args.query, args.limit ?? 8);
      if (!hits.length) return { output: [{ type: "text", text: "No matching posts." }] };
      const text = hits.map((h) => `- ${h.title} (${h.url})${h.date ? ` ${h.date.slice(0, 10)}` : ""} [${h.path}]\n  ${h.snippet}`).join("\n");
      return { output: [{ type: "text", text }] };
    },
  });

  const tools = [searchPosts];

  if (host.webSearch) {
    const webSearch = host.webSearch;
    tools.push(
      defineTool({
        name: "web_search",
        description: "Search the web. Use it for facts, current events, and primary sources to link to.",
        parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })) }),
        replay: "safe",
        execute: async (args) => {
          const results = await webSearch(args.query, args.limit ?? 6);
          const text = results.map((r) => `- ${r.title}\n  ${r.url}\n  ${r.snippet}`).join("\n") || "No results.";
          return { output: [{ type: "text", text }] };
        },
      }) as never,
    );
  }
  if (host.fetchUrl) {
    const fetchUrl = host.fetchUrl;
    tools.push(
      defineTool({
        name: "fetch_url",
        description: "Fetch a web page and return its readable text, to check a source before citing it.",
        parameters: Type.Object({ url: Type.String() }),
        replay: "safe",
        execute: async (args) => ({ output: [{ type: "text", text: await fetchUrl(args.url) }] }),
      }) as never,
    );
  }

  return tools;
}
