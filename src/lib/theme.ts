/**
 * The colour theme: follow the system (default), or pin light or dark. The
 * choice is reflected in <meta name="color-scheme">, which styles.css maps to
 * the `color-scheme` property; index.html applies it before first paint.
 */
export type Theme = "system" | "light" | "dark";

const KEY = "md-editor:color-scheme";

export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function setTheme(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: still apply it for this page.
  }
  apply(theme);
}

function apply(theme: Theme) {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) meta.content = theme === "system" ? "light dark" : theme;
}

/** Keeps other windows of the app in step when the theme changes in one. */
export function watchTheme(onChange: (theme: Theme) => void) {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== null) return;
    const theme = getTheme();
    apply(theme);
    onChange(theme);
  });
}
