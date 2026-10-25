import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { FrontMatterData, FrontMatterFormat } from "../lib/frontmatter";
import { controls } from "./shared";

const LONG_TEXT = new Set(["summary", "description"]);
const DATE_KEYS = new Set(["date", "lastmod", "publishdate", "expirydate"]);
/** Shown first, in this order; everything else follows in file order. */
const PRIORITY = ["title", "seotitle", "slug", "date", "draft", "summary", "description", "tags", "authors"];

/**
 * A form over the post's front matter. It renders whatever keys the file has,
 * picking a control from the value's type, and a raw editor for anything the
 * form can't represent (nested maps, new keys). Emits `field-change` with
 * { key, value } and `raw-change` with { raw }.
 */
@customElement("frontmatter-form")
export class FrontMatterForm extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: block; border-bottom: 1px solid var(--border); background: var(--bg-2); }
      header { display: flex; align-items: center; gap: 8px; padding: 6px 12px; }
      header h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; margin: 0; color: var(--fg-2); flex: 1; }
      .grid { display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; padding: 4px 12px 12px; align-items: center; }
      label { color: var(--fg-2); font-size: 13px; }
      .row { display: flex; gap: 6px; align-items: center; }
      .row input[type="text"] { flex: 1; }
      textarea { width: 100%; resize: vertical; min-height: 3.4em; }
      textarea.raw { font-family: var(--mono); font-size: 13px; min-height: 10em; margin: 0 12px 12px; width: calc(100% - 24px); }
      .error { color: var(--danger); padding: 0 12px 8px; font-size: 13px; }
      .readonly { font-family: var(--mono); font-size: 12px; color: var(--fg-2); }
      .grid input[type="checkbox"] { justify-self: start; }
      .char-count { font-size: 12px; color: var(--fg-2); min-width: 4ch; text-align: right; }
    `,
  ];

  @property({ attribute: false }) data: FrontMatterData = {};
  @property() raw = "";
  @property() format: FrontMatterFormat = "yaml";
  @property({ type: Boolean, reflect: true }) collapsed = false;

  @state() private mode: "form" | "raw" = "form";
  @state() private rawDraft = "";
  @state() private rawError = "";

  private emit(type: string, detail: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private set(key: string, value: unknown) {
    this.emit("field-change", { key, value });
  }

  private toggleRaw() {
    this.mode = this.mode === "form" ? "raw" : "form";
    this.rawDraft = this.raw;
    this.rawError = "";
  }

  private applyRaw(e: Event) {
    this.rawDraft = (e.target as HTMLTextAreaElement).value;
    this.emit("raw-change", {
      raw: this.rawDraft,
      onError: (message: string) => (this.rawError = message),
      onOk: () => (this.rawError = ""),
    });
  }

  private renderField(key: string, value: unknown) {
    const id = `f-${key}`;
    const lower = key.toLowerCase();
    let control;
    if (typeof value === "boolean") {
      control = html`<input id=${id} type="checkbox" .checked=${value} @change=${(e: Event) => this.set(key, (e.target as HTMLInputElement).checked)} />`;
    } else if (Array.isArray(value) && value.every((v) => typeof v !== "object")) {
      control = html`<input
        id=${id}
        type="text"
        .value=${value.join(", ")}
        placeholder="comma, separated"
        @change=${(e: Event) => this.set(key, splitList((e.target as HTMLInputElement).value))}
      />`;
    } else if (DATE_KEYS.has(lower) && (typeof value === "string" || value instanceof Date)) {
      control = html`<div class="row">
        <input id=${id} type="text" .value=${String(value instanceof Date ? value.toISOString() : value)} @change=${(e: Event) => this.set(key, (e.target as HTMLInputElement).value)} />
        <button title="Set to now" @click=${() => this.set(key, new Date().toISOString())}>Now</button>
      </div>`;
    } else if (typeof value === "string" && (LONG_TEXT.has(lower) || value.length > 90 || value.includes("\n"))) {
      control = html`<textarea id=${id} .value=${value} @change=${(e: Event) => this.set(key, (e.target as HTMLTextAreaElement).value)}></textarea>`;
    } else if (typeof value === "string" || typeof value === "number" || value == null) {
      const isNumber = typeof value === "number";
      control = html`<div class="row">
        <input
          id=${id}
          type="text"
          .value=${value == null ? "" : String(value)}
          @input=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            const count = input.nextElementSibling;
            if (count) count.textContent = String(input.value.length);
          }}
          @change=${(e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            this.set(key, isNumber && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : v);
          }}
        />
        ${lower.includes("title") ? html`<span class="char-count" title="Characters" .textContent=${String(String(value ?? "").length)}></span>` : nothing}
      </div>`;
    } else {
      control = html`<span class="readonly">${JSON.stringify(value)} <span class="muted">(edit in raw)</span></span>`;
    }
    return html`<label for=${id}>${key}</label>${control}`;
  }

  render() {
    const keys = Object.keys(this.data);
    const ordered = [...PRIORITY.filter((k) => keys.includes(k)), ...keys.filter((k) => !PRIORITY.includes(k))];
    return html`
      <header>
        <h2>Front matter <span class="muted">(${this.format})</span></h2>
        ${this.collapsed ? nothing : html`<button class="ghost" @click=${this.toggleRaw}>${this.mode === "form" ? "Edit raw" : "Form"}</button>`}
        <button class="ghost" aria-expanded=${!this.collapsed} @click=${() => (this.collapsed = !this.collapsed)}>
          ${this.collapsed ? "Show" : "Hide"}
        </button>
      </header>
      ${this.collapsed
        ? nothing
        : this.mode === "raw"
          ? html`<textarea class="raw" spellcheck="false" .value=${this.rawDraft} @input=${this.applyRaw}></textarea>
              ${this.rawError ? html`<div class="error" role="alert">${this.rawError}</div>` : nothing}`
          : html`<div class="grid">${ordered.map((k) => this.renderField(k, this.data[k]))}</div>`}
    `;
  }
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

declare global {
  interface HTMLElementTagNameMap {
    "frontmatter-form": FrontMatterForm;
  }
}
