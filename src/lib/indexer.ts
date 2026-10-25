import { Post } from "./frontmatter";
import { getFile } from "./fs";
import type { PostSummary } from "./posts";
import type { IndexedPost } from "../shared/protocol";
import { syncManifest, uploadPosts, type AgentSettings } from "./agent-client";

/**
 * Brings the site's search index (used by the agents' search_posts tool) up to
 * date: sends a manifest of paths and modification times, then uploads only
 * the posts the server doesn't have yet. Returns how many were uploaded.
 */
export async function syncSiteIndex(
  settings: AgentSettings,
  siteId: string,
  root: FileSystemDirectoryHandle,
  posts: PostSummary[],
): Promise<number> {
  const byPath = new Map(posts.map((p) => [p.path, p]));
  const { stale } = await syncManifest(settings, siteId, posts.map((p) => ({ path: p.path, lastModified: p.lastModified })));
  let batch: IndexedPost[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length) await uploadPosts(settings, siteId, batch);
    batch = [];
    bytes = 0;
  };
  for (const path of stale) {
    const summary = byPath.get(path);
    const file = await (await getFile(root, path))?.getFile();
    if (!summary || !file) continue;
    const text = await file.text();
    const body = Post.parse(text).body;
    batch.push({
      path,
      title: summary.title,
      url: summary.url,
      date: summary.date?.toISOString(),
      lastModified: summary.lastModified,
      draft: summary.draft,
      frontMatter: summary.frontMatter,
      body,
      text,
    });
    bytes += body.length + text.length;
    if (batch.length >= 100 || bytes > 2_000_000) await flush();
  }
  await flush();
  return stale.length;
}
