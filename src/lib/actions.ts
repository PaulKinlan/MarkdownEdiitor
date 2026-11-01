/// <reference types="vite/client" />
import { parse } from "yaml";

// "Edits" are saved prompts the assistant runs against the open post, or,
// for site edits, across the whole site. The built-in ones cover common
// passes, one file each in src/quick-edits; authors add their own in the
// Assistant panel, and those are stored in this browser and copied to the
// agent server so other machines get them (see ./synced.ts). Bigger, multi-step
// tasks (fact checking, demos, SEO) are skills: see src/skills.

export type ActionScope = "post" | "site";

export interface EditAction {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
  /** Which assistant runs it. Missing means "post", as edits saved before site edits existed were. */
  scope?: ActionScope;
  /** When a custom edit last changed, for syncing between browsers. */
  updatedAt?: number;
}

/** src/quick-edits/<id>.md: YAML front matter (`name`, `scope`, `order`), then the prompt. */
const FILES = import.meta.glob<string>("../quick-edits/*.md", { eager: true, query: "?raw", import: "default" });

export function parseQuickEdit(id: string, text: string): EditAction & { order: number } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  const data = ((match && parse(match[1])) ?? {}) as { name?: unknown; scope?: unknown; order?: unknown };
  const prompt = (match ? match[2] : text).trim();
  if (typeof data.name !== "string" || !prompt) throw new Error(`Quick edit ${id} needs a name and a prompt.`);
  return { id, name: data.name, prompt, ...(data.scope === "site" ? { scope: "site" as const } : {}), order: Number(data.order ?? 1000) };
}

const ALL = Object.entries(FILES)
  .map(([path, text]) => parseQuickEdit(path.replace(/^.*\/|\.md$/g, ""), text))
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  .map(({ order: _, ...action }): EditAction => action);

export const BUILTIN_ACTIONS: EditAction[] = ALL.filter((a) => a.scope !== "site");

export const SITE_ACTIONS: EditAction[] = ALL.filter((a) => a.scope === "site");

export const KEY = "md-editor:custom-actions";
/** Fired on window when custom edits change, here or from the server. */
export const CUSTOM_ACTIONS_EVENT = "md-editor:custom-actions";

export function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadCustomActions(): EditAction[] {
  return readJson<EditAction[]>(KEY, []);
}
