// Responsively-sized iframes (Chrome 154): an iframe with `frame-sizing:
// content-height` takes the height of the page inside it, if that page opts in
// with a meta tag. Both edits here are text transforms, so they can be tested
// without a site.

export const OPT_IN = `<meta name="responsive-embedded-sizing" content="allow-origins=*">`;
const MARKER = "self-sizing iframes";

/** Adds the opt-in meta tag to a demo page's head. Undefined when it has one already, or has no head to put it in. */
export function addOptIn(html: string): string | undefined {
  if (html.includes("responsive-embedded-sizing")) return undefined;
  const head = html.match(/<head(\s[^>]*)?>/i);
  if (!head) return undefined;
  // After the charset meta when there is one, which must stay in the first 1024 bytes.
  const charset = html.match(/<meta\s+charset[^>]*>/i);
  const at = charset && charset.index! > head.index! ? charset.index! + charset[0].length : head.index! + head[0].length;
  return `${html.slice(0, at)}\n    ${OPT_IN}${html.slice(at)}`;
}

/**
 * Makes an iframe shortcode size local demos to their content. The shortcode
 * checks, at build time, that the demo page in static/ has opted in, since an
 * iframe sized to a page that hasn't would collapse to 150px. The `height`
 * argument stays as the fallback for other browsers and other pages.
 * Undefined when the template is already done, or isn't one this can edit.
 */
export function makeShortcodeSelfSizing(template: string): string | undefined {
  if (template.includes(MARKER)) return undefined;
  const tag = template.match(/<iframe\b[^>]*>/i);
  if (!tag || /\sclass\s*=/.test(tag[0]) || !/\$src\b/.test(template)) return undefined;
  const check = [
    `{{- /* ${MARKER}: local demos that opted in take their content's height (frame-sizing, Chrome 154+) */ -}}`,
    `{{- $demo := index (split (index (split $src "?") 0) "#") 0 -}}`,
    `{{- if strings.HasSuffix $demo "/" }}{{ $demo = printf "%sindex.html" $demo }}{{ end -}}`,
    `{{- $demo = printf "static%s" $demo -}}`,
    `{{- $selfSizing := and (strings.HasPrefix $src "/") (not (strings.HasPrefix $src "//")) (fileExists $demo) -}}`,
    `{{- if $selfSizing }}{{ $selfSizing = strings.Contains (readFile $demo) "responsive-embedded-sizing" }}{{ end -}}`,
    "",
  ].join("\n");
  const at = tag.index!;
  const opened = tag[0].replace(/^<iframe\b/i, `<iframe{{ if $selfSizing }} class="self-sizing"{{ end }}`);
  const style = `\n{{- if $selfSizing }}<style>@supports (frame-sizing: content-height) { iframe.self-sizing { height: auto; frame-sizing: content-height; } }</style>{{ end }}\n`;
  const end = at + tag[0].length;
  // The check has to come after $src is set, which is before the iframe in any shortcode that uses it.
  return template.slice(0, at) + check + opened + template.slice(end).replace(/\s*$/, "") + style;
}
