// First-party modules: trusted features that run in the page, one folder each
// in src/modules/<id>/ with a module.ts that default-exports defineModule().
// They're found by folder, so a new one never edits a shared list. A module
// reads the app through `shell` and adds to it through `ModuleContext`: side
// panel tabs, settings sections, dialogs, commands, image handlers and editor
// options. Sandboxed extensions (src/extensions) are the other tier, for code
// the author or the assistant writes.

import type { TemplateResult } from "lit";
import type { IconName } from "../components/icons";
import type { PaletteCommand } from "../components/command-palette";
import type { Post } from "../lib/frontmatter";
import type { HugoConfig } from "../lib/hugo";
import type { PostSummary } from "../lib/posts";
import type { SiteRecord } from "../lib/sites";
import type { Edit } from "../shared/protocol";

type Renderable = TemplateResult | typeof import("lit").nothing;

/** What modules can see and do in the app. Fires "change" (a ShellChange) after the app's state changes. */
export interface Shell extends EventTarget {
  readonly site?: SiteRecord;
  /** True once the site's folder can be read (permission granted). */
  readonly ready: boolean;
  readonly config?: HugoConfig;
  readonly posts: readonly PostSummary[];
  readonly notes: readonly PostSummary[];
  /** Names of the site's and theme's shortcodes. */
  readonly shortcodes: readonly string[];
  readonly open?: { readonly summary: PostSummary; readonly post: Post };
  /** The open post's whole text, as in the editor (saved or not). */
  readonly text: string;
  readonly dirty: boolean;
  /** The phone layout: one pane at a time. */
  readonly narrow: boolean;
  /** A short notice in the status bar. */
  flash(message: string): void;
  /** An error in the status bar. */
  fail(message: string): void;
  save(): Promise<void>;
  /** Opens a post or note by path; resolves to a reason when it didn't. */
  openPath(path: string): Promise<string | undefined>;
  /** Inserts at the cursor (undoable). False with no post open. */
  insert(text: string): boolean;
  /** A find/replace edit to the open post; body edits are undoable. */
  applyEdit(edit: Edit): boolean;
  updateSite(patch: Partial<SiteRecord>): Promise<void>;
  showSideTab(id: string): void;
  /** Starts a post assistant run; resolves to a reason when the assistant isn't ready. */
  prompt(text: string, label: string): string | undefined;
  /** Re-renders the app, after a module's own state changed. */
  update(): void;
}

/** The detail of a shell "change" event: names of the app state that changed (site, posts, notes, open, text, ...). */
export type ShellChange = CustomEvent<ReadonlySet<string>>;

export interface SideTab {
  id: string;
  title: string;
  /** Lower first. Core: assistant 20. */
  order: number;
  /** Shown on the phone's bottom bar too, with this icon. */
  icon?: IconName;
  /** False greys the tab out (e.g. preview with no post open). */
  available?(): boolean;
  render(): Renderable;
}

export interface SettingsSection {
  id: string;
  /** Lower first. Core: name 0, appearance 50, extensions 60, assistant 70, folder 90. */
  order: number;
  render(): Renderable;
}

export interface ModuleContext {
  shell: Shell;
  addSideTab(tab: SideTab): () => void;
  addSettingsSection(section: SettingsSection): () => void;
  /** Rendered once, after the app's own dialogs. */
  addDialog(render: () => Renderable): () => void;
  /** Commands for the palette, asked for each time it opens. */
  addCommands(commands: () => PaletteCommand[]): () => void;
  /** Gets dropped or pasted images; the first handler that returns true has handled them. */
  onImageFiles(handler: (files: File[]) => Promise<boolean>): () => void;
  /** Options for the editor (`spellcheck`: boolean). */
  setEditorOption(key: string, value: unknown): void;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  /** Lower activates first (default 1000). */
  order?: number;
  activate(context: ModuleContext): void | (() => void);
}

export function defineModule(definition: ModuleDefinition): ModuleDefinition {
  return definition;
}

/** Everything modules (and the app itself) contributed, kept in order. Fires "change" when it changes. */
export class Contributions extends EventTarget {
  sideTabs: SideTab[] = [];
  settingsSections: SettingsSection[] = [];
  dialogs: (() => Renderable)[] = [];
  commandSources: (() => PaletteCommand[])[] = [];
  imageHandlers: ((files: File[]) => Promise<boolean>)[] = [];
  editorOptions: Record<string, unknown> = {};

  context(shell: Shell): ModuleContext {
    const add = <T>(list: () => T[], set: (items: T[]) => void, item: T, sort?: (a: T, b: T) => number) => {
      set(sort ? [...list(), item].sort(sort) : [...list(), item]);
      this.changed();
      return () => {
        set(list().filter((i) => i !== item));
        this.changed();
      };
    };
    const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
    return {
      shell,
      addSideTab: (tab) => add(() => this.sideTabs, (v) => (this.sideTabs = v), tab, byOrder),
      addSettingsSection: (section) => add(() => this.settingsSections, (v) => (this.settingsSections = v), section, byOrder),
      addDialog: (render) => add(() => this.dialogs, (v) => (this.dialogs = v), render),
      addCommands: (commands) => add(() => this.commandSources, (v) => (this.commandSources = v), commands),
      onImageFiles: (handler) => add(() => this.imageHandlers, (v) => (this.imageHandlers = v), handler),
      setEditorOption: (key, value) => {
        this.editorOptions = { ...this.editorOptions, [key]: value };
        this.changed();
      },
    };
  }

  commands(): PaletteCommand[] {
    return this.commandSources.flatMap((source) => source());
  }

  /** Offers files to each image handler in turn; false if none took them. */
  async handleImages(files: File[]): Promise<boolean> {
    for (const handler of this.imageHandlers) if (await handler(files)) return true;
    return false;
  }

  private changed() {
    this.dispatchEvent(new Event("change"));
  }
}
