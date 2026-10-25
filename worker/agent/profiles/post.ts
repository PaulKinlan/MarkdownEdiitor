import type { Profile } from "../conversation";
import { createResearchExtension } from "../research";
import { createSkillsExtension } from "../skills";
import { pageFetcher, webSearcher } from "../web";
import { createWritingExtension } from "../writing";

/** The post assistant: one conversation about one post. Post text lives in the session only as context. */
export const postProfile: Profile<"post"> = {
  kind: "post",
  extensions: (self, env) => [
    createWritingExtension({
      post: () => self.context(),
      searchPosts: (query, limit) => self.index()?.search(query, limit) ?? Promise.resolve([]),
      readPastPost: async (path) => (await self.index()?.get(path)) ?? undefined,
      webSearch: webSearcher(env),
      fetchUrl: pageFetcher(env),
    }),
    createResearchExtension(),
    createSkillsExtension("post", () => self.allSkills()),
  ],
};
