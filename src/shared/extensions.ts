// What editor extensions contribute to the agent, and the calls the agent
// session makes back into the editor to run them. Extension code only runs in
// the browser; the Durable Object installs a Pi Durable extension per editor
// extension whose tools and hooks forward to it (worker/agent/extension-bridge.ts).

/** A JSON Schema object describing a tool's arguments. */
export type JsonSchema = Record<string, unknown>;

export type AgentScope = "post" | "site" | "both";

export interface ExtensionToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** "safe" lets the agent re-run the call after a restart. Only for tools without side effects. */
  replay?: "safe";
  /** Which assistant offers the tool. Defaults to "post". */
  scope?: AgentScope;
}

/** One editor extension, as the agent sees it. Sent whenever the enabled extensions change. */
export interface AgentExtensionSpec {
  id: string;
  name: string;
  tools: ExtensionToolSpec[];
  /** System prompt sections, rendered as `<id-name>` blocks. Names: lowercase letters, digits, `_` and `-`. */
  sections: { name: string; text: string }[];
  /** Which tool hooks the extension registered. */
  hooks: { beforeTool: boolean; afterTool: boolean };
}

export interface ToolOutcome {
  text: string;
  isError?: boolean;
}

export type ExtensionCall =
  | { kind: "tool"; extension: string; name: string; args: unknown }
  | { kind: "beforeTool"; extension: string; tool: string; args: unknown }
  | { kind: "afterTool"; extension: string; tool: string; args: unknown; result: ToolOutcome };

/** What each kind of call resolves to. Hooks resolve to `undefined` to leave the call alone. */
export interface ExtensionCallResults {
  tool: ToolOutcome;
  beforeTool: { block?: string; args?: Record<string, unknown> } | undefined;
  afterTool: ToolOutcome | undefined;
}

/** Pi Durable extension name for an editor extension. */
export function agentExtensionName(id: string): string {
  return `ext:${id}`;
}

/** Extension ids: lowercase letters, digits and dashes, so they are safe in names, tags and storage keys. */
export const EXTENSION_ID = /^[a-z][a-z0-9-]{0,62}$/;
