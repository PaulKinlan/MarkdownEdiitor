import { css } from "lit";

export const controls = css`
  /* The page's box-sizing rule doesn't reach into shadow roots. */
  *, *::before, *::after { box-sizing: border-box; }
  button, select, input, textarea {
    font: inherit;
    color: inherit;
  }
  button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: var(--control-h);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0 10px;
    cursor: pointer;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 500;
    transition: background-color 120ms var(--ease), border-color 120ms var(--ease), color 120ms var(--ease);
  }
  button:hover:not(:disabled) { background: var(--bg-3); }
  button:active:not(:disabled) { transform: translateY(0.5px); }
  button:disabled { opacity: 0.45; cursor: default; }
  button.primary { background: var(--accent); border-color: transparent; color: var(--accent-fg); }
  button.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, var(--fg)); }
  button.ghost { background: transparent; border-color: transparent; color: var(--fg-2); }
  button.ghost:hover:not(:disabled) { background: var(--hover); color: var(--fg); }
  button.ghost[aria-pressed="true"] { background: var(--selected); color: var(--accent); }
  button.danger { color: var(--danger); }
  /* Square icon-only button; give it an aria-label. */
  button.icon-only { padding: 0; width: var(--control-h); }
  button.small { min-height: 24px; padding: 0 8px; font-size: 12px; }
  .icon { flex: none; display: block; }
  input, select, textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 8px;
    min-width: 0;
    transition: border-color 120ms var(--ease), box-shadow 120ms var(--ease);
  }
  input:not([type="checkbox"], [type="radio"]), select { min-height: var(--control-h); }
  input:hover, select:hover, textarea:hover { border-color: color-mix(in srgb, var(--fg) 25%, var(--border)); }
  input::placeholder, textarea::placeholder { color: var(--fg-2); opacity: 1; }
  input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }
  button:focus-visible, a:focus-visible, summary:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .muted { color: var(--fg-2); }
  code { font-family: var(--mono); font-size: 0.88em; background: var(--bg-3); padding: 1px 4px; border-radius: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-2); flex: none; }

  /* Segmented control: a row of buttons where one is selected (aria-selected or aria-pressed). */
  .seg { display: inline-flex; padding: 2px; gap: 2px; border-radius: calc(var(--radius) + 2px); background: var(--bg-3); }
  .seg button { min-height: 24px; border: 0; background: transparent; color: var(--fg-2); padding: 0 10px; font-size: 12px; }
  .seg button:hover:not(:disabled) { background: var(--hover); color: var(--fg); }
  .seg button:is([aria-selected="true"], [aria-pressed="true"]) { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / 0.12); }

  /* Modal dialogs: fade and lift in, animate out where the browser can. */
  dialog {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg);
    color: var(--fg);
    padding: 20px 22px;
    box-shadow: var(--shadow);
    /* Scrolling past the end of a long dialog mustn't scroll the editor behind it. */
    overscroll-behavior: contain;
    opacity: 0;
    translate: 0 8px;
    transition: opacity 160ms var(--ease), translate 160ms var(--ease), display 160ms allow-discrete, overlay 160ms allow-discrete;
  }
  dialog[open] {
    opacity: 1;
    translate: 0 0;
    @starting-style { opacity: 0; translate: 0 8px; }
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0);
    transition: background-color 160ms var(--ease), display 160ms allow-discrete, overlay 160ms allow-discrete;
  }
  dialog[open]::backdrop {
    background: rgb(0 0 0 / 0.32);
    @starting-style { background: rgb(0 0 0 / 0); }
  }
  dialog h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  dialog h4 { margin: 10px 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-2); }
  dialog label { display: grid; gap: 4px; font-size: 12px; font-weight: 500; color: var(--fg-2); }
  /* A label that sits in a sentence (a checkbox in a paragraph). */
  dialog label.inline { display: inline; }
  dialog label > :is(input, select, textarea) { font-size: 14px; color: var(--fg); font-weight: 400; }
  dialog p { margin: 0; font-size: 13px; line-height: 1.5; }
  @media (prefers-reduced-motion: reduce) {
    dialog, dialog[open] { translate: none; @starting-style { translate: none; } }
    button:active:not(:disabled) { transform: none; }
  }

  /* Scrollbars inside shadow roots don't inherit the page's styling. */
  * { scrollbar-color: var(--scrollbar-thumb) transparent; scrollbar-width: thin; }
`;

/**
 * Light dismiss for modal dialogs: `closedby="any"` where supported, a
 * backdrop-click check elsewhere (Safari). Use as `@click=${lightDismiss}`.
 */
export function lightDismiss(e: MouseEvent) {
  const dialog = e.currentTarget as HTMLDialogElement;
  if ("closedBy" in HTMLDialogElement.prototype || e.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
}
