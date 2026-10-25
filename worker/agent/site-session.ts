import type { Env } from "../env";
import { ConversationObject } from "./conversation";
import { siteProfile } from "./profiles/site";

/** The site-wide assistant, one conversation per site (see profiles/site.ts). */
export class SiteSession extends ConversationObject<"site"> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, siteProfile);
  }
}
