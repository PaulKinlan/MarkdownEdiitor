// Reads an extension's manifest from its source without running it, so the
// author can see what it asks for before any of its code runs.

import { EXTENSION_ID } from "../shared/extensions";
import { PERMISSIONS, type ExtensionManifest, type ExtensionRecord, type Permission, type SettingSpec } from "./types";

const MAX_SOURCE = 512 * 1024;

/** Parses `export const manifest = { ... }` (a plain object literal: strings, numbers, booleans, arrays). */
export function parseExtension(source: string): Omit<ExtensionRecord, "origin"> {
  if (source.length > MAX_SOURCE) throw new Error(`The extension is over ${MAX_SOURCE / 1024} KB.`);
  const start = source.search(/export\s+const\s+manifest\s*=\s*\{/);
  if (start === -1) throw new Error('No manifest: the module needs `export const manifest = { id, name, permissions: [...] }`.');
  const open = source.indexOf("{", start);
  const literal = source.slice(open, matchingBrace(source, open) + 1);
  let value: unknown;
  try {
    value = JSON.parse(objectLiteralToJson(literal));
  } catch (e) {
    throw new Error(`The manifest must be a plain object literal (strings, numbers, arrays): ${e instanceof Error ? e.message : e}`);
  }
  if (!/export\s+default\s/.test(source)) throw new Error("The module needs a default export: `export default function (editor) { ... }`.");
  return { manifest: checkManifest(value), source };
}

export function checkManifest(value: unknown): ExtensionManifest {
  const m = value as Partial<ExtensionManifest>;
  if (!m || typeof m !== "object") throw new Error("The manifest must be an object.");
  if (typeof m.id !== "string" || !EXTENSION_ID.test(m.id)) throw new Error(`Manifest id ${JSON.stringify(m.id)} must be lowercase letters, digits and dashes, starting with a letter.`);
  if (typeof m.name !== "string" || !m.name.trim()) throw new Error("The manifest needs a name.");
  const permissions = Array.isArray(m.permissions) ? m.permissions : [];
  const unknown = permissions.filter((p) => !(p in PERMISSIONS));
  if (unknown.length) throw new Error(`Unknown permission(s): ${unknown.join(", ")}. Known: ${Object.keys(PERMISSIONS).join(", ")}.`);
  return {
    id: m.id,
    name: m.name.trim().slice(0, 60),
    ...(typeof m.description === "string" ? { description: m.description.slice(0, 300) } : {}),
    ...(typeof m.version === "string" ? { version: m.version.slice(0, 20) } : {}),
    ...(m.enabledByDefault === false ? { enabledByDefault: false } : {}),
    ...(typeof m.order === "number" && Number.isFinite(m.order) ? { order: m.order } : {}),
    ...(m.settings === undefined ? {} : { settings: checkSettings(m.settings) }),
    permissions: [...new Set(permissions as Permission[])],
  };
}

const MAX_SETTINGS = 30;

/** `settings`: up to 30 fields, each `{ type: "string" | "number" | "boolean", title?, description?, default?, enum? }`. */
function checkSettings(value: unknown): Record<string, SettingSpec> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("manifest.settings must be an object of fields.");
  const entries = Object.entries(value as Record<string, Partial<SettingSpec>>);
  if (entries.length > MAX_SETTINGS) throw new Error(`manifest.settings has more than ${MAX_SETTINGS} fields.`);
  const out: Record<string, SettingSpec> = {};
  for (const [key, spec] of entries) {
    if (!/^[A-Za-z][\w-]{0,63}$/.test(key)) throw new Error(`Setting name ${JSON.stringify(key)} must be letters, digits, _ and -.`);
    if (!spec || !["string", "number", "boolean"].includes(spec.type as string)) throw new Error(`Setting ${key} needs a type: "string", "number" or "boolean".`);
    const type = spec.type as SettingSpec["type"];
    if (spec.default !== undefined && typeof spec.default !== type) throw new Error(`Setting ${key}'s default isn't a ${type}.`);
    const choices = Array.isArray(spec.enum) && type === "string" ? spec.enum.map(String).slice(0, 50) : undefined;
    out[key] = {
      type,
      ...(typeof spec.title === "string" ? { title: spec.title.slice(0, 80) } : {}),
      ...(typeof spec.description === "string" ? { description: spec.description.slice(0, 300) } : {}),
      ...(spec.default !== undefined ? { default: spec.default } : {}),
      ...(choices?.length ? { enum: choices } : {}),
    };
  }
  return out;
}

/** Index of the brace closing the one at `open`, skipping strings, template literals and comments. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(source, i);
    } else if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) break;
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i) + 1;
      if (i === 0) break;
    } else if (c === "{") {
      depth++;
    } else if (c === "}" && --depth === 0) {
      return i;
    }
  }
  throw new Error("The manifest object isn't closed.");
}

function skipString(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === quote) return i;
  }
  throw new Error("Unterminated string in the manifest.");
}

/** Turns a JS object literal into JSON: quotes bare keys, converts single-quoted strings, drops comments and trailing commas. */
export function objectLiteralToJson(literal: string): string {
  let out = "";
  for (let i = 0; i < literal.length; i++) {
    const c = literal[i];
    if (c === '"') {
      const end = skipString(literal, i);
      out += literal.slice(i, end + 1);
      i = end;
    } else if (c === "'" || c === "`") {
      const end = skipString(literal, i);
      const body = literal.slice(i + 1, end);
      if (c === "`" && body.includes("${")) throw new Error("Template expressions aren't allowed in the manifest.");
      out += JSON.stringify(body.replace(/\\(.)/g, "$1"));
      i = end;
    } else if (c === "/" && literal[i + 1] === "/") {
      i = literal.indexOf("\n", i) - 1;
      if (i < 0) break;
    } else if (c === "/" && literal[i + 1] === "*") {
      i = literal.indexOf("*/", i) + 1;
    } else if (/[A-Za-z_$]/.test(c)) {
      const word = /^[A-Za-z_$][\w$]*/.exec(literal.slice(i))![0];
      const rest = literal.slice(i + word.length);
      if (/^\s*:/.test(rest)) out += JSON.stringify(word);
      else if (["true", "false", "null"].includes(word)) out += word;
      else throw new Error(`Unexpected ${word}: use literal values only.`);
      i += word.length - 1;
    } else {
      out += c;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}
