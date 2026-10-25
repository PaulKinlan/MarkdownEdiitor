// Messages between the editor (browser) and an agent session (Durable Object).

import type { Skill } from "./skills";
import type { AgentExtensionSpec, ExtensionCall } from "./extensions";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface ModelInfo extends ModelRef {
  name: string;
  reasoning: boolean;
  contextWindow: number;
  /** Answers with the provider's own server-side web search when native web tools are on. */
  nativeWebSearch?: boolean;
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

/** What the site-wide agent knows about the site. Sent on connect and whenever it changes. */
export interface SiteContext {
  siteId: string;
  siteName: string;
  siteInstructions: string;
  /** Hugo's content directory, e.g. "content". New posts must go under it. */
  contentDir: string;
  /** Sections (top-level content folders) with posts, most used first. */
  sections: string[];
  /** The post open in the editor, if any, so "this post" means something. */
  openPath?: string;
  /** Skills beyond the built-in ones; only those scoped "site" or "both" reach the site agent. */
  skills?: Skill[];
}

/**
 * A proposed change to one file on the site: find/replace edits to an
 * existing file, or the full text of a new one.
 */
export interface FileChange {
  path: string;
  edits?: Edit[];
  create?: string;
  reason?: string;
}

/** A find/replace suggestion. `find` must occur exactly once in the post text. */
export interface Edit {
  find: string;
  replace: string;
  reason?: string;
}

/**
 * Messages from the editor to a session, by `type`. A feature adds its own
 * next to its code instead of editing this list:
 *
 *   declare module "../shared/protocol" {
 *     interface ClientMessages { "git:status": { paths: string[] } }
 *   }
 *
 * and registers a handler for it (a profile's `messages` on the server).
 */
export interface ClientMessages {
  post: { post: PostContext };
  /** Every skill beyond the built-in ones (site folder, installed, extensions). Sent on connect and when they change. */
  skills: { skills: Skill[] };
  site: { site: SiteContext };
  prompt: { text: string; model: ModelRef; requestId: string; label?: string };
  abort: {};
  reset: {};
  /** The editor extensions that are enabled now; replaces the previous set. */
  extensions: { extensions: AgentExtensionSpec[] };
  /** The answer to an `extension_call`. */
  extension_result: { callId: string; ok: boolean; value?: unknown; error?: string };
}

/** Messages from a session to the editor, by `type`; extended the same way as ClientMessages. */
export interface ServerMessages {
  view: { items: ChatItem[]; busy: boolean; partial?: string; usage?: { cost: number; tokens: number } };
  error: { message: string };
  /** The agent wants an editor extension to run a tool or hook; answered with `extension_result`. */
  extension_call: { callId: string; call: ExtensionCall };
}

type Union<M> = { [K in keyof M]: { type: K } & M[K] }[keyof M];

export type ClientToServer = Union<ClientMessages>;

export type ServerToClient = Union<ServerMessages>;

/** One message of a given type. */
export type ClientMessage<K extends keyof ClientMessages> = Extract<ClientToServer, { type: K }>;
export type ServerMessage<K extends keyof ServerMessages> = Extract<ServerToClient, { type: K }>;

export type ChatItem =
  | { kind: "user"; id: number; text: string; label?: string }
  | { kind: "assistant"; id: number; text: string; error?: string; model?: string }
  | { kind: "tool"; id: number; callId: string; name: string; args: unknown; status: "running" | "done" | "error"; summary?: string; edits?: Edit[]; changes?: FileChange[] };

export interface IndexedPost {
  path: string;
  title: string;
  url: string;
  date?: string;
  lastModified: number;
  draft: boolean;
  /** Front matter as data, for listing and taxonomy tools. */
  frontMatter: Record<string, unknown>;
  /** Markdown body without front matter; what full-text search ranks. */
  body: string;
  /** The whole file, front matter included; what site-wide edits match against. */
  text: string;
}
