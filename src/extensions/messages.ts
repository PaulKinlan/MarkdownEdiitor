// Messages between the extension host (the page) and an extension's worker.

import type { ExtensionManifest, Permission } from "./types";

/** What the worker asks the host for. Each method needs the permissions listed in METHOD_PERMISSIONS. */
export interface Methods {
  "document.read": { params: Record<string, never>; result: import("./types").PostSnapshot | null };
  "document.applyEdits": { params: { edits: { find: string; replace: string }[] }; result: { applied: number; problems: string[] } };
  "document.insert": { params: { text: string }; result: boolean };
  "document.annotate": { params: { set: string; annotations: import("./types").Annotation[] }; result: void };
  "document.select": { params: { from: number; to?: number }; result: boolean };
  "document.save": { params: Record<string, never>; result: boolean };
  "document.frontMatter": { params: Record<string, never>; result: Record<string, unknown> | null };
  "document.setFrontMatter": { params: { key: string; value: unknown }; result: boolean };
  "site.readFile": { params: { path: string }; result: string | null };
  "site.list": { params: { path: string }; result: import("./types").SiteEntry[] | null };
  "site.writeFile": { params: { path: string; text: string; reason?: string }; result: boolean };
  "settings.get": { params: Record<string, never>; result: import("./types").SettingValues };
  "site.posts": { params: Record<string, never>; result: import("./types").SitePost[] };
  "ui.notify": { params: { message: string; level?: "info" | "warning" | "error" }; result: void };
  "ui.confirm": { params: { title: string; message?: string }; result: boolean };
  "ui.pick": { params: { title: string; items: string[] }; result: string | null };
  "ui.input": { params: { title: string; value?: string }; result: string | null };
  "ui.alert": { params: { title: string; body?: string }; result: boolean };
  "speech.start": { params: { lang?: string }; result: void };
  "speech.stop": { params: Record<string, never>; result: void };
  "ui.status": { params: { id: string; text: string | null; title?: string }; result: void };
  "ui.panel.render": { params: { id: string; html: string }; result: void };
  "ui.panel.post": { params: { id: string; message: unknown }; result: void };
  "storage.get": { params: { key: string }; result: unknown };
  "storage.set": { params: { key: string; value: unknown }; result: void };
  "agent.prompt": { params: { text: string; label?: string }; result: void };
  "extensions.list": { params: Record<string, never>; result: unknown };
  "extensions.read": { params: { id: string }; result: string | null };
  "extensions.install": { params: { source: string }; result: unknown };
  register: { params: Registration; result: void };
  unregister: { params: { kind: Registration["kind"]; id: string }; result: void };
}

export type Method = keyof Methods;

export type Registration =
  | { kind: "command"; spec: import("./types").CommandSpec }
  | { kind: "button"; spec: import("./types").ButtonSpec }
  | { kind: "panel"; spec: import("./types").PanelSpec }
  | { kind: "tool"; spec: import("./types").ToolSpec }
  | { kind: "skill"; spec: import("./types").SkillSpec }
  | { kind: "edit"; spec: import("./types").QuickEditSpec }
  | { kind: "section"; spec: { name: string; text: string } }
  | { kind: "hook"; spec: { beforeTool?: boolean; afterTool?: boolean; beforeSave?: boolean } };

export const METHOD_PERMISSIONS: Record<Method, Permission[]> = {
  "document.read": ["post:read"],
  "document.applyEdits": ["post:write"],
  "document.insert": ["post:write"],
  "document.annotate": ["post:read", "ui"],
  "document.select": ["post:read", "ui"],
  "document.save": ["post:write"],
  "document.frontMatter": ["post:read"],
  "document.setFrontMatter": ["post:write"],
  "site.readFile": ["site:read"],
  "site.list": ["site:read"],
  "site.writeFile": ["site:write"],
  "settings.get": [],
  "site.posts": ["site:read"],
  "ui.notify": ["ui"],
  "ui.confirm": ["ui"],
  "ui.pick": ["ui"],
  "ui.input": ["ui"],
  "ui.alert": ["notifications"],
  "speech.start": ["microphone"],
  "speech.stop": ["microphone"],
  "ui.status": ["ui"],
  "ui.panel.render": ["ui"],
  "ui.panel.post": ["ui"],
  "storage.get": [],
  "storage.set": [],
  "agent.prompt": ["agent"],
  "extensions.list": ["extensions"],
  "extensions.read": ["extensions"],
  "extensions.install": ["extensions"],
  register: [],
  unregister: [],
};

export const REGISTRATION_PERMISSIONS: Record<Registration["kind"], Permission[]> = {
  command: ["ui"],
  button: ["ui"],
  panel: ["ui"],
  tool: ["agent"],
  skill: ["agent"],
  edit: ["agent"],
  section: ["agent"],
  // Narrowed per hook in the host: tool hooks need "agent:hooks", the save hook "post:write".
  hook: [],
};

/** What the host asks the worker to run. */
export interface Invocations {
  tool: { params: { name: string; args: unknown }; result: import("./types").ToolOutcome };
  command: { params: { id: string }; result: void };
  button: { params: { id: string }; result: void };
  beforeTool: { params: { tool: string; args: unknown }; result: { block?: string; args?: Record<string, unknown> } | undefined };
  afterTool: { params: { tool: string; args: unknown; result: import("./types").ToolOutcome }; result: import("./types").ToolOutcome | undefined };
  beforeSave: { params: { post: import("./types").PostSnapshot }; result: { text?: string; block?: string } | undefined };
  "panel.message": { params: { id: string; message: unknown }; result: void };
}

export type Invocation = keyof Invocations;

export type HostToWorker =
  | { type: "load"; manifest: ExtensionManifest; source: string; post: import("./types").PostSnapshot | null }
  | { type: "event"; name: import("./types").EditorEvent; data: unknown }
  | { type: "invoke"; id: number; name: Invocation; params: unknown }
  | { type: "reply"; id: number; ok: boolean; value?: unknown; error?: string };

export type WorkerToHost =
  | { type: "loaded"; error?: string }
  | { type: "request"; id: number; method: Method; params: unknown }
  | { type: "reply"; id: number; ok: boolean; value?: unknown; error?: string }
  | { type: "log"; level: "warn" | "error"; message: string };

/** The part of a Worker or MessagePort both sides use. */
export interface Port {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener?(type: "message", listener: (e: MessageEvent) => void): void;
}
