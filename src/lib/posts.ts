import { Post, toDate, type FrontMatterData, type FrontMatterFormat } from "./frontmatter";
import { isContentFile, permalinkFor, type HugoConfig } from "./hugo";
import { walk } from "./fs";
import { slugify } from "./slug";

export interface PostSummary {
  /** Path relative to the site root, e.g. "content/posts/hello.md". */
  path: string;
  /** Path relative to the content directory. */
  contentPath: string;
  section: string;
  title: string;
  date?: Date;
  draft: boolean;
  format: FrontMatterFormat;
  frontMatter: FrontMatterData;
  url: string;
  lastModified: number;
}

export async function listPosts(root: FileSystemDirectoryHandle, config: HugoConfig): Promise<PostSummary[]> {
  const entries = await walk(root, config.contentDir, isContentFile);
  const out: PostSummary[] = [];
  // Bounded concurrency: paul.kinlan.me has ~800 files and a burst of reads is slower than a steady pipe.
  let i = 0;
  const worker = async () => {
    while (i < entries.length) {
      const entry = entries[i++];
      try {
        const file = await entry.handle.getFile();
        out.push(summarise(entry.path, config, Post.parse(await file.text()), file.lastModified));
      } catch (e) {
        console.warn(`Skipping ${entry.path}`, e);
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return sortPosts(out);
}

export function summarise(path: string, config: HugoConfig, post: Post, lastModified: number): PostSummary {
  const contentPath = path.slice(config.contentDir.length + 1);
  const fm = post.frontMatter;
  const section = contentPath.includes("/") ? contentPath.split("/")[0] : "";
  return {
    path,
    contentPath,
    section,
    title: typeof fm.title === "string" && fm.title ? fm.title : contentPath,
    date: toDate(fm.date),
    draft: fm.draft === true || fm.draft === "true",
    format: post.format,
    frontMatter: fm,
    url: permalinkFor(contentPath, fm, config),
    lastModified,
  };
}

export function sortPosts(posts: PostSummary[]): PostSummary[] {
  return posts.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || a.title.localeCompare(b.title));
}

/** Sections (top-level content folders) that hold posts, most used first. Root-level content is "". */
export function sections(posts: PostSummary[]): string[] {
  const counts = new Map<string, number>();
  for (const p of posts) if (!p.contentPath.endsWith("_index.md")) counts.set(p.section, (counts.get(p.section) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

const LIST_KEYS = new Set(["tags", "categories", "authors", "keywords", "aliases", "series"]);

/**
 * Builds a new post shaped like the most recent post in the same section, so a
 * new aifoc.us post gets `seotitle` and `authors` while a paul.kinlan.me post
 * gets `summary` and `tags`, in the same front matter format and file extension.
 */
export function newPostFromTemplate(posts: PostSummary[], config: HugoConfig, section: string, title: string, now = new Date()) {
  const latest = posts.find((p) => p.section === section && !/(^|\/)_index\./.test(p.contentPath));
  const slug = slugify(title) || `untitled-${now.getTime()}`;
  const data: FrontMatterData = {};
  const template = latest?.frontMatter ?? { title: "", date: "", draft: true };
  for (const [key, value] of Object.entries(template)) {
    if (key === "title") data.title = title;
    else if (key === "date") data.date = now.toISOString();
    else if (key === "draft") data.draft = true;
    else if (key === "slug") data.slug = slug;
    else if (key === "authors" && Array.isArray(value)) data.authors = value; // usually the same author
    else if (LIST_KEYS.has(key) || Array.isArray(value)) data[key] = [];
    else if (typeof value === "string") data[key] = "";
  }
  data.title ??= title;
  data.date ??= now.toISOString();
  data.draft ??= true;
  const ext = latest?.path.match(/\.[^.]+$/)?.[0] ?? ".md";
  const dir = [config.contentDir, section].filter(Boolean).join("/");
  const format = latest && latest.format !== "none" ? latest.format : "yaml";
  const post = Post.create(format, data, "\n");
  return { path: `${dir}/${slug}${ext}`, post };
}
