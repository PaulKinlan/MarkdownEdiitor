// Messages between the editor (browser) and an agent session (Durable Object).

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
}

/** A find/replace suggestion. `find` must occur exactly once in the post text. */
export interface Edit {
  find: string;
  replace: string;
  reason?: string;
}

export type ClientToServer =
  | { type: "post"; post: PostContext }
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
