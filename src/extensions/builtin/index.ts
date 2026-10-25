/// <reference types="vite/client" />
// Extensions that ship with the editor: every .js file in this folder except
// text.js. Each is an ordinary extension module; adding one means adding a
// file (its manifest's `order` sets its place in lists), never editing a list
// here. They share helpers from text.js, which is inlined because an
// extension is loaded as a single module with no imports of its own. A
// built-in that contains the string "__API_REFERENCE__" gets docs/extensions.md
// in its place: the extension builder uses it as its skill, so the assistant
// writes extensions against the same reference people read.
import type { ExtensionRecord } from "../types";
import { parseExtension } from "../loader";
import text from "./text.js?raw";
import apiReference from "../../../docs/extensions.md?raw";

const FILES = import.meta.glob<string>(["./*.js", "!./text.js"], { eager: true, query: "?raw", import: "default" });

export function withHelpers(source: string, helpers = text): string {
  const inlined = helpers.replace(/^export /gm, "");
  return `${inlined}\n${source.replace(/^import \{[^}]*\} from "\.\/text\.js";\n/m, "")}`;
}

function prepare(source: string): string {
  if (source.includes('"__API_REFERENCE__"')) return source.replace('"__API_REFERENCE__"', JSON.stringify(apiReference));
  return withHelpers(source);
}

export function builtinExtensions(): ExtensionRecord[] {
  return Object.values(FILES)
    .map((source) => ({ ...parseExtension(prepare(source)), origin: "builtin" as const }))
    .sort((a, b) => (a.manifest.order ?? 1000) - (b.manifest.order ?? 1000) || a.manifest.id.localeCompare(b.manifest.id));
}
