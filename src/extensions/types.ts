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
  /** Read files in the current site folder, and hear when they change. */
  | "site:read"
  /** Write files in the site folder, each after the author reviews it (or in folders they allowed). */
  | "site:write"
  /** Commands, toolbar buttons, status items, notices, dialogs and panels. */
  | "ui"
  /** Agent tools, skills, quick edits and system prompt sections. */
  | "agent"
  /** See and change every agent tool call and its result. */
  | "agent:hooks"
  /** fetch() and WebSockets from the worker. */
  | "network"
  /** Notifications from the operating system when the editor is in the background. */
  | "notifications"
  /** Speech recognition from the microphone. */
  | "microphone"
  /** List, read and install extensions. Only built-in extensions can have it. */
  | "extensions";

export const PERMISSIONS: Record<Permission, string> = {
  "post:read": "Read the open post",
  "post:write": "Suggest edits to the open post (undoable, never saved for you)",
  "site:read": "Read files in the site folder",
  "site:write": "Write files in the site folder (you review each one, or allow a folder)",
  ui: "Add commands, buttons, status items and panels",
  agent: "Add tools, skills and quick edits to the assistant",
  "agent:hooks": "See and change every assistant tool call",
  network: "Connect to the network",
  notifications: "Show system notifications",
  microphone: "Listen to the microphone for dictation",
  extensions: "Install and change extensions (built-in only)",
};

export interface ExtensionManifest {
  /** Lowercase letters, digits and dashes. */
  id: string;
  name: string;
  description?: string;
  version?: string;
  permissions: Permission[];
  /** For built-in extensions: false leaves it off until the author turns it on. */
  enabledByDefault?: boolean;
  /** Where it appears among extensions in lists, lower first (default 1000). */
  order?: number;
  /** Settings the author can change in Settings → Extensions; read with `editor.settings.get()`. */
  settings?: Record<string, SettingSpec>;
}

/** One setting: a JSON Schema subset the editor renders as a form field. */
export interface SettingSpec {
  type: "string" | "number" | "boolean";
  title?: string;
  description?: string;
  default?: string | number | boolean;
  /** For strings: the choices, shown as a menu. */
  enum?: string[];
}

export type SettingValues = Record<string, string | number | boolean>;

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

/** A post or note in the open site, as `editor.site.posts()` lists it. */
export interface SitePost {
  path: string;
  url: string;
  title: string;
  section: string;
  date?: string;
  draft: boolean;
  tags: string[];
  categories: string[];
}

/** An entry in a site folder, as `editor.site.list()` gives it. */
export interface SiteEntry {
  name: string;
  kind: "file" | "directory";
}

export type EditorEvent =
  /** A site was opened (`{ id, name }`), or closed (`null`). Need `site:read`. */
  | "site:open"
  | "site:close"
  /** Files in the site folder changed outside the editor, or the editor wrote them for an extension: `{ paths, rescan }`. */
  | "site:files-changed"
  /** The author changed this extension's settings: the new values. */
  | "settings:change"
  | "post:open"
  | "post:change"
  | "post:save"
  | "post:close"
  /** The selection settled: `{ from, to, text }`, offsets in the post text. */
  | "selection"
  | "agent:run-start"
  | "agent:run-end"
  /** Only to the extension that called `speech.start()`. */
  | "speech:result"
  | "speech:end";

export type { ToolOutcome };
