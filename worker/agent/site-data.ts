import { isNotePath } from "../../src/shared/notes";

// Pure helpers behind the SiteIndex's listing, taxonomy and grep queries,
// kept apart from the Durable Object so tests can run them directly.

export interface PostListing {
  path: string;
  title: string;
  url: string;
  date?: string;
  draft: boolean;
  frontMatter: Record<string, unknown>;
  words: number;
}

export interface ListFilter {
  /** List research notes (notes/ at the site root) instead of posts. */
  notes?: boolean;
  /** Top-level content folder, e.g. "posts". */
  section?: string;
  /** Front matter key and value the post must have, e.g. tags = "ai". Matches list items and plain values, ignoring case. */
  field?: string;
  value?: string;
  /** Only posts with this front matter key missing or empty. */
  missing?: string;
  draft?: boolean;
  /** ISO dates, inclusive. */
  since?: string;
  until?: string;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface GrepResult {
  matches: GrepMatch[];
  /** Matching lines across the site, including those past the limit. */
  total: number;
  files: number;
}

/** Posts matching the filter, newest first. */
export function filterPosts(posts: PostListing[], contentDir: string, filter: ListFilter): PostListing[] {
  return posts.filter((p) => matches(p, contentDir, filter)).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.path.localeCompare(b.path));
}

export function countTerms(posts: PostListing[], key: string): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of posts) for (const term of values(p.frontMatter[key])) counts.set(term, (counts.get(term) ?? 0) + 1);
  return [...counts].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}

/** Lines matching a pattern. Stops collecting after `limit` lines but keeps counting. Throws on an invalid regex. */
export function grepFiles(
  files: Iterable<{ path: string; text: string }>,
  pattern: string,
  options: { regex?: boolean; caseSensitive?: boolean; limit?: number } = {},
): GrepResult {
  const source = options.regex ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(source, options.caseSensitive ? "" : "i");
  const limit = options.limit ?? 100;
  const matches: GrepMatch[] = [];
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    file.text.split("\n").forEach((line, i) => {
      if (!re.test(line)) return;
      total++;
      paths.add(file.path);
      if (matches.length < limit) matches.push({ path: file.path, line: i + 1, text: line.length > 240 ? `${line.slice(0, 240)}…` : line });
    });
  }
  return { matches, total, files: paths.size };
}

function matches(p: PostListing, contentDir: string, f: ListFilter): boolean {
  if (f.notes ? !isNotePath(p.path) : !p.path.startsWith(`${contentDir}/`)) return false;
  if (f.section !== undefined) {
    const rel = p.path.startsWith(`${contentDir}/`) ? p.path.slice(contentDir.length + 1) : p.path;
    const section = rel.includes("/") ? rel.split("/")[0] : "";
    if (section !== f.section) return false;
  }
  if (f.draft !== undefined && p.draft !== f.draft) return false;
  if (f.since && (!p.date || p.date.slice(0, 10) < f.since.slice(0, 10))) return false;
  if (f.until && (!p.date || p.date.slice(0, 10) > f.until.slice(0, 10))) return false;
  if (f.missing && values(p.frontMatter[f.missing]).length) return false;
  if (f.field) {
    const have = values(p.frontMatter[f.field]).map((v) => v.toLowerCase());
    if (f.value === undefined ? !have.length : !have.includes(f.value.toLowerCase())) return false;
  }
  return true;
}

/** A front matter value as a list of non-empty strings. */
function values(value: unknown): string[] {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.map((v) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "")).filter((v) => v.trim() !== "");
}
