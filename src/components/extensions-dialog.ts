import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ExtensionController } from "../extensions/controller";
import { fetchSource, SITE_EXTENSIONS_DIR, type LibraryEntry } from "../extensions/library";
import { PERMISSIONS } from "../extensions/types";
import { controls, lightDismiss } from "./shared";

const ORIGINS = { builtin: "Built in", site: "This site", installed: "Installed" };

/** Settings → Extensions: what is installed, what it may do, and installing more. */
@customElement("extensions-dialog")
export class ExtensionsDialog extends LitElement {
  static styles = [
    controls,
    css`
      dialog { width: min(620px, 94vw); max-height: 86vh; }
      .list { display: grid; gap: 10px; margin: 12px 0; max-height: 52vh; overflow-y: auto; }
      .ext { border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 12px; display: grid; gap: 4px; }
      .row { display: flex; align-items: center; gap: 8px; }
      .name { font-weight: 600; }
      .origin { font-size: 11px; color: var(--fg-2); text-transform: uppercase; letter-spacing: 0.04em; }
      .row .spacer { flex: 1; }
      .perms { font-size: 12px; color: var(--fg-2); }
      .error { font-size: 12px; color: var(--danger); white-space: pre-wrap; }
      .waiting { font-size: 12px; color: var(--warn); }
      .install { display: flex; gap: 6px; }
      .install input { flex: 1; }
      .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
      .status { width: 7px; height: 7px; border-radius: 50%; background: var(--fg-2); }
      .status.running { background: var(--ok); }
      .status.failed { background: var(--danger); }
    `,
  ];

  @property({ attribute: false }) controller?: ExtensionController;
  @state() private url = "";
  @state() private error = "";
  @state() private busy = false;
  @query("dialog") private dialog?: HTMLDialogElement;
  @query("input[type=file]") private fileInput?: HTMLInputElement;

  show() {
    this.error = "";
    this.dialog?.showModal();
  }

  connectedCallback() {
    super.connectedCallback();
    this.controller?.addEventListener("change", this.refresh);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.controller?.removeEventListener("change", this.refresh);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("controller")) {
      (changed.get("controller") as ExtensionController | undefined)?.removeEventListener("change", this.refresh);
      this.controller?.addEventListener("change", this.refresh);
    }
  }

  private refresh = () => this.requestUpdate();

  private async run(task: () => Promise<unknown>) {
    this.busy = true;
    this.error = "";
    try {
      await task();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  private installUrl(e: Event) {
    e.preventDefault();
    const url = this.url.trim();
    if (!url) return;
    void this.run(async () => {
      const result = await this.controller!.installSource(await fetchSource(url), url);
      if (result.status !== "declined") this.url = "";
      if ("error" in result && result.error && result.status !== "declined") this.error = result.error;
    });
  }

  private installFile() {
    const file = this.fileInput?.files?.[0];
    if (!file) return;
    void this.run(async () => {
      await this.controller!.installSource(await file.text(), file.name);
      this.fileInput!.value = "";
    });
  }

  private renderEntry(e: LibraryEntry) {
    const c = this.controller!;
    const status = c.host.status(e.manifest.id);
    return html`<div class="ext">
      <div class="row">
        <span class="status ${e.enabled ? status.status : "stopped"}" title=${e.enabled ? status.status : "off"}></span>
        <span class="name">${e.manifest.name}</span>
        <span class="origin">${ORIGINS[e.origin]}${e.manifest.version ? ` · v${e.manifest.version}` : ""}</span>
        <span class="spacer"></span>
        ${e.origin === "installed" ? html`<button class="small ghost danger" ?disabled=${this.busy} @click=${() => this.run(() => c.remove(e))}>Remove</button>` : nothing}
        ${e.error
          ? nothing
          : e.unapproved.length
            ? html`<button class="small primary" ?disabled=${this.busy} @click=${() => this.run(() => c.approve(e))}>Allow and turn on</button>`
            : html`<label class="row"><input type="checkbox" .checked=${e.enabled} ?disabled=${this.busy} @change=${(ev: Event) => this.run(() => c.setEnabled(e, (ev.target as HTMLInputElement).checked))} /> On</label>`}
      </div>
      ${e.manifest.description ? html`<div>${e.manifest.description}</div>` : nothing}
      <div class="perms">${e.manifest.permissions.length ? e.manifest.permissions.map((p) => PERMISSIONS[p]).join(" · ") : "No permissions"}${e.from ? html` · <code>${e.from}</code>` : nothing}</div>
      ${e.unapproved.length && !e.error ? html`<div class="waiting">Waiting for your OK to: ${e.unapproved.map((p) => PERMISSIONS[p].toLowerCase()).join(", ")}.</div>` : nothing}
      ${e.error || (e.enabled && status.error) ? html`<div class="error">${e.error || status.error}</div>` : nothing}
      ${e.enabled && status.logs.length ? html`<details><summary class="perms">${status.logs.length} message(s)</summary><div class="error">${status.logs.join("\n\n")}</div></details>` : nothing}
    </div>`;
  }

  render() {
    const entries = this.controller?.entries ?? [];
    return html`<dialog closedby="any" aria-labelledby="ext-title" @click=${lightDismiss}>
      <h3 id="ext-title">Extensions</h3>
      <p class="muted">
        Extensions add commands, underlines, panels and assistant tools. Each runs in its own worker and can only do what it asks for here.
        A site's own extensions live in <code>${SITE_EXTENSIONS_DIR}/</code>. Ask the assistant to write one, or see <a href="https://github.com/PaulKinlan/MarkdownEdiitor/blob/main/docs/extensions.md" target="_blank" rel="noopener">the API</a>.
      </p>
      <div class="list">${entries.map((e) => this.renderEntry(e))}</div>
      <form class="install" @submit=${this.installUrl}>
        <input type="url" placeholder="https://…/extension.js" aria-label="Extension URL" .value=${this.url} @input=${(e: Event) => (this.url = (e.target as HTMLInputElement).value)} />
        <button type="submit" ?disabled=${this.busy || !this.url.trim()}>Install from URL</button>
        <button type="button" ?disabled=${this.busy} @click=${() => this.fileInput?.click()}>From file…</button>
        <input type="file" accept=".js,.mjs,text/javascript" hidden @change=${this.installFile} />
      </form>
      ${this.error ? html`<p class="error">${this.error}</p>` : nothing}
      <div class="actions"><button class="primary" @click=${() => this.dialog?.close()}>Done</button></div>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "extensions-dialog": ExtensionsDialog;
  }
}
