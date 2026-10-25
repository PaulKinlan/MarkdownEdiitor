// The assistant's state and connections, moved out of the app shell: the
// model list, the post and site conversations, the site's writing rules and
// skills, and the search index. It follows the app through shell "change"
// events and asks the shell to re-render when its own state changes.

import { loadAgentSettings, saveAgentSettings, sessionId, type AgentConnection, type AgentLink, type AgentSettings } from "../../lib/agent-client";
import { syncSiteIndex } from "../../lib/indexer";
import type { ActionScope } from "../../lib/actions";
import { exists, readText } from "../../lib/fs";
import { sections } from "../../lib/posts";
import { installSiteSkill, loadSiteSkills, removeSiteSkill } from "../../lib/site-skills";
import { fetchSkillsFromGitHub, loadInstalledSkills, refreshSkill, saveInstalledSkills } from "../../lib/skill-install";
import { mergeSkills, type Skill } from "../../shared/skills";
import type { Edit, ModelInfo, PostContext, SiteContext } from "../../shared/protocol";
import type { SiteRecord } from "../../lib/sites";
import type { Shell } from "../../core/modules";
import type { SkillManager } from "./skills-dialog";
import { backends, type AgentBackend, type BackendListing } from "./backend";

const SCOPE_KEY = "md-editor:assistant-scope";
export const SITE_RULE_FILES = ["CLAUDE.md", "AGENTS.md"];

export class Assistant {
  settings: AgentSettings = loadAgentSettings();
  models: ModelInfo[] = [];
  error = "";
  serverUp = false;
  /** The agent server has a key for web_search (DeepSeek, Brave or Tavily). */
  serverWebSearch = false;
  connection?: AgentLink;
  /** The site-wide assistant for the current site; opened when first shown. */
  siteConnection?: AgentConnection;
  /** CLAUDE.md and AGENTS.md from the site root. */
  siteInstructions = "";
  /** Skills from the site folder (.agents/skills, .claude/skills), sent to the assistant with the post. */
  private siteSkills: Skill[] = [];
  /** Skills installed from GitHub for every site, kept in this browser. */
  private installedSkills: Skill[] = [];
  private chosenScope: ActionScope = localStorage.getItem(SCOPE_KEY) === "site" ? "site" : "post";
  /** The site and post the post connection is for. */
  private connectedTo?: { site: SiteRecord; path: string };
  /** Bumped on each site load, so a slow read that finishes after the user moved on is dropped. */
  private generation = 0;
  private indexing: Promise<void> = Promise.resolve();
  private indexTimer?: ReturnType<typeof setTimeout>;
  private fileWrites: Promise<unknown> = Promise.resolve();
  private sentSkills = "[]";
  /** Which backend listed each model ("<provider>/<modelId>"). */
  private owners = new Map<string, AgentBackend>();

  constructor(
    private shell: Shell,
    private setStatus: (text: string) => void,
  ) {
    void loadInstalledSkills().then((skills) => {
      this.installedSkills = skills;
      this.sendSkills();
    });
  }

  dispose() {
    clearTimeout(this.indexTimer);
    this.closePost();
    this.closeSite();
  }

  // ---- Following the app -------------------------------------------------------

  onShellChange(changed: ReadonlySet<string>) {
    const { shell } = this;
    if (changed.has("site")) {
      this.generation++;
      this.closePost();
      this.closeSite();
      this.siteInstructions = "";
      this.siteSkills = [];
    }
    // The config is (re)read each time the site loads or is rescanned.
    if (changed.has("config") && shell.config && shell.ready) void this.loadSite();
    const path = shell.open?.summary.path;
    if (changed.has("open") && (!path || path !== this.connectedTo?.path || shell.site !== this.connectedTo?.site)) this.openConnection();
    else if (changed.has("text") && this.connection) this.connection.updatePost(this.postContext()!);
    if ((changed.has("posts") || changed.has("notes")) && !changed.has("site")) this.scheduleIndexSync();
    // Opened lazily, the first time the site assistant is on screen.
    if (shell.sideTab === "assistant" && this.scope === "site" && this.serverUp) this.ensureSiteConnection();
    if (this.siteConnection && ["posts", "open", "site", "config"].some((k) => changed.has(k))) this.sendSite();
  }

  /** Extension skills go with the other skills; they're sent again only when they change. */
  onExtensionsChange() {
    const skills = JSON.stringify(this.shell.extensions.host.skills);
    if (skills === this.sentSkills) return;
    this.sentSkills = skills;
    this.sendSkills();
  }

  private async loadSite() {
    const { site } = this.shell;
    if (!site) return;
    const generation = ++this.generation;
    const [rules, skills] = await Promise.all([Promise.all(SITE_RULE_FILES.map((f) => readText(site.handle, f))), loadSiteSkills(site.handle)]);
    if (generation !== this.generation) return;
    this.siteInstructions = rules.filter(Boolean).join("\n\n");
    this.siteSkills = skills;
    this.sendSkills();
    this.shell.update();
    await this.connectServer();
  }

  // ---- The agent server --------------------------------------------------------

  /** Loads every backend's models and brings the site's search index up to date. */
  async connectServer() {
    const listings = await Promise.all(
      backends().map(async (backend) => ({ backend, ...(await backend.models(this.settings).catch((e): BackendListing => ({ models: [], error: String(e) }))) })),
    );
    this.owners = new Map(listings.flatMap((l) => l.models.map((m) => [`${m.provider}/${m.modelId}`, l.backend] as const)));
    this.models = listings.flatMap((l) => l.models);
    const server = listings.find((l) => l.backend.server);
    const failed = server ? (server.error ?? "") : "There's no agent server.";
    this.serverUp = !failed;
    this.serverWebSearch = !!server?.webSearch;
    this.error = this.models.length ? "" : failed || "The agent server has no model API keys configured.";
    if (failed && this.models.length) this.setStatus(`${failed}. The other models still work.`);
    const saved = this.settings.model;
    if (!saved || !this.owners.has(saved)) {
      const first = server?.models.find((m) => m.provider === "anthropic") ?? this.models[0];
      if (first) this.setModel(`${first.provider}/${first.modelId}`);
    }
    this.shell.update();
    if (failed) return;
    void this.shell.extensions.sync();
    this.setStatus("Indexing posts for search…");
    await this.syncIndex();
  }

  /** Brings the site's search index up to date. Serialised, so saves in quick succession queue rather than race. */
  private syncIndex(): Promise<void> {
    this.indexing = this.indexing.then(async () => {
      const { site, posts, notes } = this.shell;
      if (!site) return;
      try {
        const uploaded = await syncSiteIndex(this.settings, site.id, site.handle, [...posts, ...notes]);
        this.setStatus(uploaded > 1 ? `Indexed ${uploaded} posts` : "");
        if (uploaded > 1) setTimeout(() => this.setStatus(""), 4000);
      } catch (e) {
        this.setStatus(`Search index not updated: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    return this.indexing;
  }

  /** One index sync after a burst of changes (saves, accepted edits, files changed on disk), rather than one each. */
  private scheduleIndexSync() {
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => this.serverUp && void this.syncIndex(), 800);
  }

  /** The backend a model belongs to: the one that listed it, else the agent server (until the lists load). */
  private backendFor(model: string | undefined): AgentBackend | undefined {
    const provider = model?.split("/")[0] ?? "";
    return (model && this.owners.get(model)) || backends().find((b) => b.providers?.includes(provider)) || backends().find((b) => b.server);
  }

  setModel(model: string) {
    // Each backend has its own conversation.
    const switching = this.backendFor(model) !== this.backendFor(this.settings.model);
    this.settings = { ...this.settings, model };
    saveAgentSettings(this.settings);
    if (switching && this.connection) this.openConnection();
    this.shell.update();
  }

  updateSettings(patch: Partial<AgentSettings>) {
    this.settings = { ...this.settings, ...patch };
    saveAgentSettings(this.settings);
    this.openConnection();
    this.closeSite();
    void this.connectServer();
  }

  // ---- Conversations -----------------------------------------------------------

  /** The site assistant is shown with no post open, or when picked in the panel. */
  get scope(): ActionScope {
    return this.shell.open ? this.chosenScope : "site";
  }

  setScope(scope: ActionScope) {
    this.chosenScope = scope;
    localStorage.setItem(SCOPE_KEY, scope);
    this.shell.update();
  }

  /** Starts a post assistant run and shows it; returns why it couldn't. */
  prompt(text: string, label: string): string | undefined {
    const [provider, ...rest] = (this.settings.model ?? "").split("/");
    if (!this.connection || !provider || !rest.length) return "The assistant isn't ready: open a post and pick a model.";
    this.connection.prompt(text, { provider, modelId: rest.join("/") }, label);
    this.shell.showSideTab("assistant");
    return undefined;
  }

  private openConnection() {
    this.closePost();
    const { open, site } = this.shell;
    if (!open || !site) return this.shell.update();
    const id = sessionId(site.id, open.summary.path);
    const backend = this.backendFor(this.settings.model);
    if (!backend) return this.shell.update();
    this.connection = backend.connect(this.settings, id);
    this.connectedTo = { site, path: open.summary.path };
    this.shell.extensions.watch(this.connection);
    this.connection.updatePost(this.postContext()!);
    this.connection.updateSkills(this.extraSkills());
    this.shell.update();
  }

  private closePost() {
    this.connection?.close();
    this.connection = undefined;
    this.connectedTo = undefined;
  }

  private closeSite() {
    this.shell.extensions.detach(this.siteConnection);
    this.siteConnection?.close();
    this.siteConnection = undefined;
  }

  /** Opens the site assistant's connection the first time it's needed for this site. */
  private ensureSiteConnection() {
    const context = this.siteContext();
    const backend = [this.backendFor(this.siteModel), ...backends()].find((b) => b?.connectSite);
    if (!context || this.siteConnection || !backend?.connectSite) return;
    this.siteConnection = backend.connectSite(this.settings, context.siteId);
    this.shell.extensions.attach(this.siteConnection);
    this.siteConnection.updateSkills(this.extraSkills());
    this.sendSite();
    this.shell.update();
  }

  private sendSite() {
    const context = this.siteContext();
    if (context) this.siteConnection?.updateSite(context);
  }

  private sendSkills() {
    this.connection?.updateSkills(this.extraSkills());
    this.siteConnection?.updateSkills(this.extraSkills());
  }

  private siteContext(): SiteContext | undefined {
    const { site, config, open, posts, ready } = this.shell;
    if (!site || !config || !ready) return undefined;
    return {
      siteId: site.id,
      siteName: site.name,
      siteInstructions: this.siteInstructions,
      contentDir: config.contentDir,
      sections: sections([...posts]),
      ...(open ? { openPath: open.summary.path } : {}),
    };
  }

  private postContext(): PostContext | undefined {
    const { site, open, text, shortcodes } = this.shell;
    if (!open || !site) return undefined;
    return {
      siteId: site.id,
      siteName: site.name,
      siteInstructions: this.siteInstructions,
      path: open.summary.path,
      url: open.summary.url,
      text,
      shortcodes: [...shortcodes],
    };
  }

  /** Models whose backend can hold a site-wide conversation (the agent server: it has the site index). */
  get siteModels(): ModelInfo[] {
    return this.models.filter((m) => this.owners.get(`${m.provider}/${m.modelId}`)?.connectSite);
  }

  get siteModel(): string {
    const saved = this.settings.model ?? "";
    if (saved && this.owners.get(saved)?.connectSite) return saved;
    const first = this.siteModels[0];
    return first ? `${first.provider}/${first.modelId}` : "";
  }

  // ---- Skills ------------------------------------------------------------------

  /** Skills beyond the built-in ones: extensions', then installed, then the site's own, each replacing an earlier one with the same name. */
  extraSkills(): Skill[] {
    return mergeSkills(this.shell.extensions.host.skills, this.installedSkills, this.siteSkills);
  }

  skillManager(): SkillManager {
    const { site } = this.shell;
    return {
      hasSite: !!site && this.shell.ready,
      install: async (source, target) => {
        const { skills } = await fetchSkillsFromGitHub(source);
        if (target === "site") {
          if (!site) throw new Error("Open a site first.");
          for (const { skill, markdown } of skills) await installSiteSkill(site.handle, skill, markdown);
          await this.reloadSiteSkills();
        } else {
          await this.saveInstalled(mergeSkills(this.installedSkills, skills.map((d) => ({ ...d.skill, source: "installed" }))));
        }
        return skills.map((d) => d.skill.name);
      },
      update: async (skill) => {
        const { skill: fresh, markdown } = await refreshSkill(skill);
        if (skill.source === "site" && site) {
          await installSiteSkill(site.handle, fresh, markdown, skill.folder);
          await this.reloadSiteSkills();
        } else {
          await this.saveInstalled(this.installedSkills.map((s) => (s.name === skill.name ? { ...fresh, source: "installed" } : s)));
        }
      },
      remove: async (skill) => {
        if (skill.source === "site" && site && skill.folder) {
          await removeSiteSkill(site.handle, skill.folder);
          await this.reloadSiteSkills();
        } else {
          await this.saveInstalled(this.installedSkills.filter((s) => s.name !== skill.name));
        }
      },
    };
  }

  private async saveInstalled(skills: Skill[]) {
    await saveInstalledSkills(skills);
    this.installedSkills = skills;
    this.sendSkills();
    this.shell.update();
  }

  private async reloadSiteSkills() {
    const { site } = this.shell;
    const generation = this.generation;
    if (!site) return;
    const skills = await loadSiteSkills(site.handle);
    // Dropped if another site was opened (or this one reloaded) meanwhile.
    if (this.shell.site !== site || generation !== this.generation) return;
    this.siteSkills = skills;
    this.sendSkills();
    this.shell.update();
  }

  // ---- Changes the site assistant proposes ---------------------------------------

  /**
   * Applies a change the site assistant proposed. Edits to the open post go
   * through the editor (unsaved, undoable) like the post assistant's; other
   * files are written straight to disk. Writes run one at a time, so
   * accepting a batch of edits to one file applies them in turn.
   */
  applyFileChange(path: string, edit: Edit | undefined, create: string | undefined): Promise<boolean> {
    // Pinned to the site it was proposed for: a queued write must not land in a site switched to meanwhile.
    const { site } = this.shell;
    const run = this.fileWrites.then(() => this.writeFileChange(site, path, edit, create));
    this.fileWrites = run.catch(() => undefined);
    return run;
  }

  private async writeFileChange(site: SiteRecord | undefined, path: string, edit: Edit | undefined, create: string | undefined): Promise<boolean> {
    const { shell } = this;
    if (!site || site !== shell.site || !shell.config) return false;
    if (create === undefined && path === shell.open?.summary.path) return edit ? shell.applyEdit(edit) : false;
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
    if (site !== shell.site) return false;
    await shell.writeSiteFile(path, next);
    shell.flash(create !== undefined ? `Created ${path}` : `Updated ${path}`);
    return true;
  }
}
