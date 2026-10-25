// The spell check custom dictionary (Chrome 159): words the browser's spell
// checker should accept in this tab. The page can't read the dictionary back,
// so this module remembers what it added in order to remove words later.

import type { PostSummary } from "../../lib/posts";

export function canUseDictionary(): boolean {
  return !!document.spellCheckCustomDictionary;
}

/** Splits a settings field ("Hugo, WebMCP\naifoc.us") into words. */
export function parseWordList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean))];
}

/**
 * Words for a site: the author's own list, plus the site's tags and
 * categories, which are mostly product names and jargon. Multi-word tags are
 * split, since the spell checker works a word at a time.
 */
export function siteWords(posts: readonly PostSummary[], extra: readonly string[]): string[] {
  const words = new Set(extra);
  for (const post of posts) {
    for (const key of ["tags", "categories"]) {
      const value = post.frontMatter[key];
      if (!Array.isArray(value)) continue;
      for (const tag of value) if (typeof tag === "string") for (const w of tag.split(/[\s/]+/)) if (/\p{L}/u.test(w)) words.add(w);
    }
  }
  return [...words];
}

let added = new Set<string>();

/** Makes the dictionary hold exactly `words`, adding and removing only the difference. */
export function applyDictionary(words: readonly string[]) {
  const dictionary = document.spellCheckCustomDictionary;
  if (!dictionary) return;
  const next = new Set(words);
  const removed = [...added].filter((w) => !next.has(w));
  const fresh = [...next].filter((w) => !added.has(w));
  if (removed.length) dictionary.removeWords(removed);
  if (fresh.length) dictionary.addWords(fresh);
  added = next;
}
