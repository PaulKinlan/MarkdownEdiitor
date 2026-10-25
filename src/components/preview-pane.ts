import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { controls } from "./shared";
import { icon } from "./icons";

type Status = "unknown" | "checking" | "up" | "down" | "blocked";

/**
 * Shows the post as rendered by the site's running `hugo server`.
 *
 * The app is served over https from Cloudflare and the preview is usually on
 * http://localhost, so Chrome's Local Network Access permission applies. We
 * only probe the server from a user gesture (or once permission is granted)
 * and declare `targetAddressSpace` so the request is exempt from mixed content.
 */
@customElement("preview-pane")
export class PreviewPane extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg-2); }
      .bar { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border); }
      .url { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); }
      .url:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
      .url input { flex: 1; border: 0; padding: 0; font-family: var(--mono); font-size: 12px; background: transparent; box-shadow: none; }
      .dot.up { background: var(--ok); }
      .dot.checking { background: var(--warn); }
      .dot.down, .dot.blocked { background: var(--danger); }
      iframe { flex: 1; border: 0; width: 100%; background: white; }
      .help { padding: 28px 24px; max-width: 34em; line-height: 1.6; color: var(--fg-2); }
      .help p { margin: 0 0 12px; }
      .help strong { color: var(--fg); }
      .help pre { background: var(--bg-3); color: var(--fg); padding: 10px 12px; border-radius: var(--radius); overflow-x: auto; font-family: var(--mono); font-size: 13px; margin: 0 0 12px; }
      a.button { display: inline-flex; align-items: center; justify-content: center; width: var(--control-h); height: var(--control-h); border-radius: var(--radius); color: var(--fg-2); }
      a.button:hover { background: var(--hover); color: var(--fg); }
    `,
  ];

  /** e.g. http://localhost:1313 */
  @property() origin = "http://localhost:1313";
  /** Site-relative URL of the post, e.g. /the-token-salary/ */
  @property() path = "/";
  @property({ type: Boolean }) draft = false;

  @state() private status: Status = "unknown";
  @state() private reloads = 0;

  get src(): string {
    try {
      return new URL(this.path, this.origin).href;
    } catch {
      return "about:blank";
    }
  }

  connectedCallback() {
    super.connectedCallback();
    // Connect automatically only if the browser won't need to prompt.
    void loopbackPermission().then((p) => {
      if (p === "granted" || !isLoopback(this.origin) || location.hostname === "localhost") void this.connect();
    });
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("origin") && changed.get("origin") !== undefined) void this.connect();
  }

  /** Reloads the frame, e.g. after a save when Hugo's live reload is not running. */
  reload() {
    this.reloads++;
  }

  private async connect() {
    this.status = "checking";
    try {
      const init: RequestInit & { targetAddressSpace?: string } = { mode: "no-cors", cache: "no-store" };
      if (isLoopback(this.origin)) init.targetAddressSpace = "loopback";
      await fetch(this.origin, init);
      this.status = "up";
    } catch {
      this.status = (await loopbackPermission()) === "denied" ? "blocked" : "down";
    }
  }

  private changeOrigin(e: Event) {
    const value = (e.target as HTMLInputElement).value.trim().replace(/\/$/, "");
    this.dispatchEvent(new CustomEvent("origin-change", { detail: { origin: value }, bubbles: true, composed: true }));
  }

  private renderHelp() {
    if (this.status === "blocked") {
      return html`<div class="help">
        <p><strong>Local network access is blocked for this site.</strong></p>
        <p>The preview loads from your own machine, so the browser needs permission. Open site settings (the icon at the left of the address bar), set <em>Local network access</em> to Allow, then press Connect.</p>
      </div>`;
    }
    if (this.status === "down") {
      return html`<div class="help">
        <p><strong>No Hugo server found at <code>${this.origin}</code>.</strong></p>
        <p>Start one in your site folder${this.draft ? html` (with <code>-D</code> so drafts render)` : nothing}:</p>
        <pre>hugo server -D --port ${portOf(this.origin)}</pre>
        <p class="muted">Hugo's live reload refreshes this pane on every save.</p>
      </div>`;
    }
    return html`<div class="help">
      <p>Preview shows this post rendered by your local <code>hugo server</code>, with your site's real styles.</p>
      <p class="muted">Your browser may ask for permission to reach a server on your device.</p>
    </div>`;
  }

  render() {
    return html`
      <div class="bar">
        <label class="url">
          <span class="dot ${this.status}" title=${this.status}></span>
          <input aria-label="Preview server" .value=${this.origin} @change=${this.changeOrigin} />
        </label>
        ${this.status === "up"
          ? html`<button class="ghost icon-only" aria-label="Reload preview" title="Reload preview" @click=${this.reload}>${icon("refresh")}</button>
              <a class="button" href=${this.src} target="_blank" rel="noopener" aria-label="Open in a new tab" title="Open in a new tab">${icon("external")}</a>`
          : html`<button class="primary" @click=${this.connect}>Connect</button>`}
      </div>
      ${this.status === "up"
        ? html`<iframe title="Post preview" src=${`${this.src}${this.reloads ? `?r=${this.reloads}` : ""}`}></iframe>`
        : this.renderHelp()}
    `;
  }
}

function isLoopback(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

function portOf(origin: string): string {
  try {
    return new URL(origin).port || "1313";
  } catch {
    return "1313";
  }
}

async function loopbackPermission(): Promise<PermissionState> {
  // Never query 'local-network-access': it crashes older Chrome renderers.
  try {
    return (await navigator.permissions.query({ name: "loopback-network" as PermissionName })).state;
  } catch {
    return "prompt";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "preview-pane": PreviewPane;
  }
}
