import type { Env } from "../env";
import { ConversationObject } from "./conversation";
import { fetchReadable, webSearcher } from "./web";
import { createWritingExtension } from "./writing";

/** One agent conversation about one post. Post text lives here only as context. */
export class AgentSession extends ConversationObject<"post"> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, "post", (self) => {
      const index = () => (self as AgentSession).siteIndex();
      return [
        createWritingExtension({
          post: () => (self as AgentSession).current,
          searchPosts: (query, limit) => index()?.search(query, limit) ?? Promise.resolve([]),
          readPastPost: async (path) => (await index()?.get(path)) ?? undefined,
          webSearch: webSearcher(env),
          fetchUrl: fetchReadable,
        }),
      ];
    });
  }

  private siteIndex() {
    return this.index(this.current?.siteId);
  }
}
