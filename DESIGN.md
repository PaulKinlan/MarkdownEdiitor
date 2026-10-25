# Design

The editor is a writing tool. Everything around the text should be quiet, so the post is the loudest thing on screen.

## Persona

Minimal and calm (chosen in the UI polish work, PR #5). Neutral warm greys, one blue accent, system fonts, thin borders, almost no shadow. No gradients, no purple, no card grids, no decorative illustration. It should feel closer to a good text editor than a SaaS dashboard.

## Reference points

- The two blogs it edits, [aifoc.us](https://aifoc.us) and [paul.kinlan.me](https://paul.kinlan.me): the preview pane shows them with their own styling, so the editor chrome stays neutral to sit beside either.
- Screenshots of the current UI: `public/screenshots/` (also used by the manifest).

## Tokens

Defined once in `src/styles.css` on `:root` and used everywhere through `var(--…)`, including inside Lit shadow roots (custom properties inherit through them). Each colour has a light and a dark value, combined with `light-dark()`, with a media-query fallback for older browsers. The theme setting pins `color-scheme` through `<meta name="color-scheme">`.

| Token | Use |
|---|---|
| `--bg`, `--bg-2`, `--bg-3` | Page, panels and bars, wells and pressed states |
| `--fg`, `--fg-2` | Text, secondary text (4.5:1 or better on every background) |
| `--border` | Hairlines between regions and around controls |
| `--accent`, `--accent-fg` | The one primary action per view, selection, focus rings; text on accent |
| `--ok`, `--warn`, `--danger` | Saved, unsaved/changed on disk, errors and destructive actions |
| `--hover`, `--selected` | Derived with `color-mix()` from `--fg` and `--accent` |
| `--radius` (6px), `--radius-lg` (10px), `--control-h` (28px) | Shape and control height |
| `--font`, `--font-editor`, `--mono` | System UI stack; writing font; code |
| `--ease` | One easing curve for every transition (120 to 160ms) |

Component CSS uses tokens, not literal colours. The exceptions are shadows and dialog backdrops, which use `rgb(0 0 0 / a)`.

## Type

System UI font at 14px/1.45 for chrome; 12 to 13px for labels and metadata; the editor uses a larger size with 1.7 line height. Counts, timers and word counts use `font-variant-numeric: tabular-nums`.

## Layout

Three panes on desktop: posts, editor (front matter form above the text), and preview/assistant. Below 900px one pane shows at a time with a bottom bar (PR #7). Each view has one primary button (Save in the top bar; New in the post list; Connect in the preview).

## States every control handles

Default, hover, `:focus-visible` (3px accent outline, 2px offset; fields use a 3px accent ring), active, disabled (reduced opacity, no pointer), loading (busy text or skeleton past ~300ms), empty (says what's missing and offers the next step, e.g. "Pick a post"), error (what failed and what to do), offline/stale, and light/dark.

## Motion

Short fades and lifts on dialogs and panels with `@starting-style`. `prefers-reduced-motion: reduce` removes movement and keeps fades.

## Copy

Plain and direct. Say what happened and what to do next. Don't anthropomorphise the assistant ("The model suggests…", not "I think…").
