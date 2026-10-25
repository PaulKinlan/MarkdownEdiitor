// Link checker: finds links to pages the site doesn't have, and external
// links whose server can't be reached. Runs when you ask (Check links).
import { lineOf } from "./text.js";

export const manifest = {
  id: "link-checker",
  name: "Link checker",
  order: 90,
  description: "Checks the post's links: internal ones against the site's pages and files, external ones by connecting to them.",
  version: "1.0.0",
  permissions: ["post:read", "site:read", "ui", "agent", "network"],
};

const TIMEOUT_MS = 8000;

/** Links in the post body: markdown links and images, HTML href/src, and ref/relref shortcodes. */
export function findLinks(post) {
  const body = post.text.slice(post.bodyStart);
  const out = [];
  const add = (url, index, length) => out.push({ url: url.trim(), from: post.bodyStart + index, to: post.bodyStart + index + length });
  for (const m of body.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1], m.index, m[0].length);
  for (const m of body.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/g)) add(m[1], m.index, m[0].length);
  for (const m of body.matchAll(/\{\{<\s*(?:rel)?ref\s+"([^"]+)"\s*>\}\}/g)) out.push({ url: m[1], ref: true, from: post.bodyStart + m.index, to: post.bodyStart + m.index + m[0].length });
  return out.filter((l) => l.url && !l.url.startsWith("#") && !/^(mailto|tel|javascript):/i.test(l.url) && !l.url.includes("{{"));
}

export default function (editor) {
  const status = editor.ui.status("links", "");
  const reachable = new Map();

  const external = (url) => {
    if (!reachable.has(url)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      // no-cors: other sites rarely allow CORS, but an opaque answer still proves the server is there.
      reachable.set(
        url,
        fetch(url, { method: "HEAD", mode: "no-cors", signal: controller.signal, redirect: "follow" })
          .then(() => true, () => false)
          .finally(() => clearTimeout(timer)),
      );
    }
    return reachable.get(url);
  };

  const internal = async (link, posts) => {
    if (link.ref) {
      const target = link.url.replace(/^\/+/, "").replace(/\/$/, "");
      return posts.some((p) => p.path.endsWith(target) || p.path.endsWith(`${target}.md`) || p.path.endsWith(`${target}/index.md`) || p.path.endsWith(`${target}/_index.md`));
    }
    const path = decodeURI(link.url.split(/[?#]/)[0]);
    const page = path.endsWith("/") ? path : `${path}/`;
    if (posts.some((p) => p.url === path || p.url === page)) return true;
    for (const dir of ["static", "assets"]) if ((await editor.site.readFile(`${dir}${path}`)) !== null) return true;
    return false;
  };

  const check = async () => {
    const post = await editor.document.read();
    if (!post) return [];
    const posts = await editor.site.posts();
    const links = findLinks(post);
    status.set(`Checking ${links.length} links…`);
    const results = await Promise.all(
      links.map(async (link) => {
        let ok = true;
        if (/^https?:\/\//i.test(link.url) || link.url.startsWith("//")) ok = await external(link.url.startsWith("//") ? `https:${link.url}` : link.url);
        else if (link.url.startsWith("/") || link.ref) ok = await internal(link, posts);
        return { ...link, ok, external: /^(https?:)?\/\//i.test(link.url) };
      }),
    );
    const broken = results.filter((r) => !r.ok);
    status.set(
      broken.length ? `${broken.length} broken links` : `${results.length} links OK`,
      broken.map((b) => `• ${b.url}`).join("\n") || "Every link resolved.",
    );
    editor.document.annotate(
      "broken-links",
      broken.map((b) => ({ from: b.from, to: b.to, severity: "warning", message: b.external ? `Couldn't reach ${b.url}` : `No page or file at ${b.url}` })),
    );
    return results.map((r) => ({ ...r, line: lineOf(post.text, r.from) }));
  };

  editor.registerCommand({ id: "check", title: "Check links", run: () => check() });
  editor.agent.registerTool({
    name: "check_links",
    description: "Checks every link in the open post: internal links against the site's pages and static files, external links by connecting to the server. Lists the broken ones with line numbers.",
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: async () => {
      const results = await check();
      const broken = results.filter((r) => !r.ok);
      if (!results.length) return "The post has no links.";
      return broken.length
        ? `${broken.length} of ${results.length} links look broken:\n${broken.map((b) => `- line ${b.line}: ${b.url} (${b.external ? "server unreachable" : "no such page or file"})`).join("\n")}`
        : `All ${results.length} links resolved.`;
    },
  });
  editor.on("post:open", () => {
    status.set("");
    editor.document.annotate("broken-links", []);
  });
  editor.on("post:close", () => status.set(""));
}
