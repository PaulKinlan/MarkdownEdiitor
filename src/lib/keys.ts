const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Shows a CodeMirror-style key the way this platform writes it. */
export function keyLabel(key: string): string {
  return key
    .split("-")
    .map((part) => (part === "Mod" ? (MAC ? "⌘" : "Ctrl") : part === "Shift" ? (MAC ? "⇧" : "Shift") : part === "Alt" ? (MAC ? "⌥" : "Alt") : part.length === 1 ? part.toUpperCase() : part))
    .join(MAC ? "" : "+");
}
