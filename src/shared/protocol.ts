// Messages between the editor (browser) and an agent session (Durable Object).

import type { Skill } from "./skills";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface ModelInfo extends ModelRef {
  name: string;
  reasoning: boolean;
  contextWindow: number;
}

/** What the agent knows about the post being edited. Sent on connect and whenever it changes. */
export interface PostContext {
  siteId: string;
  siteName: string;
  /** Rules for writing on this site, e.g. the site's CLAUDE.md or AGENTS.md. */
  siteInstructions: string;
  path: string;
  url: string;
  /** The whole file, front matter included, as it is in the editor (saved or not). */
  text: string;
  /** Names of the site's Hugo shortcodes, so agents can use them. */
  shortcodes?: string[];
  /** More skills, merged after those sent with a `skills` message. Prefer the message: this is resent while typing. */
  skills?: Skill[];
}

/** A find/replace suggestion. `find` must occur exactly once in the post text. */
export interface Edit {
  find: string;
  replace: string;
  reason?: string;
}

export type ClientToServer =
  | { type: "post"; post: PostContext }
  /** Every skill beyond the built-in ones (site folder, installed, extensions). Sent on connect and when they change. */
  | { type: "skills"; skills: Skill[] }
  | { type: "prompt"; text: string; model: ModelRef; requestId: string; label?: string }
  | { type: "abort" }
  | { type: "reset" };

export type ChatItem =
  | { kind: "user"; id: number; text: string; label?: string }
  | { kind: "assistant"; id: number; text: string; error?: string; model?: string }
  | { kind: "tool"; id: number; callId: string; name: string; args: unknown; status: "running" | "done" | "error"; summary?: string; edits?: Edit[] };

export type ServerToClient =
  | { type: "view"; items: ChatItem[]; busy: boolean; partial?: string; usage?: { cost: number; tokens: number } }
  | { type: "error"; message: string };

export interface IndexedPost {
  path: string;
  title: string;
  url: string;
  date?: string;
  lastModified: number;
  body: string;
}
