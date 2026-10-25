import { parseSkillMarkdown, type Skill } from "./skills";
import { BUILTIN_SKILL_FILES } from "./builtin-skills.gen";

// Skills that ship with the editor: one folder per skill in src/skills, with
// a SKILL.md like the ones in a site's .agents/skills (an `order` key sets
// their place in lists). Site folders, the author and extensions can add
// more, or replace one of these by using the same name.

export const BUILTIN_SKILLS: Skill[] = BUILTIN_SKILL_FILES.map((text) => {
  const skill = parseSkillMarkdown(text);
  if (!skill) throw new Error(`A built-in skill has no valid name or description:\n${text.slice(0, 200)}`);
  return skill;
});
