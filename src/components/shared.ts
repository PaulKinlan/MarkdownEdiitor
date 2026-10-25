import { css } from "lit";

export const controls = css`
  button, select, input, textarea {
    font: inherit;
    color: inherit;
  }
  button {
    background: var(--bg-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 10px;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover:not(:disabled) { border-color: var(--fg-2); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
  button.ghost { background: transparent; border-color: transparent; }
  input, select, textarea {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 8px;
    min-width: 0;
  }
  input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .muted { color: var(--fg-2); }
  code { font-family: var(--mono); font-size: 0.92em; }
`;
