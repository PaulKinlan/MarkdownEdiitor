import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { keyLabel } from "../lib/keys";
import { controls, lightDismiss } from "./shared";

export interface PaletteCommand {
  id: string;
  title: string;
  /** Where it comes from, e.g. an extension's name. */
  detail?: string;
  key?: string;
  run: () => void;
}

/** The command palette: type to filter every command, Enter runs the first match. */
@customElement("command-palette")
export class CommandPalette extends LitElement {
  static styles = [
    controls,
    css`
      dialog { width: min(560px, 94vw); padding: 0; top: 12vh; margin-top: 0; }
      input { width: 100%; border: 0; border-bottom: 1px solid var(--border); border-radius: 0; padding: 12px 14px; font-size: 15px; background: transparent; }
      input:focus { outline: none; }
      ul { list-style: none; margin: 0; padding: 6px; max-height: 50vh; overflow-y: auto; }
      li { display: flex; align-items: baseline; gap: 10px; padding: 7px 10px; border-radius: 8px; cursor: pointer; }
      li[aria-selected="true"] { background: var(--accent-soft, color-mix(in srgb, var(--accent) 14%, transparent)); }
      .title { flex: 1; }
      .detail { font-size: 12px; color: var(--fg-2); }
      kbd { font: 11px/1 var(--mono, ui-monospace, monospace); color: var(--fg-2); border: 1px solid var(--border); border-radius: 4px; padding: 3px 5px; }
      .empty { padding: 12px 14px; color: var(--fg-2); }
    `,
  ];

  @property({ attribute: false }) commands: PaletteCommand[] = [];
  @state() private filter = "";
  @state() private active = 0;
  @query("dialog") private dialog?: HTMLDialogElement;
  @query("input") private input?: HTMLInputElement;

  open() {
    this.filter = "";
    this.active = 0;
    this.dialog?.showModal();
    this.input?.focus();
  }

  private get filtered(): PaletteCommand[] {
    const words = this.filter.toLowerCase().split(/\s+/).filter(Boolean);
    return this.commands.filter((c) => words.every((w) => `${c.title} ${c.detail ?? ""}`.toLowerCase().includes(w)));
  }

  private run(command: PaletteCommand | undefined) {
    if (!command) return;
    this.dialog?.close();
    command.run();
  }

  private onKey(e: KeyboardEvent) {
    const count = this.filtered.length;
    if (e.key === "ArrowDown") this.active = count ? (this.active + 1) % count : 0;
    else if (e.key === "ArrowUp") this.active = count ? (this.active - 1 + count) % count : 0;
    else if (e.key === "Enter") this.run(this.filtered[this.active]);
    else return;
    e.preventDefault();
  }

  render() {
    const filtered = this.filtered;
    return html`<dialog aria-label="Commands" closedby="any" @click=${lightDismiss}>
      <input
        type="text"
        placeholder="Type a command"
        aria-label="Filter commands"
        role="combobox"
        aria-controls="list"
        aria-expanded="true"
        .value=${this.filter}
        @input=${(e: Event) => ((this.filter = (e.target as HTMLInputElement).value), (this.active = 0))}
        @keydown=${this.onKey}
      />
      ${filtered.length
        ? html`<ul id="list" role="listbox">
            ${filtered.map(
              (c, i) =>
                html`<li role="option" aria-selected=${i === this.active ? "true" : "false"} @click=${() => this.run(c)} @mousemove=${() => (this.active = i)}>
                  <span class="title">${c.title}</span>${c.detail ? html`<span class="detail">${c.detail}</span>` : nothing}${c.key ? html`<kbd>${keyLabel(c.key)}</kbd>` : nothing}
                </li>`,
            )}
          </ul>`
        : html`<div class="empty">No commands match.</div>`}
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "command-palette": CommandPalette;
  }
}
