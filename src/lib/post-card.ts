// What the hover card on the post and note lists shows: enough to tell posts
// with similar titles apart without opening them.

import type { PostSummary } from "./posts";

export interface PostCard {
  title: string;
  /** Section, and the URL for posts or the path for notes. */
  where: string;
  status?: string;
  tags: string[];
  /** The post's summary or description front matter, cut to a few lines. */
  excerpt?: string;
  path: string;
}

const EXCERPT_KEYS = ["summary", "description", "seotitle", "subtitle"];
const TAG_KEYS = ["tags", "categories", "keywords"];
const MAX_EXCERPT = 240;
const MAX_TAGS = 6;

export function postCard(p: PostSummary): PostCard {
  const fm = p.frontMatter;
  const excerpt = EXCERPT_KEYS.map((k) => fm[k]).find((v): v is string => typeof v === "string" && !!v.trim());
  const tags = TAG_KEYS.flatMap((k) => (Array.isArray(fm[k]) ? fm[k] : [])).filter((t): t is string => typeof t === "string" && !!t);
  const status = typeof fm.status === "string" && fm.status ? fm.status : p.draft ? "draft" : undefined;
  return {
    title: p.title,
    where: [p.section, p.url || p.path].filter(Boolean).join(" · "),
    status,
    tags: [...new Set(tags)].slice(0, MAX_TAGS),
    excerpt: excerpt ? clip(excerpt.trim().replace(/\s+/g, " "), MAX_EXCERPT) : undefined,
    path: p.path,
  };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}
