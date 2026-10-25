import { parseSkillMarkdown, SITE_SKILL_DIRS, type Skill } from "../shared/skills";
import { listNames, readText } from "./fs";

/**
 * Skills kept in the site folder, one per subfolder with a SKILL.md, in the
 * same layout coding agents use (.agents/skills/<name>/SKILL.md or
 * .claude/skills/<name>/SKILL.md). Files that don't parse are skipped.
 */
export async function loadSiteSkills(root: FileSystemDirectoryHandle): Promise<Skill[]> {
  const found = await Promise.all(
    SITE_SKILL_DIRS.map(async (dir) => {
      const names = await listNames(root, dir, "directory").catch(() => []);
      const skills = await Promise.all(
        names.map(async (name) => {
          const text = await readText(root, `${dir}/${name}/SKILL.md`).catch(() => undefined);
          return text ? parseSkillMarkdown(text, "site", name) : undefined;
        }),
      );
      return skills.filter((s): s is Skill => !!s);
    }),
  );
  return found.flat();
}
