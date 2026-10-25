import { get, set } from "idb-keyval";
import { isSkillTextFile, parseSkillMarkdown, SKILL_TOTAL_LIMIT, type Skill, type SkillOrigin } from "../shared/skills";

// Installing skills from GitHub. A repo can hold one skill (SKILL.md at the
// root) or many (any folder with a SKILL.md, e.g. skills/noslop/). The
// browser talks to GitHub directly: one tree listing from the API, then raw
// file downloads, which aren't rate limited.

/** Parses "owner/repo", "github.com/owner/repo", or a /tree/<ref>/<path> or /blob/... URL. */
export function parseGitHubSource(input: string): SkillOrigin | undefined {
  const text = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const short = text.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], repo: short[2], ref: "HEAD", path: "" };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
  const [owner, repo, kind, ref, ...rest] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (!owner || !repo) return undefined;
  if (kind !== "tree" && kind !== "blob") return { owner, repo, ref: "HEAD", path: "" };
  let path = rest.join("/");
  if (kind === "blob" && /(^|\/)SKILL\.md$/i.test(path)) path = path.replace(/\/?SKILL\.md$/i, "");
  return { owner, repo, ref: ref ?? "HEAD", path };
}

export function originLabel(origin: SkillOrigin): string {
  return `${origin.owner}/${origin.repo}${origin.path ? `/${origin.path}` : ""}${origin.ref !== "HEAD" ? `@${origin.ref}` : ""}`;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
}

/** A skill folder found in a repo, before its files are downloaded. */
export interface SkillCandidate {
  origin: SkillOrigin;
  /** Text files in the folder, relative to it, SKILL.md first. */
  files: { path: string; size: number }[];
}

async function listTree(origin: SkillOrigin, fetcher: typeof fetch): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const res = await fetcher(`https://api.github.com/repos/${origin.owner}/${origin.repo}/git/trees/${encodeURIComponent(origin.ref)}?recursive=1`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) throw new Error(`${origin.owner}/${origin.repo} wasn't found, or it's private.`);
  if (res.status === 403 || res.status === 429) throw new Error("GitHub's rate limit for this network was reached. Try again in a while.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  const data = (await res.json()) as { tree?: TreeEntry[]; truncated?: boolean };
  return { entries: data.tree ?? [], truncated: !!data.truncated };
}

/** Finds the skill folders at or under `origin.path`. */
export async function findSkills(origin: SkillOrigin, fetcher: typeof fetch = fetch): Promise<{ skills: SkillCandidate[]; truncated: boolean }> {
  const { entries, truncated } = await listTree(origin, fetcher);
  const base = origin.path ? `${origin.path}/` : "";
  const blobs = entries.filter((e) => e.type === "blob" && (e.path + "/").startsWith(base));
  const dirs = blobs
    .filter((e) => /(^|\/)SKILL\.md$/.test(e.path))
    .map((e) => e.path.replace(/\/?SKILL\.md$/, ""))
    .filter((dir) => !dir.split("/").some((part) => part === "node_modules" || part.startsWith(".git")));
  const skills = dirs.map((dir) => {
    const prefix = dir ? `${dir}/` : "";
    // A skill's files are its folder's, minus those belonging to a skill nested inside it.
    const nested = dirs.filter((d) => d !== dir && d.startsWith(prefix)).map((d) => `${d}/`);
    const files = blobs
      .filter((e) => e.path.startsWith(prefix) && !nested.some((n) => e.path.startsWith(n)))
      .map((e) => ({ path: e.path.slice(prefix.length), size: e.size ?? 0 }))
      .filter((f) => f.path === "SKILL.md" || isSkillTextFile(f.path, f.size))
      .sort((a, b) => (a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.localeCompare(b.path)));
    return { origin: { ...origin, path: dir }, files };
  });
  return { skills, truncated };
}

/** A downloaded skill, with its SKILL.md as written so a copy in the site folder keeps every field. */
export interface DownloadedSkill {
  skill: Skill;
  markdown: string;
}

/** Downloads a skill folder. Supporting files beyond the size budget are left out. */
export async function downloadSkill(candidate: SkillCandidate, fetcher: typeof fetch = fetch): Promise<DownloadedSkill> {
  const { owner, repo, ref, path } = candidate.origin;
  const raw = (file: string) =>
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${[path, file].filter(Boolean).join("/").split("/").map(encodeURIComponent).join("/")}`;
  const read = async (file: string) => {
    const res = await fetcher(raw(file));
    if (!res.ok) throw new Error(`Couldn't download ${file} (${res.status}).`);
    return res.text();
  };
  const fallbackName = path.split("/").pop() || repo;
  const markdown = await read("SKILL.md");
  const skill = parseSkillMarkdown(markdown, "installed", fallbackName);
  if (!skill) throw new Error(`${originLabel(candidate.origin)}/SKILL.md needs a name and description in its front matter, and instructions.`);
  const files: Record<string, string> = {};
  let total = skill.instructions.length;
  for (const f of candidate.files) {
    if (f.path === "SKILL.md" || total + f.size > SKILL_TOTAL_LIMIT) continue;
    files[f.path] = await read(f.path);
    total += files[f.path].length;
  }
  return { skill: { ...skill, origin: candidate.origin, ...(Object.keys(files).length ? { files } : {}) }, markdown };
}

/** Lists the skills at a GitHub source and downloads them all. */
export async function fetchSkillsFromGitHub(input: string, fetcher: typeof fetch = fetch): Promise<{ skills: DownloadedSkill[]; truncated: boolean }> {
  const origin = parseGitHubSource(input);
  if (!origin) throw new Error("Enter a GitHub repo, like owner/repo or a github.com link to a folder.");
  const { skills, truncated } = await findSkills(origin, fetcher);
  if (!skills.length) throw new Error(`No SKILL.md found in ${originLabel(origin)}${truncated ? " (the repo is too big to list; link to the skill's folder instead)" : ""}.`);
  return { skills: await Promise.all(skills.map((s) => downloadSkill(s, fetcher))), truncated };
}

/** Downloads an installed skill again from where it came from. */
export async function refreshSkill(skill: Skill, fetcher: typeof fetch = fetch): Promise<DownloadedSkill> {
  if (!skill.origin) throw new Error(`${skill.name} wasn't installed from GitHub.`);
  const { skills } = await findSkills(skill.origin, fetcher);
  const candidate = skills.find((s) => s.origin.path === skill.origin!.path);
  if (!candidate) throw new Error(`${originLabel(skill.origin)} no longer has a SKILL.md.`);
  return downloadSkill(candidate, fetcher);
}

// ---- skills installed in this browser, for every site ----

const KEY = "md-editor:installed-skills";

export async function loadInstalledSkills(): Promise<Skill[]> {
  try {
    return ((await get<Skill[]>(KEY)) ?? []).map((s) => ({ ...s, source: "installed" }));
  } catch {
    return [];
  }
}

export async function saveInstalledSkills(skills: Skill[]): Promise<void> {
  await set(KEY, skills);
}
