import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, query, state } from "lit/decorators.js";
import { Post } from "../lib/frontmatter";
import { readHugoConfig, listShortcodes, type HugoConfig } from "../lib/hugo";
import { getFile, writeFile, exists, readText } from "../lib/fs";
import { listPosts, newPostFromTemplate, sections, summarise, sortPosts, type PostSummary } from "../lib/posts";
import { findExistingSite, hasPermission, loadSites, requestPermission, saveSites, type SiteRecord } from "../lib/sites";
import { createSampleSite } from "../lib/sample-site";
import { slugify } from "../lib/slug";
import { AgentConnection, fetchAgentConfig, loadAgentSettings, saveAgentSettings, sessionId, type AgentSettings } from "../lib/agent-client";
import { syncSiteIndex } from "../lib/indexer";
import type { Edit, ModelInfo, PostContext } from "../shared/protocol";
import { controls } from "./shared";
import type { MdEditor } from "./md-editor";
import type { PreviewPane } from "./preview-pane";
import "./md-editor";
import "./frontmatter-form";
import "./preview-pane";
import "./agent-panel";

interface OpenPost {
  summary: PostSummary;
  post: Post;
  /** Text as last read from or written to disk. */
  savedText: string;
  lastModified: number;
}

const LAST_SITE_KEY = "md-editor:last-site";
const PREVIEW_KEY = "md-editor:preview-open";
const TAB_KEY = "md-editor:side-tab";
const SITE_RULE_FILES = ["CLAUDE.md", "AGENTS.md"];

@customElement("md-app")
export class MdApp extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; }
      .top { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); background: var(--bg-2); }
      .top h1 { font-size: 14px; margin: 0 8px 0 0; }
      .top .spacer { flex: 1; }
      .body { display: grid; grid-template-columns: 300px minmax(0, 1fr) var(--preview-width, minmax(0, 1fr)); min-height: 0; }
      .body.no-preview { grid-template-columns: 300px minmax(0, 1fr); }
      .body.solo { grid-template-columns: minmax(0, 1fr); }
      aside { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; background: var(--bg-2); }
      .filters { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-bottom: 1px solid var(--border); }
      .filters .row { display: flex; gap: 6px; }
      .filters input[type="search"] { flex: 1; }
      ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
      li button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 6px 12px; cursor: pointer; border-bottom: 1px solid var(--border); content-visibility: auto; contain-intrinsic-size: auto 48px; }
      li button:hover { background: var(--bg-3); }
      li button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      li button[aria-current="true"] { background: color-mix(in srgb, var(--accent) 14%, transparent); }
      .title { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .meta { display: block; font-size: 12px; color: var(--fg-2); }
      .badge { font-size: 11px; padding: 0 5px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 18%, transparent); color: var(--warn); margin-left: 4px; }
      main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
      .toolbar { display: flex; gap: 6px; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .toolbar .path { font-family: var(--mono); font-size: 12px; color: var(--fg-2); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      md-editor { flex: 1; }
      .side { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--border); }
      .side > preview-pane, .side > agent-panel { flex: 1; }
      .tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--bg-2); }
      .tabs button { all: unset; cursor: pointer; padding: 6px 14px; font-size: 13px; color: var(--fg-2); border-bottom: 2px solid transparent; }
      .tabs button[aria-selected="true"] { color: var(--fg); border-bottom-color: var(--accent); }
      .tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      .status { display: flex; gap: 16px; padding: 3px 12px; font-size: 12px; color: var(--fg-2); border-top: 1px solid var(--border); background: var(--bg-2); }
      .status .dirty { color: var(--warn); }
      .status .error { color: var(--danger); }
      .banner { padding: 8px 12px; background: color-mix(in srgb, var(--warn) 14%, transparent); display: flex; gap: 8px; align-items: center; }
      .empty { display: grid; place-content: center; text-align: center; padding: 32px; gap: 12px; color: var(--fg-2); max-width: 40em; margin: auto; }
      .empty h2 { color: var(--fg); margin: 0; }
      .empty .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
      dialog { border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--fg); padding: 20px; min-width: min(420px, 90vw); }
      dialog::backdrop { background: rgb(0 0 0 / 0.35); }
      dialog form { display: grid; gap: 10px; }
      dialog label { display: grid; gap: 4px; font-size: 13px; color: var(--fg-2); }
      dialog .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }
      dialog .actions .left { margin-right: auto; }
      @media (max-width: 900px) {
        .body, .body.no-preview, .body.solo { grid-template-columns: 1fr; }
        aside { max-height: 35vh; border-right: 0; border-bottom: 1px solid var(--border); }
        .side { display: none; }
      }
    `,
  ];

  @state() private sites: SiteRecord[] = [];
  @state() private site?: SiteRecord;
  @state() private needsPermission = false;
  @state() private config?: HugoConfig;
  @state() private shortcodes: string[] = [];
  @state() private posts: PostSummary[] = [];
  @state() private loading = false;
  @state() private filter = "";
  @state() private sectionFilter = "*";
  @state() private draftsOnly = false;
  @state() private open?: OpenPost;
  @state() private text = "";
  @state() private message = "";
  @state() private error = "";
  @state() private changedOnDisk = false;
  @state() private showPreview = localStorage.getItem(PREVIEW_KEY) !== "false";
  @state() private sideTab: "preview" | "assistant" = localStorage.getItem(TAB_KEY) === "assistant" ? "assistant" : "preview";
  @state() private agentSettings: AgentSettings = loadAgentSettings();
  @state() private models: ModelInfo[] = [];
  @state() private agentError = "";
  @state() private connection?: AgentConnection;
  @state() private indexStatus = "";
  private siteInstructions = "";

  @query("md-editor") private editor?: MdEditor;
  @query("preview-pane") private preview?: PreviewPane;
  @query("#new-post") private newPostDialog?: HTMLDialogElement;
  @query("#site-settings") private settingsDialog?: HTMLDialogElement;

  private readonly supportsPicker = "showDirectoryPicker" in window;
  // Bumped on each site or post load, so a slow load that finishes after the user moved on is dropped.
  private siteGeneration = 0;
  private postGeneration = 0;
  /** Bumped each time a post is (re)loaded from disk; resets the front matter form. */
  private loadCount = 0;
  private saving: Promise<void> = Promise.resolve();

  get dirty(): boolean {
    return !!this.open && this.text !== this.open.savedText;
  }

  async connectedCallback() {
    super.connectedCallback();
    window.addEventListener("beforeunload", this.onBeforeUnload);
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("keydown", this.onKeydown);
    this.sites = await loadSites();
    const last = this.sites.find((s) => s.id === localStorage.getItem(LAST_SITE_KEY)) ?? this.sites[0];
    if (last) await this.selectSite(last, false);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("keydown", this.onKeydown);
  }

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.dirty) e.preventDefault();
  };

  /** Picks up edits made outside the editor (another app, git checkout, an agent). */
  private onFocus = async () => {
    const { open, site } = this;
    if (!open || !site || this.needsPermission) return;
    const file = await (await getFile(site.handle, open.summary.path))?.getFile();
    // Compare contents, not times: a checkout or sync tool can keep or rewind modification times.
    if (!file || (await file.text()) === open.savedText || this.open !== open) return;
    if (this.dirty) {
      this.changedOnDisk = true;
    } else {
      await this.openPost(this.open.summary, true);
      this.flash("Reloaded: the file changed on disk");
    }
  };

  // ---- Sites ---------------------------------------------------------------

  private async addSite() {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ id: "hugo-site", mode: "readwrite" });
    } catch (e) {
      if ((e as DOMException).name !== "AbortError") this.error = String(e);
      return;
    }
    await this.registerSite(handle);
  }

  private async addSampleSite() {
    await this.registerSite(await createSampleSite());
  }

  private async registerSite(handle: FileSystemDirectoryHandle) {
    const config = await readHugoConfig(handle);
    if (!config) {
      this.error = `"${handle.name}" doesn't look like a Hugo site: no hugo.toml or config.toml at its root.`;
      return;
    }
    const existing = await findExistingSite(this.sites, handle);
    if (existing) return this.selectSite(existing);
    const port = 1313 + this.sites.length;
    const site: SiteRecord = {
      id: crypto.randomUUID(),
      name: config.title || handle.name,
      handle,
      previewOrigin: `http://localhost:${port}`,
    };
    this.sites = [...this.sites, site];
    await saveSites(this.sites);
    await this.selectSite(site);
  }

  private async selectSite(site: SiteRecord, gesture = true) {
    if (!(await this.confirmDiscard())) return;
    this.site = site;
    this.open = undefined;
    this.postGeneration++;
    this.sectionFilter = "*";
    this.connection?.close();
    this.connection = undefined;
    this.text = "";
    this.posts = [];
    this.config = undefined;
    this.error = "";
    localStorage.setItem(LAST_SITE_KEY, site.id);
    const granted = gesture ? await requestPermission(site.handle) : await hasPermission(site.handle);
    this.needsPermission = !granted;
    if (granted) await this.loadSite();
  }

  private async reconnect() {
    if (!this.site) return;
    this.needsPermission = !(await requestPermission(this.site.handle));
    if (!this.needsPermission) await this.loadSite();
  }

  private async loadSite() {
    const site = this.site;
    if (!site) return;
    const generation = ++this.siteGeneration;
    this.loading = true;
    try {
      const config = await readHugoConfig(site.handle);
      if (!config) throw new Error("No Hugo config found in this folder any more.");
      const [posts, shortcodes] = await Promise.all([listPosts(site.handle, config), listShortcodes(site.handle, config)]);
      if (generation !== this.siteGeneration) return;
      this.config = config;
      this.posts = posts;
      this.shortcodes = shortcodes;
      const rules = await Promise.all(SITE_RULE_FILES.map((f) => readText(site.handle, f)));
      if (generation !== this.siteGeneration) return;
      this.siteInstructions = rules.filter(Boolean).join("\n\n");
      void this.connectAgentServer();
    } catch (e) {
      if (generation === this.siteGeneration) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (generation === this.siteGeneration) this.loading = false;
    }
  }

  private async updateSite(patch: Partial<SiteRecord>) {
    if (!this.site) return;
    const updated = { ...this.site, ...patch };
    this.sites = this.sites.map((s) => (s.id === updated.id ? updated : s));
    this.site = updated;
    await saveSites(this.sites);
  }

  private async removeSite() {
    if (!this.site || !(await this.confirmDiscard())) return;
    if (!confirm(`Remove "${this.site.name}" from the editor? Files on disk are not touched.`)) return;
    this.sites = this.sites.filter((s) => s.id !== this.site!.id);
    await saveSites(this.sites);
    this.settingsDialog?.close();
    this.site = undefined;
    this.open = undefined;
    this.text = "";
    this.posts = [];
    this.siteGeneration++;
    this.postGeneration++;
    if (this.sites[0]) await this.selectSite(this.sites[0]);
  }

  // ---- Posts ---------------------------------------------------------------

  private async confirmDiscard(): Promise<boolean> {
    commitFocusedField();
    return !this.dirty || confirm("You have unsaved changes. Discard them?");
  }

  private async openPost(requested: PostSummary, force = false) {
    const { site, config } = this;
    if (!site) return;
    if (!force && !(await this.confirmDiscard())) return;
    const generation = ++this.postGeneration;
    try {
      const handle = await getFile(site.handle, requested.path);
      if (!handle) throw new Error(`${requested.path} no longer exists`);
      const file = await handle.getFile();
      const text = await file.text();
      if (generation !== this.postGeneration || site !== this.site) return;
      const post = Post.parse(text);
      // The file may have changed since the list was built: refresh its title, URL and draft state.
      const summary = config ? summarise(requested.path, config, post, file.lastModified) : requested;
      this.posts = sortPosts(this.posts.map((p) => (p.path === summary.path ? summary : p)));
      const switching = this.open?.summary.path !== summary.path;
      this.open = { summary, post, savedText: text, lastModified: file.lastModified };
      this.loadCount++;
      this.text = text;
      if (switching || !this.connection) this.openConnection();
      this.changedOnDisk = false;
      this.error = "";
    } catch (e) {
      if (generation === this.postGeneration) this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private onBodyChange(e: CustomEvent<{ value: string }>) {
    if (!this.open) return;
    this.open.post.body = e.detail.value;
    this.text = this.open.post.toString();
  }

  private onFieldChange(e: CustomEvent<{ key: string; value: unknown }>) {
    if (!this.open) return;
    this.open.post.set(e.detail.key, e.detail.value);
    this.text = this.open.post.toString();
    this.requestUpdate();
  }

  private onRawChange(e: CustomEvent<{ raw: string; onError: (m: string) => void; onOk: () => void }>) {
    if (!this.open) return;
    try {
      this.open.post.setRawFrontMatter(e.detail.raw);
      this.text = this.open.post.toString();
      e.detail.onOk();
      this.requestUpdate();
    } catch (err) {
      e.detail.onError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Saves run one at a time, so two quick saves can't interleave their writes. */
  private save() {
    commitFocusedField();
    this.saving = this.saving.then(() => this.saveNow());
    return this.saving;
  }

  private async saveNow() {
    // Capture what is being saved: the user can keep typing, or switch post or site, while the write is pending.
    const { open, site, config } = this;
    const text = this.text;
    if (!open || !site || !config || text === open.savedText) return;
    const { path } = open.summary;
    try {
      const onDisk = await (await getFile(site.handle, path))?.getFile();
      if (onDisk && (await onDisk.text()) !== open.savedText && !confirm(`${path} changed on disk since you opened it. Overwrite?`)) {
        return;
      }
      const file = await writeFile(site.handle, path, text);
      const updated = summarise(path, config, Post.parse(text), file.lastModified);
      if (site === this.site) this.posts = sortPosts(this.posts.map((p) => (p.path === path ? updated : p)));
      if (this.open?.summary.path !== path || site !== this.site) return;
      // Only what was written counts as saved; edits made during the write stay unsaved.
      open.savedText = text;
      open.lastModified = file.lastModified;
      open.summary = updated;
      this.open = { ...open };
      this.changedOnDisk = false;
      this.flash(`Saved ${path}`);
    } catch (e) {
      this.error = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async createPost(e: SubmitEvent) {
    e.preventDefault();
    if (!this.site || !this.config) return;
    const form = new FormData(e.target as HTMLFormElement);
    const title = String(form.get("title") ?? "").trim();
    const section = String(form.get("section") ?? "");
    if (!title || !(await this.confirmDiscard())) return;
    const { path, post } = newPostFromTemplate(this.posts, this.config, section, title);
    if (await exists(this.site.handle, path)) {
      this.error = `${path} already exists`;
      return;
    }
    const file = await writeFile(this.site.handle, path, post.toString());
    const summary = summarise(path, this.config, post, file.lastModified);
    this.posts = sortPosts([summary, ...this.posts]);
    this.newPostDialog?.close();
    await this.openPost(summary, true);
    this.flash(`Created ${path}`);
  }

  /** Saves dropped/pasted images under static/images/<post slug>/ and inserts a reference. */
  private async onImageFiles(e: CustomEvent<{ files: File[] }>) {
    const { open, site } = this;
    if (!open || !site) return;
    const slug = String(open.post.get("slug") || "") || open.summary.contentPath.split("/").pop()!.replace(/\.[^.]+$/, "");
    const dir = `images/${slugify(slug)}`;
    const snippets: string[] = [];
    for (const file of e.detail.files) {
      const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? `.${file.type.split("/")[1] ?? "png"}`).toLowerCase();
      const base = slugify(file.name.replace(/\.[^.]+$/, "")) || "image";
      // Pasted screenshots all arrive as image.png: never overwrite an existing file.
      let url = `/${dir}/${base}${ext}`;
      for (let n = 2; await exists(site.handle, `static${url}`); n++) url = `/${dir}/${base}-${n}${ext}`;
      await writeFile(site.handle, `static${url}`, file);
      snippets.push(
        this.shortcodes.includes("figure") ? `{{< figure src="${url}" alt="" caption="" >}}` : `![](${url})`,
      );
    }
    if (this.open?.summary.path !== open.summary.path || this.site !== site) {
      this.flash(`Saved ${snippets.length} image(s) to static/${dir}/ (not inserted: another post is open now)`);
      return;
    }
    this.editor?.insert(snippets.join("\n\n"));
    this.flash(`Saved ${snippets.length} image${snippets.length === 1 ? "" : "s"} to static/${dir}/`);
  }

  private insertShortcode(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (select.value) this.editor?.insert(`{{< ${select.value} >}}`);
    select.value = "";
  }

  private togglePreview() {
    this.showPreview = !this.showPreview;
    localStorage.setItem(PREVIEW_KEY, String(this.showPreview));
  }

  private flash(message: string) {
    this.message = message;
    setTimeout(() => this.message === message && (this.message = ""), 3000);
  }

  /** Ctrl/⌘+S anywhere in the app, not only in the editor (focus may be on a button, or nowhere). */
  private onKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void this.save();
    }
  };

  // ---- Assistant -------------------------------------------------------------

  /** Loads the model list and brings the site's search index up to date. */
  private async connectAgentServer() {
    try {
      const config = await fetchAgentConfig(this.agentSettings);
      this.models = config.models;
      this.agentError = config.models.length ? "" : "The agent server has no model API keys configured.";
      const saved = this.agentSettings.model;
      if (!saved || !this.models.some((m) => `${m.provider}/${m.modelId}` === saved)) {
        const first = this.models.find((m) => m.provider === "anthropic") ?? this.models[0];
        if (first) this.setModel(`${first.provider}/${first.modelId}`);
      }
    } catch (e) {
      this.models = [];
      this.agentError = `Agent server unavailable: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    if (!this.site) return;
    try {
      this.indexStatus = "Indexing posts for search…";
      const uploaded = await syncSiteIndex(this.agentSettings, this.site.id, this.site.handle, this.posts);
      this.indexStatus = uploaded ? `Indexed ${uploaded} post${uploaded === 1 ? "" : "s"}` : "";
      if (uploaded) setTimeout(() => (this.indexStatus = ""), 4000);
    } catch (e) {
      this.indexStatus = `Search index not updated: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private setModel(model: string) {
    this.agentSettings = { ...this.agentSettings, model };
    saveAgentSettings(this.agentSettings);
  }

  private updateAgentSettings(patch: Partial<AgentSettings>) {
    this.agentSettings = { ...this.agentSettings, ...patch };
    saveAgentSettings(this.agentSettings);
    this.openConnection();
    void this.connectAgentServer();
  }

  private openConnection() {
    this.connection?.close();
    this.connection = undefined;
    if (!this.open || !this.site) return;
    this.connection = new AgentConnection(this.agentSettings, sessionId(this.site.id, this.open.summary.path));
    this.connection.updatePost(this.postContext()!);
  }

  private postContext(): PostContext | undefined {
    if (!this.open || !this.site) return undefined;
    return {
      siteId: this.site.id,
      siteName: this.site.name,
      siteInstructions: this.siteInstructions,
      path: this.open.summary.path,
      url: this.open.summary.url,
      text: this.text,
    };
  }

  /** Applies an accepted suggestion. Body edits go through the editor so they can be undone. */
  private onApplyEdit(e: CustomEvent<{ edit: Edit; done: (ok: boolean) => void }>) {
    if (!this.open) return e.detail.done(false);
    const { find, replace } = e.detail.edit;
    const at = this.text.indexOf(find);
    if (at === -1 || this.text.indexOf(find, at + 1) !== -1) return e.detail.done(false);
    const bodyStart = this.text.length - this.open.post.body.length;
    if (at >= bodyStart && this.editor?.replaceUnique(find, replace)) return e.detail.done(true);
    const next = this.text.slice(0, at) + replace + this.text.slice(at + find.length);
    try {
      this.open.post = Post.parse(next);
      this.text = next;
      this.requestUpdate();
      e.detail.done(true);
    } catch {
      e.detail.done(false);
    }
  }

  private setSideTab(tab: "preview" | "assistant") {
    this.sideTab = tab;
    localStorage.setItem(TAB_KEY, tab);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("text") && this.connection && this.open) this.connection.updatePost(this.postContext()!);
  }

  // ---- Rendering -------------------------------------------------------------

  private get visiblePosts(): PostSummary[] {
    const q = this.filter.toLowerCase();
    return this.posts.filter(
      (p) =>
        (this.sectionFilter === "*" || p.section === this.sectionFilter) &&
        (!this.draftsOnly || p.draft) &&
        (!q || p.title.toLowerCase().includes(q) || p.contentPath.toLowerCase().includes(q)),
    );
  }

  private renderTop() {
    return html`<div class="top">
      <h1>Hugo Editor</h1>
      ${this.sites.length
        ? html`<select
            aria-label="Site"
            @change=${(e: Event) => this.selectSite(this.sites.find((s) => s.id === (e.target as HTMLSelectElement).value)!)}
          >
            ${this.sites.map((s) => html`<option value=${s.id} ?selected=${s.id === this.site?.id}>${s.name}</option>`)}
          </select>
          <button class="ghost" ?disabled=${!this.site} @click=${() => this.settingsDialog?.showModal()}>Settings</button>`
        : nothing}
      ${this.supportsPicker ? html`<button @click=${this.addSite}>Add site folder…</button>` : nothing}
      <span class="spacer"></span>
      ${this.open ? html`<button @click=${this.togglePreview} aria-pressed=${this.showPreview}>Side panel</button>` : nothing}
      <button class="primary" ?disabled=${!this.dirty} @click=${this.save} title="Save (Ctrl/⌘+S)">Save</button>
    </div>`;
  }

  private renderEmpty() {
    if (this.site && this.needsPermission) {
      return html`<div class="empty">
        <h2>Reconnect to ${this.site.name}</h2>
        <p>The browser needs your OK again before the editor can read and write <code>${this.site.handle.name}</code>. Choose "Allow on every visit" to skip this next time.</p>
        <div class="actions"><button class="primary" @click=${this.reconnect}>Allow access</button></div>
      </div>`;
    }
    if (!this.site) {
      return html`<div class="empty">
        <h2>Open a Hugo site</h2>
        ${this.supportsPicker
          ? html`<p>Pick the root folder of a Hugo site (the one with <code>hugo.toml</code> or <code>config.toml</code>). The editor reads and writes files there directly and remembers the folder for next time.</p>`
          : html`<p>This browser can't open local folders (it needs the File System Access API, available in Chrome and Edge). You can still try the editor with a sample site stored in the browser.</p>`}
        <div class="actions">
          ${this.supportsPicker ? html`<button class="primary" @click=${this.addSite}>Add site folder…</button>` : nothing}
          <button @click=${this.addSampleSite}>Try a sample site</button>
        </div>
      </div>`;
    }
    return html`<div class="empty">
      <h2>${this.loading ? "Loading posts…" : "Pick a post"}</h2>
      ${this.loading ? nothing : html`<p>Choose a post on the left, or start a new one.</p>`}
    </div>`;
  }

  private renderSidebar() {
    const posts = this.visiblePosts;
    const secs = sections(this.posts);
    return html`<aside>
      <div class="filters">
        <div class="row">
          <input type="search" placeholder="Filter posts" aria-label="Filter posts" .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
          <button class="primary" ?disabled=${!this.config} @click=${() => this.newPostDialog?.showModal()}>New</button>
        </div>
        <div class="row">
          ${secs.length > 1
            ? html`<select aria-label="Section" @change=${(e: Event) => (this.sectionFilter = (e.target as HTMLSelectElement).value)}>
                <option value="*">All sections</option>
                ${secs.map((s) => html`<option value=${s}>${s || "(root)"}</option>`)}
              </select>`
            : nothing}
          <label class="muted"><input type="checkbox" .checked=${this.draftsOnly} @change=${(e: Event) => (this.draftsOnly = (e.target as HTMLInputElement).checked)} /> Drafts only</label>
        </div>
        <span class="muted">${this.loading ? "Loading…" : `${posts.length} of ${this.posts.length} posts`}</span>
      </div>
      <ul>
        ${posts.map(
          (p) => html`<li>
            <button aria-current=${p.path === this.open?.summary.path} @click=${() => this.openPost(p)}>
              <span class="title">${p.title}${p.draft ? html`<span class="badge">draft</span>` : nothing}</span>
              <span class="meta">${p.date ? p.date.toISOString().slice(0, 10) : "no date"} · ${p.url}</span>
            </button>
          </li>`,
        )}
      </ul>
    </aside>`;
  }

  private renderEditor() {
    if (!this.open) return html`<main>${this.renderEmpty()}</main>`;
    const { post, summary } = this.open;
    return html`<main>
      ${this.changedOnDisk
        ? html`<div class="banner" role="alert">
            This file changed on disk while you were editing.
            <button @click=${() => this.openPost(summary, true)}>Load disk version</button>
            <button class="ghost" @click=${() => (this.changedOnDisk = false)}>Keep mine</button>
          </div>`
        : nothing}
      ${keyed(
        `${summary.path}#${this.loadCount}`,
        html`<frontmatter-form
          .data=${post.frontMatter}
          .raw=${post.rawFrontMatter}
          .format=${post.format}
          @field-change=${this.onFieldChange}
          @raw-change=${this.onRawChange}
        ></frontmatter-form>`,
      )}
      <div class="toolbar">
        <span class="path" title=${summary.path}>${summary.path}</span>
        ${this.shortcodes.length
          ? html`<select aria-label="Insert shortcode" @change=${this.insertShortcode}>
              <option value="">Insert shortcode…</option>
              ${this.shortcodes.map((s) => html`<option value=${s}>${s}</option>`)}
            </select>`
          : nothing}
      </div>
      <md-editor .value=${post.body} @change=${this.onBodyChange} @image-files=${this.onImageFiles}></md-editor>
    </main>`;
  }

  private renderDialogs() {
    const secs = sections(this.posts);
    return html`
      <dialog id="new-post" @close=${(e: Event) => ((e.target as HTMLDialogElement).querySelector("form") as HTMLFormElement)?.reset()}>
        <form @submit=${this.createPost}>
          <h3>New post</h3>
          <label>Title <input name="title" required autofocus /></label>
          ${secs.length > 1
            ? html`<label>Section
                <select name="section">${secs.map((s) => html`<option value=${s}>${s || "(root)"}</option>`)}</select>
              </label>`
            : html`<input type="hidden" name="section" value=${secs[0] ?? ""} />`}
          <p class="muted">Front matter is copied from the most recent post in that section. The post starts as a draft.</p>
          <div class="actions">
            <button type="button" @click=${() => this.newPostDialog?.close()}>Cancel</button>
            <button class="primary" type="submit">Create</button>
          </div>
        </form>
      </dialog>
      <dialog id="site-settings">
        ${this.site
          ? html`<form method="dialog">
              <h3>Site settings</h3>
              <label>Name <input .value=${this.site.name} @change=${(e: Event) => this.updateSite({ name: (e.target as HTMLInputElement).value })} /></label>
              <label>Preview server
                <input .value=${this.site.previewOrigin} @change=${(e: Event) => this.updateSite({ previewOrigin: (e.target as HTMLInputElement).value.replace(/\/$/, "") })} />
              </label>
              <h4>Assistant</h4>
              <label>Agent server <input placeholder="This site" .value=${this.agentSettings.server} @change=${(e: Event) => this.updateAgentSettings({ server: (e.target as HTMLInputElement).value.trim().replace(/\/$/, "") })} /></label>
              <label>Access token <input type="password" autocomplete="off" .value=${this.agentSettings.token} @change=${(e: Event) => this.updateAgentSettings({ token: (e.target as HTMLInputElement).value.trim() })} /></label>
              <p class="muted">Writing rules sent to the assistant: ${this.siteInstructions ? SITE_RULE_FILES.join(" / ") + " from the site folder" : html`none (add a <code>CLAUDE.md</code> or <code>AGENTS.md</code> to the site root)`}.</p>
              <p class="muted">Folder: <code>${this.site.handle.name}</code>${this.config ? html` · config: <code>${this.config.file}</code> · content: <code>${this.config.contentDir}/</code>` : nothing}</p>
              <div class="actions">
                <button type="button" class="left" @click=${this.removeSite}>Remove site</button>
                <button type="button" @click=${() => this.loadSite()}>Rescan</button>
                <button class="primary">Done</button>
              </div>
            </form>`
          : nothing}
      </dialog>
    `;
  }

  private renderSide() {
    return html`<section class="side">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected=${this.sideTab === "preview"} @click=${() => this.setSideTab("preview")}>Preview</button>
        <button role="tab" aria-selected=${this.sideTab === "assistant"} @click=${() => this.setSideTab("assistant")}>Assistant</button>
      </div>
      ${this.sideTab === "preview"
        ? html`<preview-pane
            .origin=${this.site!.previewOrigin}
            .path=${this.open!.summary.url}
            .draft=${this.open!.summary.draft}
            @origin-change=${(e: CustomEvent<{ origin: string }>) => this.updateSite({ previewOrigin: e.detail.origin })}
          ></preview-pane>`
        : html`<agent-panel
            .connection=${this.connection}
            .models=${this.models}
            .model=${this.agentSettings.model ?? ""}
            .configError=${this.agentError}
            @model-change=${(e: CustomEvent<string>) => this.setModel(e.detail)}
            @apply-edit=${this.onApplyEdit}
          ></agent-panel>`}
    </section>`;
  }

  private renderStatus() {
    const words = this.open ? (this.open.post.body.match(/[\p{L}\p{N}’']+/gu) ?? []).length : 0;
    return html`<div class="status" role="status">
      ${this.open ? html`<span class=${this.dirty ? "dirty" : ""}>${this.dirty ? "Unsaved changes" : "Saved"}</span>
          <span>${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read</span>` : nothing}
      ${this.error ? html`<span class="error">${this.error}</span>` : nothing}
      ${this.message ? html`<span>${this.message}</span>` : nothing}
      ${this.indexStatus ? html`<span>${this.indexStatus}</span>` : nothing}
    </div>`;
  }

  render() {
    const ready = !!this.site && !this.needsPermission;
    const preview = ready && this.open && this.showPreview;
    return html`
      ${this.renderTop()}
      <div class="body ${!ready ? "solo" : preview ? "" : "no-preview"}">
        ${ready ? this.renderSidebar() : nothing}
        ${ready ? this.renderEditor() : html`<main>${this.renderEmpty()}</main>`}
        ${preview ? this.renderSide() : nothing}
      </div>
      ${this.renderStatus()} ${this.renderDialogs()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "md-app": MdApp;
  }
}

/**
 * Text fields in the front matter form commit on `change`, which fires on
 * blur. Blurring the focused field first makes Save and the discard check see
 * an edit that is still being typed.
 */
function commitFocusedField() {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  const host = el?.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : undefined;
  if (host?.localName === "frontmatter-form" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) el.blur();
}
