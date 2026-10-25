import { get, set } from "idb-keyval";
import { byteLength, isSkillTextFile, parseSkillMarkdown, SKILL_TOTAL_LIMIT, type Skill, type SkillOrigin } from "../shared/skills";

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

const api = (origin: SkillOrigin, path: string) => `https://api.github.com/repos/${origin.owner}/${origin.repo}/${path}`;
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T | undefined> {
  const res = await fetcher(url, { headers: { Accept: "application/vnd.github+json" } });
  if (res.status === 404 || res.status === 422) return undefined;
  if (res.status === 403 || res.status === 429) throw new Error("GitHub's rate limit for this network was reached. Try again in a while.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  return (await res.json()) as T;
}

/** The git tree of the origin's folder: the root commit's tree, or the folder's entry in its parent. */
async function treeSha(origin: SkillOrigin, fetcher: typeof fetch): Promise<string | undefined> {
  if (!origin.path) {
    const commit = await getJson<{ commit?: { tree?: { sha?: string } } }>(api(origin, `commits/${encodePath(origin.ref)}`), fetcher);
    return commit?.commit?.tree?.sha;
  }
  const parts = origin.path.split("/");
  const name = parts.pop()!;
  const listing = await getJson<{ name: string; type: string; sha: string }[]>(
    api(origin, `contents/${encodePath(parts.join("/"))}?ref=${encodeURIComponent(origin.ref)}`),
    fetcher,
  );
  return Array.isArray(listing) ? listing.find((e) => e.name === name && e.type === "dir")?.sha : undefined;
}

/**
 * Lists the origin's folder recursively, with paths relative to the repo.
 * Listing the folder's own tree, not the repo root, keeps big repos within
 * GitHub's limit. In a link like /tree/feature/x/skills/y the branch may
 * contain slashes, so path segments move into the ref until one resolves.
 */
async function listTree(origin: SkillOrigin, fetcher: typeof fetch): Promise<{ origin: SkillOrigin; entries: TreeEntry[]; truncated: boolean }> {
  let candidate = origin;
  for (;;) {
    const sha = await treeSha(candidate, fetcher);
    if (sha) {
      const data = await getJson<{ tree?: TreeEntry[]; truncated?: boolean }>(api(candidate, `git/trees/${sha}?recursive=1`), fetcher);
      const prefix = candidate.path ? `${candidate.path}/` : "";
      return { origin: candidate, entries: (data?.tree ?? []).map((e) => ({ ...e, path: prefix + e.path })), truncated: !!data?.truncated };
    }
    if (!candidate.path || candidate.ref === "HEAD") break;
    const [next, ...rest] = candidate.path.split("/");
    candidate = { ...candidate, ref: `${candidate.ref}/${next}`, path: rest.join("/") };
  }
  throw new Error(`${originLabel(origin)} wasn't found, or the repo is private.`);
}

/** Finds the skill folders at or under `origin.path`. */
export async function findSkills(source: SkillOrigin, fetcher: typeof fetch = fetch): Promise<{ skills: SkillCandidate[]; truncated: boolean }> {
  const { origin, entries, truncated } = await listTree(source, fetcher);
  const blobs = entries.filter((e) => e.type === "blob");
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
    `https://raw.githubusercontent.com/${owner}/${repo}/${encodePath(ref)}/${encodePath([path, file].filter(Boolean).join("/"))}`;
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
  let total = byteLength(skill.instructions);
  for (const f of candidate.files) {
    if (f.path === "SKILL.md" || total + f.size > SKILL_TOTAL_LIMIT) continue;
    files[f.path] = await read(f.path);
    total += byteLength(files[f.path]);
  }
  return { skill: { ...skill, origin: candidate.origin, ...(Object.keys(files).length ? { files } : {}) }, markdown };
}

/** Lists the skills at a GitHub source and downloads them all. */
export async function fetchSkillsFromGitHub(input: string, fetcher: typeof fetch = fetch): Promise<{ skills: DownloadedSkill[]; truncated: boolean }> {
  const origin = parseGitHubSource(input);
  if (!origin) throw new Error("Enter a GitHub repo, like owner/repo or a github.com link to a folder.");
  const { skills, truncated } = await findSkills(origin, fetcher);
  if (!skills.length) throw new Error(`No SKILL.md found in ${originLabel(origin)}${truncated ? " (the folder is too big to list; link to the skill's own folder instead)" : ""}.`);
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
