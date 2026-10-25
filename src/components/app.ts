import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { customElement, query, state } from "lit/decorators.js";
import { Post } from "../lib/frontmatter";
import { readHugoConfig, listShortcodes, isContentFile, type HugoConfig } from "../lib/hugo";
import { getFile, writeFile, exists, readText } from "../lib/fs";
import { listNotes, listPosts, newNote, newPostFromTemplate, sections, summarise, sortPosts, type PostSummary } from "../lib/posts";
import { isNotePath, NOTES_DIR } from "../shared/notes";
import { findExistingSite, hasPermission, loadSites, requestPermission, saveSites, type SiteRecord } from "../lib/sites";
import { createSampleSite } from "../lib/sample-site";
import { slugify } from "../lib/slug";
import { AgentConnection, fetchAgentConfig, loadAgentSettings, saveAgentSettings, sessionId, type AgentLink, type AgentSettings } from "../lib/agent-client";
import { syncSiteIndex } from "../lib/indexer";
import { BUILTIN_ACTIONS, loadCustomActions, type ActionScope } from "../lib/actions";
import { canSummarize, isOnDevice, OnDeviceConnection, onDeviceModels, summarizePost } from "../lib/on-device";
import { watchFolder, type FolderChanges } from "../lib/file-watcher";
import { registerEditorTools, type EditorToolHost } from "../lib/webmcp";
import { applyDictionary, canUseDictionary, parseWordList, siteWords } from "../lib/spelling";
import { listenForLaunches, persistStorage, registerServiceWorker, type Launch } from "../lib/pwa";
import type { Edit, ModelInfo, PostContext, SiteContext } from "../shared/protocol";
import { controls, lightDismiss } from "./shared";
import { icon, type IconName } from "./icons";
import { getTheme, setTheme, watchTheme, type Theme } from "../lib/theme";
import type { MdEditor } from "./md-editor";
import { BUILTIN_SKILLS } from "../shared/builtin-skills";
import { mergeSkills, type Skill } from "../shared/skills";
import { loadSiteSkills } from "../lib/site-skills";
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
const SCOPE_KEY = "md-editor:assistant-scope";
const SPELLCHECK_KEY = "md-editor:spellcheck";
const SITE_RULE_FILES = ["CLAUDE.md", "AGENTS.md"];
/** Below this width the app shows one pane at a time, switched from a bottom bar. */
const NARROW = matchMedia("(max-width: 900px)");
type MobileView = "posts" | "write" | "preview" | "assistant";
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

@customElement("md-app")
export class MdApp extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: grid; grid-template-rows: auto 1fr auto; height: 100vh; height: 100dvh; }
      .top { display: flex; align-items: center; gap: 6px; padding: 0 10px; min-height: 44px; border-bottom: 1px solid var(--border); background: var(--bg-2); }
      .brand { display: flex; align-items: center; gap: 8px; margin-right: 6px; font-size: 13px; font-weight: 600; letter-spacing: -0.01em; }
      .brand img { width: 20px; height: 20px; border-radius: 5px; }
      .top select.site { font-weight: 500; background: transparent; border-color: transparent; }
      .top select.site:hover { background: var(--hover); }
      .top .spacer { flex: 1; }
      .top .divider { width: 1px; height: 18px; background: var(--border); margin: 0 4px; }
      /* Installed with window controls overlay: the top bar becomes the title bar. */
      @media (display-mode: window-controls-overlay) {
        .top {
          app-region: drag;
          min-height: env(titlebar-area-height, 33px);
          padding-block: 0;
          padding-left: calc(env(titlebar-area-x, 0px) + 12px);
          padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px);
        }
        .top > :not(.brand, .spacer, .divider) { app-region: no-drag; }
      }
      .body { display: grid; grid-template-columns: 280px minmax(0, 1fr) var(--preview-width, minmax(0, 1fr)); min-height: 0; }
      .body.no-preview { grid-template-columns: 280px minmax(0, 1fr); }
      .body.solo { grid-template-columns: minmax(0, 1fr); }
      aside { border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; background: var(--bg-2); }
      .filters { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
      .filters .row { display: flex; gap: 6px; align-items: center; }
      .search { position: relative; flex: 1; display: flex; min-width: 0; }
      .search .icon { position: absolute; left: 8px; top: 50%; translate: 0 -50%; color: var(--fg-2); pointer-events: none; }
      .search input { flex: 1; padding-left: 28px; }
      .filters select { flex: 1; font-size: 13px; }
      .filters > .seg { align-self: flex-start; }
      .filters .hint { margin: 0; font-size: 12px; line-height: 1.45; }
      .filters label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; white-space: nowrap; }
      .count { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg-2); padding: 4px 16px 6px; }
      ul { list-style: none; margin: 0; padding: 0 6px 8px; overflow-y: auto; flex: 1; }
      li button { all: unset; box-sizing: border-box; display: block; width: 100%; padding: 7px 10px; margin-bottom: 1px; border-radius: var(--radius); cursor: pointer; content-visibility: auto; contain-intrinsic-size: auto 50px; transition: background-color 100ms var(--ease); }
      li button:hover { background: var(--hover); }
      li button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
      li button[aria-current="true"] { background: var(--selected); }
      li button[aria-current="true"] .title { color: var(--accent); }
      .title { display: flex; align-items: center; gap: 6px; font-weight: 500; line-height: 1.35; }
      .title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .meta { display: block; margin-top: 2px; font-size: 12px; color: var(--fg-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .badge { flex: none; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
      main { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
      .toolbar { display: flex; gap: 6px; align-items: center; padding: 6px 12px; min-height: 40px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
      .toolbar .path { display: flex; align-items: center; gap: 6px; font-family: var(--mono); font-size: 12px; color: var(--fg-2); flex: 1; min-width: 0; }
      .toolbar .path span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
      .toolbar select { font-size: 13px; }
      md-editor { flex: 1; }
      .side { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-left: 1px solid var(--border); background: var(--bg-2); }
      .side > preview-pane, .side > agent-panel { flex: 1; }
      .tabs { display: flex; align-items: center; padding: 8px 10px; border-bottom: 1px solid var(--border); }
      .status { display: flex; align-items: center; gap: 14px; padding: 0 12px; min-height: 26px; font-size: 12px; color: var(--fg-2); border-top: 1px solid var(--border); background: var(--bg-2); white-space: nowrap; overflow: hidden; }
      .status > span { display: inline-flex; align-items: center; gap: 6px; }
      .status .dot { width: 6px; height: 6px; background: var(--ok); }
      .status .dirty .dot { background: var(--warn); }
      .status .dirty { color: var(--fg); }
      .status .error { color: var(--danger); overflow: hidden; text-overflow: ellipsis; }
      .status .end { margin-left: auto; }
      .banner { padding: 8px 12px; font-size: 13px; background: color-mix(in srgb, var(--warn) 12%, var(--bg)); border-bottom: 1px solid color-mix(in srgb, var(--warn) 30%, transparent); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .empty { display: grid; justify-items: center; text-align: center; padding: 32px; gap: 12px; color: var(--fg-2); max-width: 34em; margin: auto; line-height: 1.6; }
      .empty .art { width: 56px; height: 56px; border-radius: 14px; display: grid; place-items: center; background: var(--bg-3); color: var(--fg-2); margin-bottom: 4px; }
      .empty .art .icon { width: 26px; height: 26px; }
      .empty h2 { color: var(--fg); margin: 0; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
      .empty p { margin: 0; }
      .empty .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin-top: 8px; }
      .empty kbd { font-family: var(--font); font-size: 11px; padding: 1px 5px; border: 1px solid var(--border); border-bottom-width: 2px; border-radius: 4px; background: var(--bg-2); }
      dialog { width: min(440px, 92vw); }
      dialog form { display: grid; gap: 12px; }
      dialog .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 6px; }
      dialog .actions .left { margin-right: auto; }
      dialog .seg { justify-self: start; }
      .views { display: none; }
      @media (max-width: 900px) {
        :host { grid-template-rows: auto 1fr auto auto; --control-h: 36px; }
        .top { padding-top: env(safe-area-inset-top, 0px); padding-inline: max(8px, env(safe-area-inset-left, 0px)) max(8px, env(safe-area-inset-right, 0px)); }
        .brand { margin-right: 0; }
        .brand span { display: none; }
        .top select.site { min-width: 0; flex: 0 1 auto; }
        .body, .body.no-preview, .body.solo { grid-template-columns: minmax(0, 1fr); }
        aside { border-right: 0; }
        li button { padding: 10px 12px; }
        .side { border-left: 0; }
        .toolbar { padding: 4px 8px 4px 12px; }
        .status { min-height: 22px; font-size: 11px; }
        .views {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          border-top: 1px solid var(--border);
          background: var(--bg-2);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .views button {
          all: unset;
          display: grid;
          justify-items: center;
          gap: 2px;
          padding: 8px 0 6px;
          font-size: 11px;
          font-weight: 500;
          color: var(--fg-2);
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }
        .views button .icon { width: 20px; height: 20px; }
        .views button:hover:not(:disabled) { background: transparent; color: var(--fg); }
        .views button[aria-current="page"] { color: var(--accent); }
        .views button:disabled { opacity: 0.4; cursor: default; }
        .views button:focus-visible { outline: 2px solid var(--accent); outline-offset: -4px; border-radius: var(--radius); }
      }
    `,
  ];

  @state() private sites: SiteRecord[] = [];
  @state() private site?: SiteRecord;
  @state() private needsPermission = false;
  @state() private config?: HugoConfig;
  @state() private shortcodes: string[] = [];
  @state() private posts: PostSummary[] = [];
  /** Research notes and ideas under notes/ (see shared/notes.ts). */
  @state() private notes: PostSummary[] = [];
  @state() private listing: "posts" | "notes" = "posts";
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
  @state() private theme: Theme = getTheme();
  @state() private narrow = NARROW.matches;
  @state() private mobileView: MobileView = "posts";
  @state() private agentSettings: AgentSettings = loadAgentSettings();
  @state() private models: ModelInfo[] = [];
  @state() private agentError = "";
  @state() private connection?: AgentLink;
  /** The site-wide assistant for the current site; opened when first shown. */
  @state() private siteConnection?: AgentConnection;
  @state() private assistantScope: ActionScope = localStorage.getItem(SCOPE_KEY) === "site" ? "site" : "post";
  @state() private indexStatus = "";
  @state() private checkSpelling = localStorage.getItem(SPELLCHECK_KEY) !== "false";
  /** Set when a new version of the app is installed and waiting; calling it switches and reloads. */
  @state() private applyUpdate?: () => void;
  /** A file the app was opened with that isn't inside any added site. */
  @state() private orphanFile?: FileSystemFileHandle;
  /** Text shared to the app, waiting to become a new post. */
  @state() private shared?: { title: string; text: string };
  /** A launch to act on once the site it needs has loaded. */
  private pendingLaunch?: { siteId?: string; path?: string; share?: Launch["share"]; action?: string };
  private siteInstructions = "";
  /** Skills from the site folder (.agents/skills, .claude/skills), sent to the assistant with the post. */
  @state() private siteSkills: Skill[] = [];
  private stopWatching?: () => void;
  private unregisterTools?: () => void;
  /** Writes in flight. Watcher events for the editor's own saves are ignored while one runs. */
  private writing = 0;
  @state() private agentServerUp = false;

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
    NARROW.addEventListener("change", this.onNarrowChange);
    this.unregisterTools = registerEditorTools(this.toolHost);
    watchTheme((theme) => (this.theme = theme));
    void registerServiceWorker((apply) => (this.applyUpdate = apply));
    this.sites = await loadSites();
    listenForLaunches((launch) => void this.onLaunch(launch));
    const last = this.sites.find((s) => s.id === localStorage.getItem(LAST_SITE_KEY)) ?? this.sites[0];
    if (last) await this.selectSite(last, false);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("beforeunload", this.onBeforeUnload);
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("keydown", this.onKeydown);
    NARROW.removeEventListener("change", this.onNarrowChange);
    this.unregisterTools?.();
    this.stopWatching?.();
  }

  private onNarrowChange = () => (this.narrow = NARROW.matches);

  private onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (this.dirty) e.preventDefault();
  };

  /** On focus, catches up with edits made outside the editor when the browser can't watch the folder. */
  private onFocus = () => void this.checkOpenPost();

  /** Picks up edits made outside the editor (another app, git checkout, an agent). */
  private async checkOpenPost() {
    const { open, site } = this;
    if (!open || !site || this.needsPermission || this.writing) return;
    const file = await (await getFile(site.handle, open.summary.path))?.getFile();
    if (!file) {
      if (this.open === open) this.error = `${open.summary.path} was moved or deleted on disk. Save to write it back.`;
      return;
    }
    // Compare contents, not times: a checkout or sync tool can keep or rewind modification times.
    const text = await file.text();
    if (text === open.savedText || text === this.text || this.open !== open || this.writing) return;
    // A front matter field being typed in hasn't reached `text` yet, so it counts as unsaved.
    if (this.dirty || focusedFrontMatterField()) {
      this.changedOnDisk = true;
    } else {
      await this.openPost(this.open.summary, true);
      this.flash("Reloaded: the file changed on disk");
    }
  }

  // ---- Watching the folder ---------------------------------------------------

  private async watch(site: SiteRecord) {
    this.stopWatching?.();
    this.stopWatching = undefined;
    // Settings edits replace the site record, so match it by id rather than by object.
    const stop = await watchFolder(site.handle, (changes) => void this.onFolderChange(site.id, changes));
    if (site.id === this.site?.id) this.stopWatching = stop;
    else stop?.();
  }

  private async onFolderChange(siteId: string, changes: FolderChanges) {
    const { config, site } = this;
    if (!site || site.id !== siteId || !config || this.needsPermission) return;
    const inContent = (p: string) => p.startsWith(`${config.contentDir}/`);
    // A moved or deleted folder can hold many posts: re-list everything rather than guess what was inside.
    const rescan = changes.rescan || [...changes.dirs].some((d) => inContent(d) || config.contentDir.startsWith(`${d}/`) || d === config.contentDir);
    if (rescan) {
      const posts = await listPosts(site.handle, config);
      if (site.id !== this.site?.id) return;
      this.posts = posts;
    } else {
      const changed = [...changes.paths].filter((p) => inContent(p) && isContentFile(p));
      if (changed.length) await this.refreshPosts(site, config, changed);
    }
    if (changes.rescan || [...changes.paths, ...changes.dirs].some((p) => isNotePath(p) || p === NOTES_DIR)) {
      const notes = await listNotes(site.handle, config);
      if (site.id !== this.site?.id) return;
      this.notes = notes;
    }
    const openPath = this.open?.summary.path;
    if (rescan || (openPath && [...changes.paths].some((p) => openPath === p || openPath.startsWith(`${p}/`)))) await this.checkOpenPost();
    if (this.agentServerUp && (rescan || [...changes.paths].some((p) => p.startsWith(config.contentDir) || isNotePath(p)))) void this.syncIndex();
  }

  /** Re-reads the given content files, adding, updating or dropping them in the post list. */
  private async refreshPosts(site: SiteRecord, config: HugoConfig, paths: string[]) {
    const updates = await Promise.all(
      paths.map(async (path) => {
        try {
          const file = await (await getFile(site.handle, path))?.getFile();
          return { path, summary: file ? summarise(path, config, Post.parse(await file.text()), file.lastModified) : undefined };
        } catch {
          return { path, summary: undefined };
        }
      }),
    );
    if (site.id !== this.site?.id) return;
    const byPath = new Map(this.posts.map((p) => [p.path, p]));
    for (const { path, summary } of updates) {
      if (summary) byPath.set(path, summary);
      // Keep the open post in the list even if it vanished: its text is still in the editor.
      else if (path !== this.open?.summary.path) byPath.delete(path);
    }
    this.posts = sortPosts([...byPath.values()]);
  }

  // ---- Sites ---------------------------------------------------------------

  private async addSite(startIn?: FileSystemHandle) {
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({ id: "hugo-site", mode: "readwrite", startIn });
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
    void persistStorage();
    await this.selectSite(site);
  }

  private async selectSite(site: SiteRecord, gesture = true) {
    if (!(await this.confirmDiscard())) return;
    this.site = site;
    this.open = undefined;
    this.postGeneration++;
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.sectionFilter = "*";
    this.connection?.close();
    this.connection = undefined;
    this.closeSiteConnection();
    this.text = "";
    this.posts = [];
    this.notes = [];
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
      const [posts, notes, shortcodes] = await Promise.all([listPosts(site.handle, config), listNotes(site.handle, config), listShortcodes(site.handle, config)]);
      if (generation !== this.siteGeneration) return;
      this.config = config;
      this.posts = posts;
      this.notes = notes;
      this.shortcodes = shortcodes;
      const [rules, skills] = await Promise.all([Promise.all(SITE_RULE_FILES.map((f) => readText(site.handle, f))), loadSiteSkills(site.handle)]);
      if (generation !== this.siteGeneration) return;
      this.siteInstructions = rules.filter(Boolean).join("\n\n");
      this.siteSkills = skills;
      void this.watch(site);
      void this.connectAgentServer();
    } catch (e) {
      if (generation === this.siteGeneration) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (generation === this.siteGeneration) this.loading = false;
    }
    if (generation === this.siteGeneration) await this.runPendingLaunch();
  }

  // ---- Launches (installed app) ---------------------------------------------

  /** The app was opened with a file, sent shared text, or started from a shortcut. */
  private async onLaunch(launch: Launch) {
    if (launch.files.length) {
      const file = launch.files[0];
      for (const site of this.sites) {
        const parts = await site.handle.resolve(file);
        if (!parts) continue;
        this.orphanFile = undefined;
        this.pendingLaunch = { siteId: site.id, path: parts.join("/") };
        if (site !== this.site) {
          await this.selectSite(site, false);
          // Switching was cancelled (unsaved changes): drop the launch rather than open it in another site later.
          if (this.site !== site) this.pendingLaunch = undefined;
        } else {
          await this.runPendingLaunch();
        }
        return;
      }
      this.orphanFile = file;
      return;
    }
    this.pendingLaunch = { share: launch.share, action: launch.action };
    await this.runPendingLaunch();
  }

  /** Acts on a launch once a site is loaded and readable; until then it waits (e.g. for "Allow access"). */
  private async runPendingLaunch() {
    const launch = this.pendingLaunch;
    const { site, config } = this;
    if (!launch || !site || !config || this.loading || this.needsPermission) return;
    // A file launch belongs to one site: if the user moved to another before allowing access, it's stale.
    if (launch.siteId && launch.siteId !== site.id) {
      this.pendingLaunch = undefined;
      return;
    }
    this.pendingLaunch = undefined;
    if (launch.path) {
      if (!launch.path.startsWith(`${config.contentDir}/`)) {
        this.error = `${launch.path} isn't a post: it's outside ${config.contentDir}/`;
        return;
      }
      const summary = this.posts.find((p) => p.path === launch.path) ?? ({ path: launch.path } as PostSummary);
      await this.openPost(summary);
    } else if (launch.share || launch.action === "new-post") {
      this.shared = launch.share;
      this.newPostDialog?.showModal();
    }
  }

  private async addOrphanSite() {
    const file = this.orphanFile;
    if (!file) return;
    await this.addSite(file);
    await this.onLaunch({ files: [file] });
  }

  private async installUpdate() {
    if (this.dirty) await this.save();
    if (!this.dirty) this.applyUpdate?.();
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
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.closeSiteConnection();
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
      this.replaceSummary(summary);
      const switching = this.open?.summary.path !== summary.path;
      this.open = { summary, post, savedText: text, lastModified: file.lastModified };
      this.loadCount++;
      this.text = text;
      if (switching || !this.connection) this.openConnection();
      if (switching) this.mobileView = "write";
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
      let file: File;
      this.writing++;
      try {
        file = await writeFile(site.handle, path, text);
      } finally {
        this.writing--;
      }
      const updated = summarise(path, config, Post.parse(text), file.lastModified);
      if (site === this.site) {
        this.replaceSummary(updated);
        void this.syncIndex();
      }
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

  /** Puts a re-read summary into whichever list (posts or notes) holds it. */
  private replaceSummary(summary: PostSummary) {
    if (isNotePath(summary.path)) this.notes = sortPosts(this.notes.map((p) => (p.path === summary.path ? summary : p)));
    else this.posts = sortPosts(this.posts.map((p) => (p.path === summary.path ? summary : p)));
  }

  private async createPost(e: SubmitEvent) {
    e.preventDefault();
    if (!this.site || !this.config) return;
    const form = new FormData(e.target as HTMLFormElement);
    const title = String(form.get("title") ?? "").trim();
    const section = String(form.get("section") ?? "");
    if (!title || !(await this.confirmDiscard())) return;
    const note = this.listing === "notes";
    const { path, post } = note ? newNote(title) : newPostFromTemplate(this.posts, this.config, section, title);
    if (this.shared?.text) post.body = note ? `${post.body}\n${this.shared.text}\n` : `\n${this.shared.text}\n`;
    if (await exists(this.site.handle, path)) {
      this.error = `${path} already exists`;
      return;
    }
    const file = await writeFile(this.site.handle, path, post.toString());
    const summary = summarise(path, this.config, post, file.lastModified);
    if (note) this.notes = sortPosts([summary, ...this.notes]);
    else this.posts = sortPosts([summary, ...this.posts]);
    void this.syncIndex();
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
    const local = await onDeviceModels();
    let server: ModelInfo[] = [];
    let failed = "";
    try {
      server = (await fetchAgentConfig(this.agentSettings)).models;
    } catch (e) {
      failed = `Agent server unavailable: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.agentServerUp = !failed;
    this.models = [...server, ...local];
    this.agentError = this.models.length ? "" : failed || "The agent server has no model API keys configured.";
    if (failed && local.length) this.indexStatus = `${failed}. The on-device model still works.`;
    const saved = this.agentSettings.model;
    if (!saved || !this.models.some((m) => `${m.provider}/${m.modelId}` === saved)) {
      const first = server.find((m) => m.provider === "anthropic") ?? this.models[0];
      if (first) this.setModel(`${first.provider}/${first.modelId}`);
    }
    if (failed) return;
    this.indexStatus = "Indexing posts for search…";
    await this.syncIndex();
  }

  private indexing: Promise<void> = Promise.resolve();

  /** Brings the site's search index up to date. Serialised, so saves in quick succession queue rather than race. */
  private syncIndex(): Promise<void> {
    this.indexing = this.indexing.then(async () => {
      const { site, posts, notes } = this;
      if (!site) return;
      try {
        const uploaded = await syncSiteIndex(this.agentSettings, site.id, site.handle, [...posts, ...notes]);
        this.indexStatus = uploaded > 1 ? `Indexed ${uploaded} posts` : "";
        if (uploaded > 1) setTimeout(() => (this.indexStatus = ""), 4000);
      } catch (e) {
        this.indexStatus = `Search index not updated: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
    return this.indexing;
  }

  private setModel(model: string) {
    const switching = isOnDevice(model) !== isOnDevice(this.agentSettings.model);
    this.agentSettings = { ...this.agentSettings, model };
    saveAgentSettings(this.agentSettings);
    // The on-device model has its own conversation, separate from the server's.
    if (switching && this.connection) this.openConnection();
  }

  private updateAgentSettings(patch: Partial<AgentSettings>) {
    this.agentSettings = { ...this.agentSettings, ...patch };
    saveAgentSettings(this.agentSettings);
    this.openConnection();
    this.closeSiteConnection();
    void this.connectAgentServer();
  }

  private openConnection() {
    this.connection?.close();
    this.connection = undefined;
    if (!this.open || !this.site) return;
    const id = sessionId(this.site.id, this.open.summary.path);
    this.connection = isOnDevice(this.agentSettings.model) ? new OnDeviceConnection(id) : new AgentConnection(this.agentSettings, id);
    this.connection.updatePost(this.postContext()!);
  }

  /** The site assistant is shown with no post open, or when picked in the panel. */
  private get scope(): ActionScope {
    return this.open ? this.assistantScope : "site";
  }

  private setScope(scope: ActionScope) {
    this.assistantScope = scope;
    localStorage.setItem(SCOPE_KEY, scope);
  }

  private closeSiteConnection() {
    this.siteConnection?.close();
    this.siteConnection = undefined;
  }

  /** Opens the site assistant's connection the first time it's needed for this site. */
  private ensureSiteConnection(): AgentConnection | undefined {
    const context = this.siteContext();
    if (!context) return undefined;
    if (!this.siteConnection) this.siteConnection = AgentConnection.forSite(this.agentSettings, context.siteId);
    return this.siteConnection;
  }

  private siteContext(): SiteContext | undefined {
    if (!this.site || !this.config || this.needsPermission) return undefined;
    return {
      siteId: this.site.id,
      siteName: this.site.name,
      siteInstructions: this.siteInstructions,
      contentDir: this.config.contentDir,
      sections: sections(this.posts),
      ...(this.open ? { openPath: this.open.summary.path } : {}),
      skills: this.siteSkills,
    };
  }

  /** The site assistant only runs on the agent server: it needs the site index. */
  private get siteModels(): ModelInfo[] {
    return this.models.filter((m) => !isOnDevice(`${m.provider}/${m.modelId}`));
  }

  private get siteModel(): string {
    const saved = this.agentSettings.model ?? "";
    if (saved && !isOnDevice(saved)) return saved;
    const first = this.siteModels[0];
    return first ? `${first.provider}/${first.modelId}` : "";
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
      shortcodes: this.shortcodes,
      skills: this.siteSkills,
    };
  }

  private onApplyEdit(e: CustomEvent<{ edit: Edit; done: (ok: boolean) => void }>) {
    e.detail.done(this.applyEdit(e.detail.edit));
  }

  private fileWrites: Promise<unknown> = Promise.resolve();

  /**
   * Applies a change the site assistant proposed. Edits to the open post go
   * through the editor (unsaved, undoable) like the post assistant's; other
   * files are written straight to disk. Writes run one at a time, so
   * accepting a batch of edits to one file applies them in turn.
   */
  private onApplyFileChange(e: CustomEvent<{ path: string; edit?: Edit; create?: string; done: (ok: boolean) => void }>) {
    const { path, edit, create, done } = e.detail;
    // Pinned to the site it was proposed for: a queued write must not land in a site switched to meanwhile.
    const site = this.site;
    const run = this.fileWrites.then(() => this.applyFileChange(site, path, edit, create));
    this.fileWrites = run.catch(() => undefined);
    run.then(done, (err) => {
      this.error = `Couldn't change ${path}: ${err instanceof Error ? err.message : String(err)}`;
      done(false);
    });
  }

  private async applyFileChange(site: SiteRecord | undefined, path: string, edit: Edit | undefined, create: string | undefined): Promise<boolean> {
    const { config } = this;
    if (!site || site !== this.site || !config) return false;
    if (create === undefined && path === this.open?.summary.path) return edit ? this.applyEdit(edit) : false;
    let next: string;
    if (create !== undefined) {
      if (await exists(site.handle, path)) return false;
      next = create;
    } else {
      const current = await readText(site.handle, path);
      if (current === undefined || !edit) return false;
      const at = current.indexOf(edit.find);
      if (at === -1 || current.indexOf(edit.find, at + 1) !== -1) return false;
      next = current.slice(0, at) + edit.replace + current.slice(at + edit.find.length);
    }
    if (site !== this.site) return false;
    this.writing++;
    try {
      await writeFile(site.handle, path, next);
    } finally {
      this.writing--;
    }
    if (site !== this.site) return true;
    if (path.startsWith(`${config.contentDir}/`)) await this.refreshPosts(site, config, [path]);
    else if (isNotePath(path)) this.notes = await listNotes(site.handle, config);
    this.scheduleIndexSync();
    this.flash(create !== undefined ? `Created ${path}` : `Updated ${path}`);
    return true;
  }

  private indexTimer?: ReturnType<typeof setTimeout>;

  /** One index sync after a burst of writes, rather than one per accepted edit. */
  private scheduleIndexSync() {
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => this.agentServerUp && void this.syncIndex(), 800);
  }

  private async onOpenPath(e: CustomEvent<string>) {
    const summary = [...this.posts, ...this.notes].find((p) => p.path === e.detail);
    if (summary) await this.openPost(summary);
    else this.error = `${e.detail} isn't in the post or note list.`;
  }

  /** Applies a find/replace edit. Body edits go through the editor so they can be undone. */
  private applyEdit({ find, replace }: Edit): boolean {
    if (!this.open) return false;
    const at = this.text.indexOf(find);
    if (at === -1 || this.text.indexOf(find, at + 1) !== -1) return false;
    const bodyStart = this.text.length - this.open.post.body.length;
    if (at >= bodyStart && this.editor?.replaceUnique(find, replace)) return true;
    const next = this.text.slice(0, at) + replace + this.text.slice(at + find.length);
    try {
      this.open.post = Post.parse(next);
      this.text = next;
      // Recreate the front matter form so an open raw draft shows the accepted change.
      this.loadCount++;
      this.requestUpdate();
      return true;
    } catch {
      return false;
    }
  }

  // ---- Tools for browser agents (WebMCP) ----------------------------------------

  private readonly toolHost: EditorToolHost = {
    currentPost: () =>
      this.open && { path: this.open.summary.path, url: this.open.summary.url, title: this.open.summary.title, text: this.text, unsaved: this.dirty },
    listPosts: (query, limit) => {
      const q = query.toLowerCase();
      return this.posts
        .filter((p) => !q || p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
        .slice(0, limit)
        .map((p) => ({ path: p.path, title: p.title, url: p.url, date: p.date?.toISOString().slice(0, 10), draft: p.draft }));
    },
    openPost: async (path) => {
      const summary = this.posts.find((p) => p.path === path);
      if (!summary) return `No post at ${path}. Use list_posts for paths.`;
      await this.openPost(summary);
      return this.open?.summary.path === path ? undefined : "The post wasn't opened (the author kept their unsaved changes).";
    },
    insertText: (text) => {
      if (!this.open || !this.editor) return "No post is open.";
      this.editor.insert(text);
      return undefined;
    },
    applyEdits: (edits) => {
      const problems: string[] = [];
      let applied = 0;
      edits.forEach((edit, i) => (this.applyEdit(edit) ? applied++ : problems.push(`Edit ${i + 1}: find text not found exactly once.`)));
      return { applied, problems };
    },
    save: async () => {
      if (!this.open) return "No post is open.";
      commitFocusedField();
      if (!this.dirty) return "Nothing to save.";
      await this.save();
      return this.dirty ? `Not saved${this.error ? `: ${this.error}` : "."}` : `Saved ${this.open.summary.path}.`;
    },
    listEdits: () => postActions().map((a) => ({ name: a.name, instruction: a.prompt })),
    runEdit: (name) => {
      const action = postActions().find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (!action) return `No edit called "${name}". Use list_edits.`;
      const [provider, ...rest] = (this.agentSettings.model ?? "").split("/");
      if (!this.connection || !provider || !rest.length) return "The assistant isn't ready: open a post and pick a model.";
      this.connection.prompt(action.prompt, { provider, modelId: rest.join("/") }, action.name);
      if (!this.showPreview) this.togglePreview();
      this.setSideTab("assistant");
      return `Started "${action.name}". Its suggestions will appear in the Assistant panel for the author to review.`;
    },
  };

  private setSideTab(tab: "preview" | "assistant") {
    this.sideTab = tab;
    if (this.narrow) this.mobileView = tab;
    localStorage.setItem(TAB_KEY, tab);
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("text") && this.connection && this.open) this.connection.updatePost(this.postContext()!);
    // Opened lazily, the first time the site assistant is on screen.
    const assistantShown = this.narrow ? this.mobileView === "assistant" : this.showPreview && this.effectiveTab === "assistant";
    if (assistantShown && this.scope === "site" && this.agentServerUp) this.ensureSiteConnection();
    if (this.siteConnection && ["posts", "open", "site", "config", "siteConnection"].some((k) => changed.has(k))) {
      const context = this.siteContext();
      if (context) this.siteConnection.updateSite(context);
    }
    if ((changed.has("posts") || changed.has("site")) && canUseDictionary()) {
      applyDictionary(this.site ? siteWords(this.posts, parseWordList(this.site.words ?? "")) : []);
    }
  }

  private setCheckSpelling(on: boolean) {
    this.checkSpelling = on;
    localStorage.setItem(SPELLCHECK_KEY, String(on));
  }

  // ---- Rendering -------------------------------------------------------------

  private get visiblePosts(): PostSummary[] {
    const q = this.filter.toLowerCase();
    if (this.listing === "notes") return this.notes.filter((p) => !q || p.title.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    return this.posts.filter(
      (p) =>
        (this.sectionFilter === "*" || p.section === this.sectionFilter) &&
        (!this.draftsOnly || p.draft) &&
        (!q || p.title.toLowerCase().includes(q) || p.contentPath.toLowerCase().includes(q)),
    );
  }

  private renderTop() {
    return html`<div class="top">
      <div class="brand"><img src="/icons/icon.svg" alt="" /><span>Hugo Editor</span></div>
      ${this.sites.length
        ? html`<select
            class="site"
            aria-label="Site"
            @change=${(e: Event) => this.selectSite(this.sites.find((s) => s.id === (e.target as HTMLSelectElement).value)!)}
          >
            ${this.sites.map((s) => html`<option value=${s.id} ?selected=${s.id === this.site?.id}>${s.name}</option>`)}
          </select>
          <button class="ghost icon-only" aria-label="Site settings" title="Site settings" ?disabled=${!this.site} @click=${() => this.settingsDialog?.showModal()}>${icon("settings")}</button>`
        : nothing}
      ${this.supportsPicker && this.sites.length
        ? html`<button class="ghost icon-only" aria-label="Add site folder" title="Add site folder…" @click=${() => this.addSite()}>${icon("folder")}</button>`
        : nothing}
      <span class="spacer"></span>
      ${this.applyUpdate ? html`<button class="small" @click=${this.installUpdate} title="A new version of the editor is ready">${icon("refresh")} Update</button>` : nothing}
      ${this.site && !this.needsPermission && !this.narrow
        ? html`<button class="ghost icon-only" aria-label="Side panel" title="Preview and assistant" @click=${this.togglePreview} aria-pressed=${this.showPreview}>${icon("panel")}</button>`
        : nothing}
      <button class="primary" ?disabled=${!this.dirty} @click=${this.save} title="Save (Ctrl/⌘+S)">Save</button>
    </div>`;
  }

  private renderEmpty() {
    if (this.site && this.needsPermission) {
      return html`<div class="empty">
        <div class="art">${icon("folder")}</div>
        <h2>Reconnect to ${this.site.name}</h2>
        <p>The browser needs your OK again before the editor can read and write <code>${this.site.handle.name}</code>. Choose "Allow on every visit" to skip this next time.</p>
        <div class="actions"><button class="primary" @click=${this.reconnect}>Allow access</button></div>
      </div>`;
    }
    if (!this.site) {
      return html`<div class="empty">
        <div class="art">${icon("folder")}</div>
        <h2>Open a Hugo site</h2>
        ${this.supportsPicker
          ? html`<p>Pick the root folder of a Hugo site (the one with <code>hugo.toml</code> or <code>config.toml</code>). The editor reads and writes files there directly and remembers the folder for next time.</p>`
          : html`<p>This browser can't open local folders (it needs the File System Access API, available in Chrome and Edge). You can still try the editor with a sample site stored in the browser.</p>`}
        <div class="actions">
          ${this.supportsPicker ? html`<button class="primary" @click=${() => this.addSite()}>Add site folder…</button>` : nothing}
          <button @click=${this.addSampleSite}>Try a sample site</button>
        </div>
      </div>`;
    }
    return html`<div class="empty">
      <div class="art">${icon("file")}</div>
      <h2>${this.loading ? "Loading posts…" : "Pick a post"}</h2>
      ${this.loading
        ? nothing
        : html`<p>Choose a post on the left, or start a new one. Save any time with <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>S</kbd>.</p>
            <div class="actions"><button class="primary" ?disabled=${!this.config} @click=${() => this.newPostDialog?.showModal()}>${icon("plus")} New post</button></div>`}
    </div>`;
  }

  private renderOrphan() {
    if (!this.orphanFile) return nothing;
    return html`<div class="banner" role="alert">
      <span><code>${this.orphanFile.name}</code> isn't in a site you've added.</span>
      ${this.supportsPicker ? html`<button @click=${this.addOrphanSite}>Add its site folder…</button>` : nothing}
      <button class="ghost" @click=${() => (this.orphanFile = undefined)}>Dismiss</button>
    </div>`;
  }

  private renderSidebar() {
    const posts = this.visiblePosts;
    const secs = sections(this.posts);
    const notes = this.listing === "notes";
    const all = notes ? this.notes : this.posts;
    const noun = notes ? (this.notes.length === 1 ? "note" : "notes") : this.posts.length === 1 ? "post" : "posts";
    return html`<aside>
      <div class="filters">
        <div class="seg" role="tablist" aria-label="List">
          <button role="tab" aria-selected=${!notes} @click=${() => (this.listing = "posts")}>Posts</button>
          <button role="tab" aria-selected=${notes} title="Research notes and post ideas, kept in ${NOTES_DIR}/ at the site root" @click=${() => (this.listing = "notes")}>Notes</button>
        </div>
        <div class="row">
          <div class="search">
            ${icon("search")}
            <input type="search" placeholder="Filter ${noun}" aria-label="Filter ${noun}" .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
          </div>
          <button class="primary" ?disabled=${!this.config} @click=${() => this.newPostDialog?.showModal()} title=${notes ? "New note" : "New post"}>${icon("plus")} New</button>
        </div>
        ${notes
          ? html`<p class="muted hint">Collect sources and ideas here. The site assistant can research a topic into a note, and turn a note into a draft post.</p>`
          : html`<div class="row">
          ${secs.length > 1
            ? html`<select aria-label="Section" @change=${(e: Event) => (this.sectionFilter = (e.target as HTMLSelectElement).value)}>
                <option value="*">All sections</option>
                ${secs.map((s) => html`<option value=${s}>${s || "(root)"}</option>`)}
              </select>`
            : nothing}
          <label class="muted"><input type="checkbox" .checked=${this.draftsOnly} @change=${(e: Event) => (this.draftsOnly = (e.target as HTMLInputElement).checked)} /> Drafts only</label>
        </div>`}
      </div>
      <div class="count">${this.loading ? "Loading…" : posts.length === all.length ? `${posts.length} ${noun}` : `${posts.length} of ${all.length} ${noun}`}</div>
      <ul>
        ${posts.map(
          (p) => html`<li>
            <button aria-current=${p.path === this.open?.summary.path} @click=${() => this.openPost(p)}>
              <span class="title"><span>${p.title}</span>${p.draft ? html`<span class="badge">Draft</span>` : nothing}${notes && typeof p.frontMatter.status === "string" ? html`<span class="badge">${p.frontMatter.status}</span>` : nothing}</span>
              <span class="meta">${p.date ? DATE_FORMAT.format(p.date) : "No date"} · ${p.url || p.path}</span>
            </button>
          </li>`,
        )}
      </ul>
    </aside>`;
  }

  private renderEditor() {
    if (!this.open) return html`<main>${this.renderOrphan()}${this.renderEmpty()}</main>`;
    const { post, summary } = this.open;
    return html`<main>
      ${this.renderOrphan()}
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
          .collapsed=${this.narrow}
          .data=${post.frontMatter}
          .raw=${post.rawFrontMatter}
          .format=${post.format}
          .summarize=${canSummarize() ? (field: string) => summarizePost(this.open!.post.body, this.site!.name, field) : undefined}
          @field-change=${this.onFieldChange}
          @raw-change=${this.onRawChange}
        ></frontmatter-form>`,
      )}
      <div class="toolbar">
        <span class="path" title=${summary.path}>${icon("file")}<span>${summary.path}</span></span>
        ${this.shortcodes.length
          ? html`<select aria-label="Insert shortcode" @change=${this.insertShortcode}>
              <option value="">Insert shortcode…</option>
              ${this.shortcodes.map((s) => html`<option value=${s}>${s}</option>`)}
            </select>`
          : nothing}
      </div>
      <md-editor .value=${post.body} .checkSpelling=${this.checkSpelling} @change=${this.onBodyChange} @image-files=${this.onImageFiles}></md-editor>
    </main>`;
  }

  private renderDialogs() {
    const secs = sections(this.posts);
    return html`
      <dialog
        id="new-post"
        aria-labelledby="new-post-title"
        @close=${(e: Event) => {
          ((e.target as HTMLDialogElement).querySelector("form") as HTMLFormElement)?.reset();
          this.shared = undefined;
        }}
      >
        <form @submit=${this.createPost}>
          <h3 id="new-post-title">${this.listing === "notes" ? "New note" : "New post"}</h3>
          <label>Title <input name="title" required autofocus .value=${this.shared?.title ?? ""} /></label>
          ${this.listing === "notes"
            ? html`<p class="muted">Saved as a markdown file in <code>${NOTES_DIR}/</code> at the site root, which Hugo doesn't publish.</p>`
            : secs.length > 1
            ? html`<label>Section
                <select name="section">${secs.map((s) => html`<option value=${s}>${s || "(root)"}</option>`)}</select>
              </label>`
            : html`<input type="hidden" name="section" value=${secs[0] ?? ""} />`}
          ${this.shared?.text ? html`<p class="muted">Starts with the shared text: <q>${this.shared.text.slice(0, 120)}${this.shared.text.length > 120 ? "…" : ""}</q></p>` : nothing}
          ${this.listing === "notes" ? nothing : html`<p class="muted">Front matter is copied from the most recent post in that section. The post starts as a draft.</p>`}
          <div class="actions">
            <button type="button" @click=${() => this.newPostDialog?.close()}>Cancel</button>
            <button class="primary" type="submit">Create</button>
          </div>
        </form>
      </dialog>
      <dialog id="site-settings" closedby="any" aria-labelledby="site-settings-title" @click=${lightDismiss}>
        ${this.site
          ? html`<form method="dialog">
              <h3 id="site-settings-title">Site settings</h3>
              <label>Name <input .value=${this.site.name} @change=${(e: Event) => this.updateSite({ name: (e.target as HTMLInputElement).value })} /></label>
              <label>Preview server
                <input .value=${this.site.previewOrigin} @change=${(e: Event) => this.updateSite({ previewOrigin: (e.target as HTMLInputElement).value.replace(/\/$/, "") })} />
              </label>
              <label>Spell check words
                <textarea
                  rows="3"
                  placeholder="Hugo, WebMCP, aifoc.us"
                  .value=${this.site.words ?? ""}
                  @change=${(e: Event) => this.updateSite({ words: (e.target as HTMLTextAreaElement).value })}
                ></textarea>
              </label>
              <p class="muted">
                <label style="display:inline"><input type="checkbox" .checked=${this.checkSpelling} @change=${(e: Event) => this.setCheckSpelling((e.target as HTMLInputElement).checked)} /> Check spelling in the editor</label>.
                ${canUseDictionary()
                  ? "These words, and the site's tags and categories, aren't marked as misspelled."
                  : "Chrome 159 and later stop marking these words, and the site's tags and categories, as misspelled."}
              </p>
              <h4>Appearance</h4>
              <div class="seg" role="group" aria-label="Theme">
                ${(["system", "light", "dark"] as const).map(
                  (t) => html`<button type="button" aria-pressed=${this.theme === t} @click=${() => ((this.theme = t), setTheme(t))}>
                    ${t === "system" ? "System" : t === "light" ? "Light" : "Dark"}
                  </button>`,
                )}
              </div>
              <h4>Assistant</h4>
              <label>Agent server <input placeholder="This site" .value=${this.agentSettings.server} @change=${(e: Event) => this.updateAgentSettings({ server: (e.target as HTMLInputElement).value.trim().replace(/\/$/, "") })} /></label>
              <label>Access token <input type="password" autocomplete="off" .value=${this.agentSettings.token} @change=${(e: Event) => this.updateAgentSettings({ token: (e.target as HTMLInputElement).value.trim() })} /></label>
              <p class="muted">Writing rules sent to the assistant: ${this.siteInstructions ? SITE_RULE_FILES.join(" / ") + " from the site folder" : html`none (add a <code>CLAUDE.md</code> or <code>AGENTS.md</code> to the site root)`}.</p>
              <p class="muted">Folder: <code>${this.site.handle.name}</code>${this.config ? html` · config: <code>${this.config.file}</code> · content: <code>${this.config.contentDir}/</code>` : nothing}</p>
              <div class="actions">
                <button type="button" class="left ghost danger" @click=${this.removeSite}>Remove site</button>
                <button type="button" @click=${() => this.loadSite()}>Rescan</button>
                <button class="primary">Done</button>
              </div>
            </form>`
          : nothing}
      </dialog>
    `;
  }

  /** With no post open (or a note, which has no URL) there is nothing to preview, so the side panel shows the assistant. */
  private get effectiveTab(): "preview" | "assistant" {
    return this.open?.summary.url ? this.sideTab : "assistant";
  }

  private renderSide(tab = this.effectiveTab) {
    const site = this.scope === "site";
    return html`<section class="side">
      ${this.narrow ? nothing : html`<div class="tabs"><div class="seg" role="tablist">
        <button role="tab" aria-selected=${tab === "preview"} ?disabled=${!this.open?.summary.url} @click=${() => this.setSideTab("preview")}>Preview</button>
        <button role="tab" aria-selected=${tab === "assistant"} @click=${() => this.setSideTab("assistant")}>Assistant</button>
      </div></div>`}
      ${tab === "preview"
        ? html`<preview-pane
            .origin=${this.site!.previewOrigin}
            .path=${this.open!.summary.url}
            .draft=${this.open!.summary.draft}
            @origin-change=${(e: CustomEvent<{ origin: string }>) => this.updateSite({ previewOrigin: e.detail.origin })}
          ></preview-pane>`
        : html`<agent-panel
            .connection=${site ? this.siteConnection : this.connection}
            .models=${site ? this.siteModels : this.models}
            .model=${site ? this.siteModel : (this.agentSettings.model ?? "")}
            .configError=${site && !this.agentServerUp && !this.agentError ? "The site assistant needs the agent server (Assistant settings)." : this.agentError}
            .scope=${this.scope}
            .hasPost=${!!this.open}
            @scope-change=${(e: CustomEvent<ActionScope>) => this.setScope(e.detail)}
            .skills=${mergeSkills(BUILTIN_SKILLS, this.siteSkills)}
            @model-change=${(e: CustomEvent<string>) => this.setModel(e.detail)}
            @apply-edit=${this.onApplyEdit}
            @apply-file-change=${this.onApplyFileChange}
            @open-path=${this.onOpenPath}
          ></agent-panel>`}
    </section>`;
  }

  private renderStatus() {
    const words = this.open ? (this.open.post.body.match(/[\p{L}\p{N}’']+/gu) ?? []).length : 0;
    return html`<div class="status" role="status">
      ${this.open ? html`<span class=${this.dirty ? "dirty" : ""}><span class="dot"></span>${this.dirty ? "Unsaved changes" : "Saved"}</span>` : nothing}
      ${this.error ? html`<span class="error">${this.error}</span>` : nothing}
      ${this.message ? html`<span>${this.message}</span>` : nothing}
      ${this.indexStatus ? html`<span>${this.indexStatus}</span>` : nothing}
      ${this.open ? html`<span class="end">${words.toLocaleString()} words · ${Math.max(1, Math.round(words / 230))} min read</span>` : nothing}
    </div>`;
  }

  /** Phones: one pane at a time, with a bottom bar to move between them. */
  private renderNarrow() {
    const views: { id: MobileView; label: string; icon: IconName; needsPost?: boolean }[] = [
      { id: "posts", label: "Posts", icon: "list" },
      { id: "write", label: "Write", icon: "pen", needsPost: true },
      { id: "preview", label: "Preview", icon: "eye", needsPost: true },
      { id: "assistant", label: "Assistant", icon: "sparkles" },
    ];
    // Without an open post only the list and the site assistant make sense.
    const view = this.open ? this.mobileView : this.mobileView === "assistant" ? "assistant" : "posts";
    let pane;
    if (view === "posts") pane = this.renderSidebar();
    else if (view === "write") pane = this.renderEditor();
    else pane = this.renderSide(view);
    return html`
      ${this.renderTop()}
      <div class="body solo">${pane}</div>
      ${this.renderStatus()}
      <nav class="views" aria-label="Views">
        ${views.map(
          (v) => html`<button
            aria-current=${view === v.id ? "page" : "false"}
            ?disabled=${v.needsPost && !this.open}
            @click=${() => (v.id === "preview" || v.id === "assistant" ? this.setSideTab(v.id) : (this.mobileView = v.id))}
          >
            ${icon(v.icon)}<span>${v.label}</span>
          </button>`,
        )}
      </nav>
      ${this.renderDialogs()}
    `;
  }

  render() {
    const ready = !!this.site && !this.needsPermission;
    if (this.narrow && ready) return this.renderNarrow();
    const preview = ready && this.showPreview;
    return html`
      ${this.renderTop()}
      <div class="body ${!ready ? "solo" : preview ? "" : "no-preview"}">
        ${ready ? this.renderSidebar() : nothing}
        ${ready ? this.renderEditor() : html`<main>${this.renderOrphan()}${this.renderEmpty()}</main>`}
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
  focusedFrontMatterField()?.blur();
}

/** The front matter form's focused text field, if one is focused. */
function focusedFrontMatterField(): HTMLInputElement | HTMLTextAreaElement | undefined {
  let el = document.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  const host = el?.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).host : undefined;
  return host?.localName === "frontmatter-form" && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) ? el : undefined;
}

/** Edits that run on the open post (WebMCP tools only drive the post assistant). */
function postActions() {
  return [...BUILTIN_ACTIONS, ...loadCustomActions().filter((a) => (a.scope ?? "post") === "post")];
}
