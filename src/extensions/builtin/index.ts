// Extensions that ship with the editor. Each is an ordinary extension module;
// they share helpers from text.js, which is inlined here because an extension
// is loaded as a single module with no imports of its own. The extension
// builder gets docs/extensions.md as its skill, so the assistant writes
// extensions against the same reference people read.
import type { ExtensionRecord } from "../types";
import { parseExtension } from "../loader";
import text from "./text.js?raw";
import wordCount from "./word-count.js?raw";
import wordGoal from "./word-goal.js?raw";
import editTimes from "./edit-times.js?raw";
import writingStreak from "./writing-streak.js?raw";
import outline from "./outline.js?raw";
import seoCheck from "./seo-check.js?raw";
import linkChecker from "./link-checker.js?raw";
import styleGuide from "./style-guide.js?raw";
import repetition from "./repetition.js?raw";
import tagSuggester from "./tag-suggester.js?raw";
import autosave from "./autosave.js?raw";
import dictation from "./dictation.js?raw";
import emoji from "./emoji.js?raw";
import snippets from "./snippets.js?raw";
import agentAlert from "./agent-alert.js?raw";
import readability from "./readability.js?raw";
import dataChecker from "./data-checker.js?raw";
import builder from "./extension-builder.js?raw";
import apiReference from "../../../docs/extensions.md?raw";

export function withHelpers(source: string, helpers = text): string {
  const inlined = helpers.replace(/^export /gm, "");
  return `${inlined}\n${source.replace(/^import \{[^}]*\} from "\.\/text\.js";\n/m, "")}`;
}

export const BUILTIN_SOURCES = [
  wordCount,
  wordGoal,
  editTimes,
  writingStreak,
  readability,
  repetition,
  styleGuide,
  seoCheck,
  linkChecker,
  dataChecker,
  tagSuggester,
  outline,
  autosave,
  dictation,
  emoji,
  snippets,
  agentAlert,
].map((s) => withHelpers(s)).concat(builder.replace('"__API_REFERENCE__"', JSON.stringify(apiReference)));

export function builtinExtensions(): ExtensionRecord[] {
  return BUILTIN_SOURCES.map((source) => ({ ...parseExtension(source), origin: "builtin" as const }));
}
