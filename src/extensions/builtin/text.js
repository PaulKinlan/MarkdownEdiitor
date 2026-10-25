// Helpers shared by the built-in extensions. Not an extension itself: the
// loader inlines it into the extensions that import it (see builtin/index.ts).

/**
 * The post's prose, with everything that isn't prose (front matter, code,
 * shortcodes, HTML, link targets) replaced by spaces, so offsets still line
 * up with the post text.
 */
export function prose(post) {
  let text = post.text;
  const blank = (match) => match.replace(/[^\n]/g, " ");
  text = " ".repeat(post.bodyStart) + text.slice(post.bodyStart);
  return text
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, blank)
    .replace(/\{\{[<%][\s\S]*?[%>]\}\}/g, blank)
    .replace(/<[^>\n]+>/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\]\([^)\n]*\)/g, blank)
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s/gm, blank);
}

/** Sentences in `text` with their offsets. */
export function sentences(text) {
  const out = [];
  // A sentence ends at . ! or ? followed by a space (so "4.5" doesn't end one), or at a blank line.
  const re = /\S(?:[^\n]|\n(?!\s*\n))*?(?:[.!?]+(?=\s|$)|(?=\n\s*\n)|$)/g;
  for (const m of text.matchAll(re)) {
    if (/[A-Za-z]/.test(m[0])) out.push({ text: m[0], from: m.index, to: m.index + m[0].length });
  }
  return out;
}

export function words(text) {
  return text.match(/[A-Za-z0-9’']+/g) ?? [];
}

export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** 1-based line number of an offset. */
export function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Top-level front matter fields as strings or lists of strings. Reads simple
 * YAML (`key: value`, `key: [a, b]`, `- item` lists), TOML (`key = value`) and
 * JSON front matter; anything more involved is left out.
 */
export function frontMatter(post) {
  const head = post.text.slice(0, post.bodyStart);
  const out = {};
  const clean = (v) => v.trim().replace(/^["']|["']$/g, "");
  const list = (v) => v.replace(/^\[|\]$/g, "").split(",").map(clean).filter(Boolean);
  if (head.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(head.trim().replace(/\n?$/, ""));
      for (const [k, v] of Object.entries(json)) out[k.toLowerCase()] = Array.isArray(v) ? v.map(String) : String(v);
    } catch {
      // Not plain JSON; leave it.
    }
    return out;
  }
  let key;
  for (const line of head.split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) {
      out[key] = [...(Array.isArray(out[key]) ? out[key] : []), clean(item[1])];
      continue;
    }
    const m = line.match(/^([A-Za-z_][\w-]*)\s*[:=]\s*(.*)$/);
    if (!m) continue;
    key = m[1].toLowerCase();
    const value = m[2].trim();
    out[key] = value.startsWith("[") ? list(value) : clean(value);
  }
  return out;
}

/** The post's ATX headings (outside code), with level, text and offsets. */
export function headings(post) {
  const out = [];
  let fence = null;
  let offset = post.bodyStart;
  for (const line of post.text.slice(post.bodyStart).split("\n")) {
    const f = line.match(/^\s{0,3}(```|~~~)/);
    if (f) fence = fence === f[1] ? null : (fence ?? f[1]);
    else if (!fence) {
      const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) out.push({ level: h[1].length, text: h[2], from: offset, to: offset + line.length });
    }
    offset += line.length + 1;
  }
  return out;
}

/** Escapes text for HTML. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Today as YYYY-MM-DD in local time. */
export function today(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Words in the post body, in any script. */
export function bodyWords(post) {
  return post.text.slice(post.bodyStart).match(/[\p{L}\p{N}’']+/gu) ?? [];
}
