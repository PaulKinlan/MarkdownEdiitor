import { parse } from "yaml";

// A skill is a named, reusable set of instructions the agent loads when a task
// calls for it. The agent sees every skill's name and description, and reads
// the full instructions with load_skill only when it uses one. The shape
// follows SKILL.md (YAML front matter with name and description, then a
// markdown body), so skills can come from files in the site folder, from the
// author, or from extensions, as well as the built-in ones.

export type SkillScope = "post" | "site" | "both";

export interface Skill {
  /** Kebab-case id, unique across all skills. A later skill with the same name replaces an earlier one. */
  name: string;
  /** When to use it, in a sentence or two. The agent picks skills by this. */
  description: string;
  /** The full instructions, in markdown. */
  instructions: string;
  /** Short display name for buttons. Defaults to the name in title case. */
  title?: string;
  /** Which assistant the skill fits: one post, the whole site, or both. Defaults to "post". */
  scope?: SkillScope;
  /** Where it came from: "builtin", "site", "installed", or "extension:<id>". */
  source?: string;
  /** For skills installed from GitHub: the folder they came from, to update them later. */
  origin?: SkillOrigin;
  /** For skills in the site folder: the folder that holds it, e.g. ".agents/skills/noslop". */
  folder?: string;
  /** Supporting files next to SKILL.md (relative path → text) that the instructions refer to. */
  files?: Record<string, string>;
}

export interface SkillOrigin {
  owner: string;
  repo: string;
  /** Branch, tag or commit; "HEAD" for the default branch. */
  ref: string;
  /** The skill's folder in the repo ("" for the root). */
  path: string;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Parses a SKILL.md file. Returns undefined when it has no valid name or description. */
export function parseSkillMarkdown(text: string, source?: string, fallbackName?: string): Skill | undefined {
  const match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let data: Record<string, unknown> = {};
  if (match) {
    try {
      data = (parse(match[1]) as Record<string, unknown>) ?? {};
    } catch {
      return undefined;
    }
  }
  const name = toSkillName(String(data.name ?? fallbackName ?? ""));
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const instructions = (match ? match[2] : text).trim();
  if (!NAME.test(name) || !description || !instructions) return undefined;
  const scope = data.scope === "site" || data.scope === "both" || data.scope === "post" ? data.scope : undefined;
  return {
    name,
    description,
    instructions,
    ...(typeof data.title === "string" && data.title.trim() ? { title: data.title.trim() } : {}),
    ...(scope ? { scope } : {}),
    ...(source ? { source } : {}),
  };
}

/** Lowercase words joined by hyphens, as skill names are: "No_Slop Writer" → "no-slop-writer". */
export function toSkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Merges skill lists in order; a later skill replaces an earlier one with the same name. */
export function mergeSkills(...lists: (readonly Skill[] | undefined)[]): Skill[] {
  const byName = new Map<string, Skill>();
  for (const list of lists) for (const skill of list ?? []) if (NAME.test(skill.name)) byName.set(skill.name, skill);
  return [...byName.values()];
}

export function skillsFor(skills: readonly Skill[], scope: "post" | "site"): Skill[] {
  return skills.filter((s) => (s.scope ?? "post") === scope || s.scope === "both");
}

export function skillTitle(skill: Skill): string {
  return skill.title ?? skill.name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** The prompt sent when the author runs a skill from the panel. */
export function skillPrompt(skill: Skill): string {
  return `Use the ${skill.name} skill on this post.`;
}

/** Folders in a site where SKILL.md files are looked for, one skill per subfolder. New installs go in the first. */
export const SITE_SKILL_DIRS = [".agents/skills", ".claude/skills"];

/** Supporting files are text, and capped so a skill stays small enough to send to the agent. */
export const SKILL_FILE_LIMIT = 200_000;
export const SKILL_TOTAL_LIMIT = 1_000_000;
const TEXT_FILE = /\.(md|markdown|txt|json|ya?ml|toml|csv|tsv|html?|css|js|mjs|ts|xml|svg)$/i;

/** Size in UTF-8 bytes, the unit the limits and GitHub's file sizes use. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Whether a file next to SKILL.md is worth keeping with the skill. */
export function isSkillTextFile(path: string, size: number): boolean {
  return TEXT_FILE.test(path) && size <= SKILL_FILE_LIMIT && !/(^|\/)\./.test(path) && !/(^|\/)LICENSE/i.test(path);
}

/**
 * For models without tools (the on-device one): when `text` runs a skill,
 * appends the skill's instructions so the model doesn't need load_skill.
 */
export function inlineSkill(text: string, skills: readonly Skill[], maxChars = INLINE_SKILL_CHARS): string {
  const name = text.match(/^Use the ([a-z0-9-]+) skill on this post\.$/)?.[1];
  const skill = name ? skills.find((s) => s.name === name) : undefined;
  if (!skill) return text;
  // Supporting files the instructions refer to go along too, as far as the budget allows.
  let budget = maxChars - skill.instructions.length;
  const files: string[] = [];
  const left: string[] = [];
  for (const [path, body] of Object.entries(skill.files ?? {})) {
    if (body.length <= budget) {
      files.push(`<file path="${path}">\n${body}\n</file>`);
      budget -= body.length;
    } else left.push(path);
  }
  const omitted = left.length ? `\n\n(Files left out to fit: ${left.join(", ")}.)` : "";
  return `${text}\n\n<skill name="${skill.name}">\n${skill.instructions}${files.length ? `\n\n${files.join("\n\n")}` : ""}\n</skill>${omitted}\n\nYou have no tools here: work from the post alone, skip steps that need a tool, and say which you skipped.`;
}

/** How much skill text goes inline to a model without tools, leaving room for the post in a small context window. */
const INLINE_SKILL_CHARS = 12_000;
