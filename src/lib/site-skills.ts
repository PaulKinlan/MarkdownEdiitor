import { byteLength, isSkillTextFile, parseSkillMarkdown, SITE_SKILL_DIRS, SKILL_TOTAL_LIMIT, type Skill, type SkillOrigin } from "../shared/skills";
import { getDir, listNames, readText, walk, writeFile } from "./fs";

/** Where an installed skill came from, kept next to its SKILL.md so it can be updated. */
const ORIGIN_FILE = ".origin.json";

/**
 * Skills kept in the site folder, one per subfolder with a SKILL.md, in the
 * same layout coding agents use (.agents/skills/<name>/SKILL.md or
 * .claude/skills/<name>/SKILL.md), with the text files next to it. Folders
 * that don't parse are skipped.
 */
export async function loadSiteSkills(root: FileSystemDirectoryHandle): Promise<Skill[]> {
  const found = await Promise.all(
    SITE_SKILL_DIRS.map(async (dir) => {
      const names = await listNames(root, dir, "directory").catch(() => []);
      const skills = await Promise.all(names.map((name) => loadSkillFolder(root, `${dir}/${name}`, name).catch(() => undefined)));
      return skills.filter((s): s is Skill => !!s);
    }),
  );
  return found.flat();
}

async function loadSkillFolder(root: FileSystemDirectoryHandle, dir: string, name: string): Promise<Skill | undefined> {
  const text = await readText(root, `${dir}/SKILL.md`);
  const skill = text ? parseSkillMarkdown(text, "site", name) : undefined;
  if (!skill) return undefined;
  const files: Record<string, string> = {};
  let total = byteLength(skill.instructions);
  for (const entry of await walk(root, dir, () => true)) {
    const path = entry.path.slice(dir.length + 1);
    if (path === "SKILL.md") continue;
    const file = await entry.handle.getFile();
    if (!isSkillTextFile(path, file.size) || total + file.size > SKILL_TOTAL_LIMIT) continue;
    files[path] = await file.text();
    total += file.size;
  }
  let origin: SkillOrigin | undefined;
  try {
    origin = JSON.parse((await readText(root, `${dir}/${ORIGIN_FILE}`)) ?? "null") ?? undefined;
  } catch {
    origin = undefined;
  }
  return { ...skill, ...(origin ? { origin } : {}), ...(Object.keys(files).length ? { files } : {}), folder: dir };
}

/** Writes a skill into the site (by default .agents/skills/<name>/), replacing any earlier copy. Returns the folder. */
export async function installSiteSkill(root: FileSystemDirectoryHandle, skill: Skill, markdown: string, dir = `${SITE_SKILL_DIRS[0]}/${skill.name}`): Promise<string> {
  await removeSiteSkill(root, dir);
  await writeFile(root, `${dir}/SKILL.md`, markdown);
  for (const [path, text] of Object.entries(skill.files ?? {})) await writeFile(root, `${dir}/${path}`, text);
  if (skill.origin) await writeFile(root, `${dir}/${ORIGIN_FILE}`, JSON.stringify(skill.origin, null, 2) + "\n");
  return dir;
}

export async function removeSiteSkill(root: FileSystemDirectoryHandle, dir: string): Promise<void> {
  const parts = dir.split("/");
  const name = parts.pop()!;
  const parent = await getDir(root, parts.join("/"));
  try {
    await parent?.removeEntry(name, { recursive: true });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
  }
}
