import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";
import { BUILTIN_SKILLS } from "../../src/shared/builtin-skills";
import { mergeSkills, skillsFor, type Skill } from "../../src/shared/skills";

/**
 * Skills for one assistant scope: a catalog of every skill's name and
 * description in the system prompt, and load_skill to read one in full. The
 * catalog changes only when the set of skills does, so prompt caches stay warm.
 * `extra` returns the skills beyond the built-in ones (site folder, the
 * author's own, extensions); a later skill replaces an earlier one by name.
 */
export function createSkillsExtension(scope: "post" | "site", extra: () => readonly Skill[] | undefined) {
  const skills = () => skillsFor(mergeSkills(BUILTIN_SKILLS, extra()), scope);

  const loadSkill = defineTool({
    name: "load_skill",
    description:
      "Load a skill's full instructions by name, from the skills listed in the system prompt. Call it before doing the task a skill covers, then follow the instructions. Some skills have supporting files their instructions refer to; load one with `file`.",
    parameters: Type.Object({
      name: Type.String({ description: "The skill's name, e.g. fact-check" }),
      file: Type.Optional(Type.String({ description: "A supporting file's path, as load_skill listed it, e.g. style-and-bans.md" })),
    }),
    replay: "safe",
    execute: async (args) => {
      const all = skills();
      const skill = all.find((s) => s.name === args.name.trim().toLowerCase());
      if (!skill) {
        return { output: [{ type: "text", text: `No skill named ${args.name}. Available: ${all.map((s) => s.name).join(", ") || "none"}.` }], isError: true };
      }
      const files = Object.keys(skill.files ?? {}).sort();
      if (args.file) {
        const path = args.file.trim().replace(/^\.?\//, "");
        const text = skill.files?.[path];
        if (text === undefined) {
          return { output: [{ type: "text", text: `${skill.name} has no file ${args.file}. Files: ${files.join(", ") || "none"}.` }], isError: true };
        }
        return { output: [{ type: "text", text }] };
      }
      const listing = files.length
        ? `\n\n---\nSupporting files for this skill (load one with load_skill({ name: "${skill.name}", file })): ${files.join(", ")}`
        : "";
      return { output: [{ type: "text", text: skill.instructions + listing }] };
    },
  });

  return defineExtension({
    name: "skills",
    tools: [loadSkill],
    sections: [
      section("skills", () => {
        const all = skills();
        if (!all.length) return undefined;
        return [
          "Skills are instructions for tasks writers often need. When the author asks for one by name, or a request matches a skill's description, call load_skill with its name first and follow what it says. Use at most the skills the task needs.",
          "",
          ...all.map((s) => `- ${s.name}: ${s.description}`),
        ].join("\n");
      }),
    ],
  });
}
