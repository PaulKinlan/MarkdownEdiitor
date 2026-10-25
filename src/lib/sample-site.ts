import { writeFile, exists } from "./fs";

/**
 * Creates a tiny Hugo site in the origin private file system, so the editor
 * can be tried in browsers without folder access (and in tests). It has the
 * same shape as aifoc.us: YAML front matter, posts under content/posts.
 */
export async function createSampleSite(): Promise<FileSystemDirectoryHandle> {
  const opfs = await navigator.storage.getDirectory();
  const root = await opfs.getDirectoryHandle("sample-site", { create: true });
  if (await exists(root, "hugo.toml")) return root;
  await writeFile(
    root,
    "hugo.toml",
    `baseURL = 'https://example.org/'\ntitle = 'Sample Blog'\n\n[permalinks.page]\n  posts = '/:slug/'\n`,
  );
  await writeFile(root, "layouts/shortcodes/figure.html", `<figure><img src="{{ .Get "src" }}" alt="{{ .Get "alt" }}"></figure>\n`);
  await writeFile(root, "layouts/shortcodes/iframe.html", `<iframe src="{{ .Get 0 }}" height="{{ .Get 1 }}"></iframe>\n`);
  await writeFile(
    root,
    "content/posts/hello-world.md",
    `---\ntitle: hello world\nseotitle: "A first post written in the Hugo editor"\ndate: 2026-10-01T09:00:00.000Z\nslug: hello-world\ndraft: false\nauthors:\n  - you\n---\n\nThis is a sample post. Edit it, then press **Ctrl+S** (or ⌘+S) to save.\n\n{{< figure src="/images/hello.png" alt="An example figure" >}}\n`,
  );
  await writeFile(
    root,
    "content/posts/a-draft.md",
    `---\ntitle: a draft in progress\ndate: 2026-10-20T09:00:00.000Z\nslug: a-draft\ndraft: true\nauthors:\n  - you\n---\n\nDrafts are marked in the post list.\n`,
  );
  return root;
}
