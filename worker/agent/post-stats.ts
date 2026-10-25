import { Post } from "../../src/lib/frontmatter";

const WORDS_PER_MINUTE = 230;
const LONG_SENTENCE = 35;
const VAGUE_LINK_TEXT = /^(here|click here|this|this link|link|read more|more|this post|this article)$/i;
const FRONT_MATTER_LENGTHS = ["title", "seotitle", "linktitle", "description", "summary"];

/**
 * Measurable facts about a post, for skills that review structure, SEO and
 * accessibility: length, outline, long paragraphs and sentences, links,
 * images without alt text, and front matter lengths. Line numbers match
 * read_post.
 */
export function analyzePost(text: string): string {
  let post: Post;
  let frontMatterError = "";
  try {
    post = Post.parse(text);
  } catch (e) {
    frontMatterError = e instanceof Error ? e.message : String(e);
    post = Post.parse("");
    post.body = text;
  }
  const bodyStart = text.length - post.body.length;
  const firstBodyLine = text.slice(0, bodyStart).split("\n").length;
  const lines = post.body.split("\n");

  // Prose only: no fenced code, shortcodes, HTML tags or link targets.
  const prose: { line: number; text: string }[] = [];
  let fenced = false;
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) fenced = !fenced;
    else if (!fenced) prose.push({ line: firstBodyLine + i, text: raw });
  });
  const plain = (s: string) =>
    s
      .replace(/\{\{[<%][\s\S]*?[>%]\}\}/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`[^`]*`/g, "code")
      .replace(/[#>*_~|]/g, " ");
  const countWords = (s: string) => (plain(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

  const words = prose.reduce((n, l) => n + countWords(l.text), 0);
  const out: string[] = [`Words: ${words} (about ${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read)`];

  // Front matter
  if (frontMatterError) out.push(`Front matter could not be parsed: ${frontMatterError}`);
  else if (post.format === "none") out.push("Front matter: none");
  else {
    const fm = post.frontMatter;
    const keys = Object.keys(fm);
    out.push(`Front matter (${post.format}): ${keys.join(", ") || "empty"}`);
    for (const key of keys) {
      const value = fm[key];
      if (FRONT_MATTER_LENGTHS.includes(key.toLowerCase()) && typeof value === "string") out.push(`  ${key}: ${value.length} characters`);
    }
  }

  // Outline
  const headings: string[] = [];
  let lastLevel = 0;
  const skips: string[] = [];
  for (const l of prose) {
    const m = l.text.match(/^(#{1,6})\s+(.*)$/);
    if (!m) continue;
    const level = m[1].length;
    headings.push(`${String(l.line).padStart(4)}| ${"  ".repeat(level - 1)}${"#".repeat(level)} ${m[2].trim()}`);
    if (lastLevel && level > lastLevel + 1) skips.push(`line ${l.line} jumps from h${lastLevel} to h${level}`);
    lastLevel = level;
  }
  out.push("", headings.length ? `Outline:\n${headings.join("\n")}` : "Outline: no headings");
  if (skips.length) out.push(`Heading levels skipped: ${skips.join("; ")}`);

  // Paragraphs and sentences
  const paragraphs: { line: number; text: string }[] = [];
  let current: { line: number; text: string } | undefined;
  for (const l of prose) {
    const isBlock = !l.text.trim() || /^(#{1,6}\s|\s*([-*+]|\d+\.)\s|\s*>|\s*\||\s*\{\{[<%])/.test(l.text);
    if (isBlock) {
      if (current) paragraphs.push(current);
      current = undefined;
    } else if (current) current.text += ` ${l.text.trim()}`;
    else current = { line: l.line, text: l.text.trim() };
  }
  if (current) paragraphs.push(current);
  const paraWords = paragraphs.map((p) => ({ ...p, words: countWords(p.text) }));
  if (paraWords.length) {
    const avg = Math.round(paraWords.reduce((n, p) => n + p.words, 0) / paraWords.length);
    const longest = [...paraWords].sort((a, b) => b.words - a.words).slice(0, 3);
    out.push("", `Paragraphs: ${paraWords.length}, average ${avg} words. Longest: ${longest.map((p) => `line ${p.line} (${p.words} words)`).join(", ")}`);
    const first = paraWords[0];
    out.push(`First paragraph (line ${first.line}, ${first.words} words): ${plain(first.text).replace(/\s+/g, " ").trim().slice(0, 240)}`);
  }
  const sentences = paragraphs.flatMap((p) =>
    (plain(p.text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => ({ line: p.line, text: s.trim(), words: countWords(s) })),
  );
  if (sentences.length) {
    const avg = Math.round(sentences.reduce((n, s) => n + s.words, 0) / sentences.length);
    const long = sentences.filter((s) => s.words > LONG_SENTENCE).sort((a, b) => b.words - a.words).slice(0, 5);
    out.push(`Sentences: ${sentences.length}, average ${avg} words${long.length ? `. Over ${LONG_SENTENCE} words:` : "."}`);
    for (const s of long) out.push(`  paragraph at line ${s.line} (${s.words} words): ${s.text.slice(0, 160)}${s.text.length > 160 ? "…" : ""}`);
  }

  // Links and images
  const links: { line: number; text: string; url: string }[] = [];
  const images: { line: number; alt: string; url: string }[] = [];
  for (const l of prose) {
    for (const m of l.text.matchAll(/(!?)\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      if (m[1]) images.push({ line: l.line, alt: m[2].trim(), url: m[3] });
      else links.push({ line: l.line, text: m[2].trim(), url: m[3] });
    }
    for (const m of l.text.matchAll(/<img\b[^>]*>/gi)) {
      images.push({ line: l.line, alt: m[0].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? "", url: m[0].match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? "" });
    }
  }
  const external = links.filter((l) => /^https?:\/\//i.test(l.url));
  out.push("", `Links: ${links.length} (${external.length} external, ${links.length - external.length} internal or relative)`);
  const vague = links.filter((l) => VAGUE_LINK_TEXT.test(l.text) || !l.text);
  if (vague.length) out.push(`Links with vague or empty text: ${vague.map((l) => `line ${l.line} "${l.text}" → ${l.url}`).join("; ")}`);
  const insecure = external.filter((l) => l.url.startsWith("http://"));
  if (insecure.length) out.push(`http:// links: ${insecure.map((l) => `line ${l.line} ${l.url}`).join("; ")}`);
  out.push(`Images: ${images.length}`);
  const noAlt = images.filter((i) => !i.alt);
  if (noAlt.length) out.push(`Images without alt text: ${noAlt.map((i) => `line ${i.line} ${i.url}`).join("; ")}`);

  return out.join("\n");
}
