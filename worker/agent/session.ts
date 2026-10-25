import type { Env } from "../env";
import { ConversationObject } from "./conversation";
import { postProfile } from "./profiles/post";

/** One agent conversation about one post (see profiles/post.ts). */
export class AgentSession extends ConversationObject<"post"> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, postProfile);
  }
}
