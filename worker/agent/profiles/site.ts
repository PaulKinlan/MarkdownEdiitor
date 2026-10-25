import type { Profile } from "../conversation";
import { createResearchExtension } from "../research";
import { createSiteExtension } from "../site";
import { createSkillsExtension } from "../skills";
import { pageFetcher, webSearcher } from "../web";

/**
 * The site-wide assistant: one conversation per site, with tools over every
 * post (via the site's SiteIndex) and multi-file change proposals the author
 * reviews in the editor.
 */
export const siteProfile: Profile<"site"> = {
  kind: "site",
  extensions: (self, env) => {
    const site = () => self.context();
    const index = () => self.index();
    return [
      createSiteExtension({
        site,
        listPosts: async (filter) => (await index()?.list(site()?.contentDir ?? "content", filter)) ?? [],
        terms: async (key) => (await index()?.terms(key)) ?? [],
        grep: async (pattern, options) => (await index()?.grep(pattern, options)) ?? { matches: [], total: 0, files: 0 },
        readFile: async (path) => (await index()?.file(path)) ?? undefined,
        searchPosts: async (query, limit) => (await index()?.search(query, limit)) ?? [],
        webSearch: webSearcher(env),
        fetchUrl: pageFetcher(env),
      }),
      createResearchExtension(),
      createSkillsExtension("site", () => self.allSkills()),
    ];
  },
};
