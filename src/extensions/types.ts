// Editor extensions: what an extension declares, and the API its code gets.
//
// An extension is one JavaScript module that runs in its own Web Worker. It
// exports a manifest and a default function that receives `editor`, in the
// style of Pi's extensions:
//
//   export const manifest = { id: "readability", name: "Readability", permissions: ["post:read", "ui"] };
//   export default function (editor) {
//     const grade = editor.ui.status("grade", "Grade –");
//     editor.on("post:change", ({ text }) => grade.set(`Grade ${score(text)}`));
//   }
//
// The worker has no DOM and no folder access. Everything goes through
// `editor`, and the host checks each call against the manifest's permissions.

import type { AgentScope, JsonSchema, ToolOutcome } from "../shared/extensions";

export type Permission =
  /** The open post's text, path and selection, and post events. */
  | "post:read"
  /** Edits to the open post. Always undoable, and never saved for the author. */
  | "post:write"
  /** Read files in the current site folder. */
  | "site:read"
  /** Commands, toolbar buttons, status items, notices, dialogs and panels. */
  | "ui"
  /** Agent tools, skills, quick edits and system prompt sections. */
  | "agent"
  /** See and change every agent tool call and its result. */
  | "agent:hooks"
  /** fetch() and WebSockets from the worker. */
  | "network"
  /** List, read and install extensions. Only built-in extensions can have it. */
  | "extensions";

export const PERMISSIONS: Record<Permission, string> = {
  "post:read": "Read the open post",
  "post:write": "Suggest edits to the open post (undoable, never saved for you)",
  "site:read": "Read files in the site folder",
  ui: "Add commands, buttons, status items and panels",
  agent: "Add tools, skills and quick edits to the assistant",
  "agent:hooks": "See and change every assistant tool call",
  network: "Connect to the network",
  extensions: "Install and change extensions (built-in only)",
};

export interface ExtensionManifest {
  /** Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  description?: string;
  version?: string;
  permissions: Permission[];
}

/** Where an extension came from. */
export type ExtensionOrigin = "builtin" | "site" | "installed";

export interface ExtensionRecord {
  manifest: ExtensionManifest;
  source: string;
  origin: ExtensionOrigin;
  /** For installed extensions: the URL or file name it came from. */
  from?: string;
}

/** A range of the post text (front matter included), as character offsets. */
export interface Annotation {
  from: number;
  to: number;
  severity?: "info" | "warning" | "error";
  message: string;
}

export interface CommandSpec {
  id: string;
  title: string;
  /** CodeMirror-style key, e.g. "Mod-Shift-r". */
  key?: string;
}

export interface ButtonSpec {
  id: string;
  label: string;
  title?: string;
}

export interface PanelSpec {
  id: string;
  title: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters?: JsonSchema;
  replay?: "safe";
  scope?: AgentScope;
}

export interface SkillSpec {
  name: string;
  description: string;
  instructions: string;
  scope?: AgentScope;
}

export interface QuickEditSpec {
  id: string;
  name: string;
  prompt: string;
}

/** The skill shape the agent harness uses (see the skills work); extensions' skills carry `source: "extension:<id>"`. */
export interface AgentSkill {
  name: string;
  description: string;
  instructions: string;
  source?: string;
  scope?: AgentScope;
}

export interface PostSnapshot {
  path: string;
  url: string;
  title: string;
  siteName: string;
  /** The whole file, front matter included, as it is in the editor (saved or not). */
  text: string;
  /** Offset of the markdown body in `text`. */
  bodyStart: number;
  selection: { from: number; to: number };
  unsaved: boolean;
}

export type EditorEvent = "post:open" | "post:change" | "post:save" | "post:close" | "agent:run-start" | "agent:run-end";

export type { ToolOutcome };
