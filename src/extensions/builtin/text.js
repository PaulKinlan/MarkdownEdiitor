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
