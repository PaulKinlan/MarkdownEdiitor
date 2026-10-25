import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { discoverMcpTools, fetchToolSettings, saveToolSettings, type AgentSettings } from "../lib/agent-client";
import {
  DEFAULT_TOOL_SETTINGS,
  HTTP_PRESETS,
  SECRET_MASK,
  mcpToolName,
  type HttpParam,
  type HttpToolSource,
  type McpSource,
  type ToolSettings,
  type ToolSource,
} from "../shared/tools";
import { controls, lightDismiss } from "./shared";
import { icon } from "./icons";

type Header = { key: string; value: string };

/**
 * Settings for the tools every agent gets: the model's own web search, remote
 * MCP servers and plain HTTP APIs. Stored on the agent server; header values
 * come back masked and stay as they are unless retyped.
 */
@customElement("tools-settings")
export class ToolsSettings extends LitElement {
  static styles = [
    controls,
    css`
      dialog { width: min(640px, 94vw); max-height: 88vh; overflow-y: auto; }
      .stack { display: grid; gap: 12px; }
      .check { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: var(--fg); font-weight: 400; }
      .check input { margin-top: 3px; }
      .list { display: grid; gap: 4px; }
      .source { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius); }
      .source .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
      .badge { font-size: 11px; color: var(--fg-2); background: var(--bg-3); border-radius: 999px; padding: 1px 8px; }
      .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .row > input, .row > select { flex: 1; min-width: 90px; }
      .row > input.narrow, .row > select.narrow { flex: 0 0 auto; min-width: 0; width: 90px; }
      fieldset { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 12px; margin: 0; display: grid; gap: 10px; }
      legend { font-size: 12px; font-weight: 600; color: var(--fg-2); padding: 0 4px; }
      .tools { display: grid; gap: 2px; max-height: 30vh; overflow-y: auto; }
      .tools label { display: flex; gap: 8px; align-items: flex-start; font-weight: 400; color: var(--fg); font-size: 13px; }
      .tools small { display: block; color: var(--fg-2); font-size: 12px; }
      .error { color: var(--danger); font-size: 13px; }
      .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
      .actions .left { margin-right: auto; }
      .sub { font-size: 12px; font-weight: 600; color: var(--fg-2); }
    `,
  ];

  @property({ attribute: false }) agentSettings?: AgentSettings;
  /** Whether the agent server has a search key (DeepSeek, Brave or Tavily) for web_search. */
  @property({ type: Boolean }) webSearch = false;

  @state() private settings: ToolSettings = DEFAULT_TOOL_SETTINGS;
  @state() private editing?: ToolSource;
  @state() private headers: Header[] = [];
  @state() private error = "";
  @state() private busy = "";
  @state() private dirty = false;

  @query("dialog") private dialog?: HTMLDialogElement;

  async show() {
    this.editing = undefined;
    this.error = "";
    this.dirty = false;
    this.dialog?.showModal();
    if (!this.agentSettings) return;
    this.busy = "Loading…";
    try {
      this.settings = await fetchToolSettings(this.agentSettings);
    } catch (e) {
      this.error = message(e);
    } finally {
      this.busy = "";
    }
  }

  private async save() {
    if (!this.agentSettings) return;
    const settings = this.editing ? this.withEditing() : this.settings;
    this.busy = "Saving…";
    this.error = "";
    try {
      this.settings = await saveToolSettings(this.agentSettings, settings);
      this.editing = undefined;
      this.dirty = false;
    } catch (e) {
      this.error = message(e);
    } finally {
      this.busy = "";
    }
  }

  /** Settings with the source being edited put back in place (or added). */
  private withEditing(): ToolSettings {
    const source = { ...this.editing!, headers: Object.fromEntries(this.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value])) } as ToolSource;
    const sources = this.settings.sources.some((s) => s.id === source.id)
      ? this.settings.sources.map((s) => (s.id === source.id ? source : s))
      : [...this.settings.sources, source];
    return { ...this.settings, sources };
  }

  private edit(source: ToolSource) {
    this.editing = structuredClone(source);
    this.headers = Object.entries(source.headers).map(([key, value]) => ({ key, value }));
    if (!this.headers.length) this.headers = [{ key: source.kind === "mcp" ? "Authorization" : "", value: "" }];
    this.error = "";
  }

  private addMcp() {
    this.edit({ id: crypto.randomUUID(), kind: "mcp", name: "", enabled: true, url: "", headers: {}, tools: [] });
  }

  private addHttp(preset?: Omit<HttpToolSource, "id">) {
    const base: Omit<HttpToolSource, "id"> = preset ?? { kind: "http", name: "", enabled: true, description: "", method: "GET", url: "", headers: {}, params: [] };
    this.edit({ ...structuredClone(base), id: crypto.randomUUID() });
  }

  private removeSource(source: ToolSource) {
    if (!confirm(`Remove ${source.name}?`)) return;
    this.settings = { ...this.settings, sources: this.settings.sources.filter((s) => s.id !== source.id) };
    this.dirty = true;
  }

  private toggle(source: ToolSource, enabled: boolean) {
    this.settings = { ...this.settings, sources: this.settings.sources.map((s) => (s.id === source.id ? { ...s, enabled } : s)) };
    this.dirty = true;
  }

  private patch(change: Partial<McpSource> | Partial<HttpToolSource>) {
    this.editing = { ...this.editing!, ...change } as ToolSource;
  }

  private async discover() {
    const source = this.editing as McpSource;
    if (!this.agentSettings || !source.url) return;
    this.busy = "Connecting…";
    this.error = "";
    try {
      const headers = Object.fromEntries(this.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value]));
      const saved = this.settings.sources.some((s) => s.id === source.id);
      const tools = await discoverMcpTools(this.agentSettings, { url: source.url, headers, ...(saved ? { id: source.id } : {}) });
      this.patch({ tools });
      if (!source.name) this.patch({ name: new URL(source.url).hostname.split(".").slice(-2, -1)[0] ?? "server" });
    } catch (e) {
      this.error = message(e);
    } finally {
      this.busy = "";
    }
  }

  render() {
    return html`<dialog closedby="any" aria-labelledby="tools-title" @click=${lightDismiss}>
      <div class="stack">
        <h3 id="tools-title">Assistant tools</h3>
        ${this.editing ? this.renderEditor(this.editing) : this.renderList()}
        ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
        ${this.busy ? html`<p class="muted" role="status">${this.busy}</p>` : nothing}
      </div>
    </dialog>`;
  }

  private renderList() {
    const s = this.settings;
    return html`
      <label class="check">
        <input type="checkbox" .checked=${s.nativeWebTools} @change=${(e: Event) => ((this.settings = { ...s, nativeWebTools: (e.target as HTMLInputElement).checked }), (this.dirty = true))} />
        <span>Use the model's own web search when it has one. Claude searches and reads pages itself, and OpenAI models search. Other models use the editor's web_search and fetch_url.</span>
      </label>
      <p class="muted">
        ${this.webSearch
          ? html`web_search and fetch_url use the search key on the agent server (DeepSeek Search and Fetch when <code>DEEPSEEK_API_KEY</code> is set).`
          : html`No search key on the agent server, so models without their own search can't search the web. Set <code>DEEPSEEK_API_KEY</code>, <code>BRAVE_API_KEY</code> or <code>TAVILY_API_KEY</code>, or add a search tool below.`}
      </p>
      <h4>MCP servers and APIs</h4>
      <div class="list">
        ${s.sources.length
          ? s.sources.map(
              (src) => html`<div class="source">
                <input type="checkbox" aria-label="Enable ${src.name}" .checked=${src.enabled} @change=${(e: Event) => this.toggle(src, (e.target as HTMLInputElement).checked)} />
                <span class="name">${src.name}</span>
                <span class="badge">${src.kind === "mcp" ? `MCP · ${plural(src.tools.length - (src.disabled?.length ?? 0), "tool")}` : `${src.method} API`}</span>
                <button type="button" class="small" @click=${() => this.edit(src)}>Edit</button>
                <button type="button" class="small ghost danger" @click=${() => this.removeSource(src)}>Remove</button>
              </div>`,
            )
          : html`<p class="muted">None yet. Every agent (post chats and the site assistant) gets the tools you add here.</p>`}
      </div>
      <div class="row">
        <button type="button" @click=${this.addMcp}>${icon("plus")} MCP server</button>
        <button type="button" @click=${() => this.addHttp()}>${icon("plus")} HTTP API</button>
        <select
          aria-label="Add a ready-made API tool"
          @change=${(e: Event) => {
            const select = e.target as HTMLSelectElement;
            const preset = HTTP_PRESETS.find((p) => p.name === select.value);
            select.value = "";
            if (preset) this.addHttp(preset);
          }}
        >
          <option value="">Add a ready-made API…</option>
          ${HTTP_PRESETS.map((p) => html`<option value=${p.name}>${p.name}</option>`)}
        </select>
      </div>
      <div class="actions">
        <button type="button" @click=${() => this.dialog?.close()}>Close</button>
        <button type="button" class="primary" ?disabled=${!this.dirty || !!this.busy} @click=${this.save}>Save</button>
      </div>
    `;
  }

  private renderEditor(src: ToolSource) {
    return html`
      ${src.kind === "mcp" ? this.renderMcp(src) : this.renderHttp(src)}
      <fieldset>
        <legend>Headers</legend>
        <p class="muted">Sent with every request; use them for API keys and tokens. Saved values show as ${SECRET_MASK} and stay as they are unless you retype them.</p>
        ${this.headers.map(
          (h, i) => html`<div class="row">
            <input aria-label="Header name" placeholder=${src.kind === "mcp" ? "Authorization" : "X-API-Key"} .value=${h.key} @input=${(e: Event) => this.setHeader(i, { key: (e.target as HTMLInputElement).value })} />
            <input aria-label="Header value" type="password" autocomplete="off" placeholder="Bearer …" .value=${h.value} @input=${(e: Event) => this.setHeader(i, { value: (e.target as HTMLInputElement).value })} />
            <button type="button" class="small ghost" aria-label="Remove header" @click=${() => (this.headers = this.headers.filter((_, j) => j !== i))}>✕</button>
          </div>`,
        )}
        <div><button type="button" class="small" @click=${() => (this.headers = [...this.headers, { key: "", value: "" }])}>${icon("plus")} Header</button></div>
      </fieldset>
      <div class="actions">
        <button type="button" class="left" @click=${() => (this.editing = undefined)}>Back</button>
        <button type="button" class="primary" ?disabled=${!!this.busy || !src.name || !src.url} @click=${this.save}>Save</button>
      </div>
    `;
  }

  private setHeader(i: number, change: Partial<Header>) {
    this.headers = this.headers.map((h, j) => (j === i ? { ...h, ...change } : h));
  }

  private renderMcp(src: McpSource) {
    const disabled = new Set(src.disabled ?? []);
    return html`
      <p class="muted">A remote MCP server over Streamable HTTP. Servers that sign in with OAuth aren't supported yet; give a token in a header instead.</p>
      <label>Server URL <input type="url" placeholder="https://example.com/mcp" .value=${src.url} @change=${(e: Event) => this.patch({ url: (e.target as HTMLInputElement).value.trim() })} /></label>
      <label>Name <input placeholder="github" .value=${src.name} @change=${(e: Event) => this.patch({ name: (e.target as HTMLInputElement).value.trim() })} /></label>
      <fieldset>
        <legend>Tools</legend>
        <div><button type="button" ?disabled=${!src.url || !!this.busy} @click=${this.discover}>${icon("refresh")} ${src.tools.length ? "Refresh tools" : "Connect and list tools"}</button></div>
        ${src.tools.length
          ? html`<div class="tools">
              ${src.tools.map(
                (t) => html`<label>
                  <input
                    type="checkbox"
                    .checked=${!disabled.has(t.name)}
                    @change=${(e: Event) => {
                      const on = (e.target as HTMLInputElement).checked;
                      this.patch({ disabled: on ? [...disabled].filter((n) => n !== t.name) : [...disabled, t.name] });
                    }}
                  />
                  <span><code>${mcpToolName(src.name || "server", t.name)}</code><small>${t.description ?? ""}</small></span>
                </label>`,
              )}
            </div>`
          : html`<p class="muted">Connect to see what the server offers. The list is saved, so agents don't connect until a tool is used.</p>`}
      </fieldset>
    `;
  }

  private renderHttp(src: HttpToolSource) {
    const setParam = (i: number, change: Partial<HttpParam>) => this.patch({ params: src.params.map((p, j) => (j === i ? { ...p, ...change } : p)) });
    return html`
      <label>Tool name <input placeholder="brave_search" .value=${src.name} @change=${(e: Event) => this.patch({ name: (e.target as HTMLInputElement).value.trim() })} /></label>
      <label>What it does (the model reads this) <textarea rows="2" .value=${src.description} @change=${(e: Event) => this.patch({ description: (e.target as HTMLTextAreaElement).value })}></textarea></label>
      <div class="row">
        <select class="narrow" aria-label="Method" .value=${src.method} @change=${(e: Event) => this.patch({ method: (e.target as HTMLSelectElement).value as "GET" | "POST" })}>
          <option>GET</option>
          <option>POST</option>
        </select>
        <input type="url" aria-label="URL" placeholder="https://api.example.com/search or …/items/{id}" .value=${src.url} @change=${(e: Event) => this.patch({ url: (e.target as HTMLInputElement).value.trim() })} />
      </div>
      <fieldset>
        <legend>Parameters</legend>
        <p class="muted">What the model fills in. Path parameters replace <code>{name}</code> in the URL; body parameters go in a JSON body (POST).</p>
        ${src.params.map(
          (p, i) => html`<div class="row">
            <input aria-label="Parameter name" placeholder="q" .value=${p.name} @change=${(e: Event) => setParam(i, { name: (e.target as HTMLInputElement).value.trim() })} />
            <select class="narrow" aria-label="Type" .value=${p.type} @change=${(e: Event) => setParam(i, { type: (e.target as HTMLSelectElement).value as HttpParam["type"] })}>
              <option value="string">text</option>
              <option value="number">number</option>
              <option value="boolean">yes/no</option>
            </select>
            <select class="narrow" aria-label="Where" .value=${p.in} @change=${(e: Event) => setParam(i, { in: (e.target as HTMLSelectElement).value as HttpParam["in"] })}>
              <option value="query">query</option>
              <option value="path">path</option>
              <option value="body">body</option>
            </select>
            <label class="check" style="flex:0 0 auto"><input type="checkbox" .checked=${!!p.required} @change=${(e: Event) => setParam(i, { required: (e.target as HTMLInputElement).checked })} /> required</label>
            <input aria-label="Description" placeholder="Description" .value=${p.description ?? ""} @change=${(e: Event) => setParam(i, { description: (e.target as HTMLInputElement).value })} />
            <button type="button" class="small ghost" aria-label="Remove parameter" @click=${() => this.patch({ params: src.params.filter((_, j) => j !== i) })}>✕</button>
          </div>`,
        )}
        <div><button type="button" class="small" @click=${() => this.patch({ params: [...src.params, { name: "", type: "string", in: src.method === "POST" ? "body" : "query" }] })}>${icon("plus")} Parameter</button></div>
      </fieldset>
      <fieldset>
        <legend>Result</legend>
        <p class="muted">Optional: trim JSON replies so the model sees only what matters.</p>
        <label>Keep this part <input placeholder="web.results" .value=${src.resultPath ?? ""} @change=${(e: Event) => this.patch({ resultPath: (e.target as HTMLInputElement).value.trim() || undefined })} /></label>
        <label>Keep these fields of each item <input placeholder="title, url, description" .value=${(src.fields ?? []).join(", ")} @change=${(e: Event) => this.patch({ fields: splitList((e.target as HTMLInputElement).value) })} /></label>
      </fieldset>
    `;
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function splitList(value: string): string[] | undefined {
  const items = value.split(",").map((s) => s.trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

declare global {
  interface HTMLElementTagNameMap {
    "tools-settings": ToolsSettings;
  }
}
