import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { controls } from "./shared";

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
      .bar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--border); }
      .bar input { flex: 1; font-family: var(--mono); font-size: 12px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-2); flex: none; }
      .dot.up { background: var(--ok); }
      .dot.down, .dot.blocked { background: var(--danger); }
      iframe { flex: 1; border: 0; width: 100%; background: white; }
      .help { padding: 24px; max-width: 34em; line-height: 1.6; }
      .help pre { background: var(--bg-3); padding: 8px 12px; border-radius: var(--radius); overflow-x: auto; font-family: var(--mono); font-size: 13px; }
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
        <span class="dot ${this.status}" title=${this.status}></span>
        <input aria-label="Preview server" .value=${this.origin} @change=${this.changeOrigin} />
        ${this.status === "up"
          ? html`<button title="Reload preview" @click=${this.reload}>Reload</button>
              <a href=${this.src} target="_blank" rel="noopener"><button tabindex="-1">Open</button></a>`
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
