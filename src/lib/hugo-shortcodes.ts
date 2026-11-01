// Loaded when a post opens, to keep it out of the boot bundle.

/**
 * Shortcodes Hugo ships with (as of 0.147), which work without a file in
 * layouts/shortcodes. `insert` is what the insert menu puts in the post.
 */
export const HUGO_SHORTCODES: { name: string; insert: string }[] = [
  { name: "details", insert: '{{< details summary="" >}}\n\n{{< /details >}}' },
  { name: "figure", insert: '{{< figure src="" alt="" caption="" >}}' },
  { name: "highlight", insert: '{{< highlight go >}}\n\n{{< /highlight >}}' },
  { name: "instagram", insert: '{{< instagram id="" >}}' },
  { name: "param", insert: '{{< param "" >}}' },
  { name: "qr", insert: '{{< qr text="" />}}' },
  { name: "ref", insert: '{{< ref "" >}}' },
  { name: "relref", insert: '{{< relref "" >}}' },
  { name: "vimeo", insert: '{{< vimeo id="" >}}' },
  { name: "x", insert: '{{< x user="" id="" >}}' },
  { name: "youtube", insert: '{{< youtube id="" >}}' },
];

/** The text to insert for a shortcode. The site's own shortcodes win over Hugo's of the same name. */
export function shortcodeSnippet(name: string, siteShortcodes: readonly string[] = []): string {
  const builtin = HUGO_SHORTCODES.find((s) => s.name === name);
  return builtin && !siteShortcodes.includes(name) ? builtin.insert : `{{< ${name} >}}`;
}
