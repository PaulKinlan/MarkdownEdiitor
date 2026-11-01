import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { slugify } from "./slug";
import { toDate, type FrontMatterData } from "./frontmatter";
import { listNames, readText } from "./fs";

export interface HugoConfig {
  file: string;
  title: string;
  baseURL: string;
  contentDir: string;
  theme?: string;
  /** Section name to permalink pattern, e.g. { posts: "/:slug/" }. */
  permalinks: Record<string, string>;
}

const CONFIG_FILES = ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json", "config.toml", "config.yaml", "config.yml", "config.json"];

export function parseConfig(file: string, text: string): Record<string, unknown> {
  if (file.endsWith(".toml")) return parseToml(text) as Record<string, unknown>;
  if (file.endsWith(".json")) return JSON.parse(text);
  return (parseYaml(text) ?? {}) as Record<string, unknown>;
}

/** Reads the first Hugo config file found at the site root. Returns undefined if it is not a Hugo site. */
export async function readHugoConfig(root: FileSystemDirectoryHandle): Promise<HugoConfig | undefined> {
  for (const file of CONFIG_FILES) {
    const text = await readText(root, file);
    if (text === undefined) continue;
    let raw: Record<string, unknown>;
    try {
      raw = parseConfig(file, text);
    } catch {
      // A JSON/YAML file with this name may belong to another tool (paul.kinlan.me has a Vercel config.json).
      continue;
    }
    if (!looksLikeHugo(raw)) continue;
    return normaliseConfig(file, raw);
  }
  return undefined;
}

function looksLikeHugo(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw).map((k) => k.toLowerCase());
  return ["baseurl", "title", "theme", "languagecode", "permalinks", "params", "contentdir"].some((k) => keys.includes(k));
}

export function normaliseConfig(file: string, raw: Record<string, unknown>): HugoConfig {
  // Hugo config keys are case-insensitive.
  const get = (key: string) => {
    const k = Object.keys(raw).find((x) => x.toLowerCase() === key.toLowerCase());
    return k ? raw[k] : undefined;
  };
  const permalinks: Record<string, string> = {};
  const p = get("permalinks");
  if (p && typeof p === "object") {
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (typeof v === "string") permalinks[k] = v;
    }
    // Hugo 0.112+ allows per-kind maps; the `page` kind is what single posts use.
    const page = (p as Record<string, unknown>).page;
    if (page && typeof page === "object") {
      for (const [k, v] of Object.entries(page as Record<string, unknown>)) {
        if (typeof v === "string") permalinks[k] = v;
      }
    }
  }
  const theme = get("theme");
  return {
    file,
    title: String(get("title") ?? ""),
    baseURL: String(get("baseURL") ?? "/"),
    contentDir: String(get("contentDir") ?? "content").replace(/^\/|\/$/g, ""),
    theme: Array.isArray(theme) ? String(theme[0]) : theme ? String(theme) : undefined,
    permalinks,
  };
}

/**
 * Works out the URL Hugo will serve a content file at. `relPath` is relative
 * to the content directory, e.g. "posts/hello.md".
 */
export function permalinkFor(relPath: string, fm: FrontMatterData, config: Pick<HugoConfig, "permalinks">): string {
  if (typeof fm.url === "string" && fm.url) return ensureSlashes(fm.url);

  const parts = relPath.split("/");
  const fileName = parts.pop()!;
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const isBundle = baseName === "index" || baseName === "_index";
  const dirs = parts;
  const contentBase = isBundle ? (dirs[dirs.length - 1] ?? "") : baseName;
  if (baseName === "_index") return ensureSlashes(dirs.join("/"));

  const section = dirs[0] ?? "";
  const title = typeof fm.title === "string" ? fm.title : "";
  const slug = typeof fm.slug === "string" && fm.slug ? fm.slug : undefined;
  const pattern = section ? config.permalinks[section] : undefined;

  if (!pattern) {
    const leafDirs = isBundle ? dirs.slice(0, -1) : dirs;
    return ensureSlashes([...leafDirs, slug ?? contentBase].join("/"));
  }

  const date = toDate(fm.date);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tokens: Record<string, string> = {
    year: date ? String(date.getUTCFullYear()) : "",
    month: date ? pad(date.getUTCMonth() + 1) : "",
    day: date ? pad(date.getUTCDate()) : "",
    section,
    sections: dirs.join("/"),
    title: slugify(title || contentBase),
    slug: slug ?? slugify(title || contentBase),
    slugorfilename: slug ?? contentBase,
    slugorcontentbasename: slug ?? contentBase,
    filename: contentBase,
    contentbasename: contentBase,
  };
  const url = pattern.replace(/:([a-z]+)/gi, (m, name: string) => tokens[name.toLowerCase()] ?? m);
  return ensureSlashes(url);
}

function ensureSlashes(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  let u = url.startsWith("/") ? url : `/${url}`;
  if (!u.endsWith("/") && !/\.[a-z0-9]+$/i.test(u)) u += "/";
  return u.replace(/\/{2,}/g, "/");
}

/** Names of shortcodes defined by the site and its theme. */
export async function listShortcodes(root: FileSystemDirectoryHandle, config: HugoConfig): Promise<string[]> {
  const dirs = ["layouts/shortcodes", "layouts/_shortcodes"];
  if (config.theme) dirs.push(`themes/${config.theme}/layouts/shortcodes`, `themes/${config.theme}/layouts/_shortcodes`);
  const names = new Set<string>();
  for (const dir of dirs) {
    for (const file of await listNames(root, dir, "file")) {
      // iframe.html and iframe.markdown.md are output formats of the same shortcode.
      const name = file.split(".")[0];
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/** Whether a changed path could add, remove or change a shortcode (layouts/shortcodes, a theme's, or a folder above them). */
export function isShortcodePath(path: string): boolean {
  const p = path.replace(/^\/+|\/+$/g, "");
  if (!p || p === "layouts" || p === "themes") return true;
  return /^(themes\/[^/]+\/)?layouts\/_?shortcodes(\/|$)/.test(p) || /^themes\/[^/]+(\/layouts)?$/.test(p);
}

export const CONTENT_EXTENSIONS = [".md", ".markdown"];
export const isContentFile = (name: string) => CONTENT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
