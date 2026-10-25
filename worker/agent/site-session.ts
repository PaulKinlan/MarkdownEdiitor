import type { Env } from "../env";
import { ConversationObject } from "./conversation";
import { createResearchExtension } from "./research";
import { createSiteExtension } from "./site";
import { createSkillsExtension } from "./skills";
import { fetchReadable, webSearcher } from "./web";

/**
 * The site-wide assistant: one conversation per site, with tools over every
 * post (via the site's SiteIndex) and multi-file change proposals the author
 * reviews in the editor.
 */
export class SiteSession extends ConversationObject<"site"> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, "site", (self) => {
      const site = () => (self as SiteSession).current;
      const index = () => (self as SiteSession).index(site()?.siteId);
      return [
        createSiteExtension({
          site,
          listPosts: async (filter) => (await index()?.list(site()?.contentDir ?? "content", filter)) ?? [],
          terms: async (key) => (await index()?.terms(key)) ?? [],
          grep: async (pattern, options) => (await index()?.grep(pattern, options)) ?? { matches: [], total: 0, files: 0 },
          readFile: async (path) => (await index()?.file(path)) ?? undefined,
          searchPosts: async (query, limit) => (await index()?.search(query, limit)) ?? [],
          webSearch: webSearcher(env),
          fetchUrl: fetchReadable,
        }),
        createResearchExtension(),
        createSkillsExtension("site", () => site()?.skills),
      ];
    });
  }
}
