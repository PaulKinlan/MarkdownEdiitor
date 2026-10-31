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

export type ShortcodeChange =
  | { kind: "updated"; text: string }
  | { kind: "already" }
  | { kind: "unsupported"; reason: string };

/**
 * Makes an iframe shortcode size local demos to their content. The shortcode
 * checks, at build time, that the demo page in static/ has opted in, since an
 * iframe sized to a page that hasn't would collapse to 150px. The height the
 * shortcode sets stays as the fallback for other browsers and other pages.
 */
export function makeShortcodeSelfSizing(template: string): ShortcodeChange {
  if (template.includes(MARKER)) return { kind: "already" };
  const tag = template.match(/<iframe\b[^>]*>/i);
  if (!tag) return { kind: "unsupported", reason: "it has no <iframe> tag" };
  if (/\sclass\s*=/.test(tag[0])) return { kind: "unsupported", reason: "its <iframe> already has a class attribute" };
  // The demo's address: a $src variable, or the argument the src attribute reads directly.
  const direct = tag[0].match(/\ssrc\s*=\s*"\{\{-?\s*(\.Get\s+(?:\d+|"src"))\s*-?\}\}"/);
  const source = direct ? direct[1] : /\$src\b/.test(template) ? "$src" : undefined;
  if (!source) return { kind: "unsupported", reason: "its <iframe> src isn't $src or a .Get argument" };
  // Everything goes right before the iframe, in the same template scope as the variables it uses.
  const check = [
    `{{- /* ${MARKER}: local demos that opted in take their content's height (frame-sizing, Chrome 154+) */ -}}`,
    `{{- $sizingSrc := ${source} -}}`,
    `{{- $demo := index (split (index (split $sizingSrc "?") 0) "#") 0 -}}`,
    `{{- if strings.HasSuffix $demo "/" }}{{ $demo = printf "%sindex.html" $demo }}{{ end -}}`,
    `{{- $demo = printf "static%s" $demo -}}`,
    `{{- $selfSizing := and (strings.HasPrefix $sizingSrc "/") (not (strings.HasPrefix $sizingSrc "//")) (fileExists $demo) -}}`,
    `{{- if $selfSizing }}{{ $selfSizing = strings.Contains (readFile $demo) "responsive-embedded-sizing" }}{{ end -}}`,
    // !important so it beats a height in the iframe's style attribute; the shortcode's height is the fallback.
    `{{- if $selfSizing }}<style>@supports (frame-sizing: content-height) { iframe.self-sizing { height: auto !important; frame-sizing: content-height; } }</style>{{ end }}`,
    "",
  ].join("\n");
  const at = tag.index!;
  const opened = tag[0].replace(/^<iframe\b/i, `<iframe{{ if $selfSizing }} class="self-sizing"{{ end }}`);
  return { kind: "updated", text: template.slice(0, at) + check + opened + template.slice(at + tag[0].length) };
}
