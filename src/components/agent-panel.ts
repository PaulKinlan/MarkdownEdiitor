import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ChatItem, Edit, FileChange, ModelInfo } from "../shared/protocol";
import { editDecisions, type AgentLink } from "../lib/agent-client";
import { BUILTIN_ACTIONS, SITE_ACTIONS, loadCustomActions, saveCustomActions, type ActionScope, type EditAction } from "../lib/actions";
import { diffWords } from "../lib/diff";
import { skillPrompt, skillsFor, skillTitle, type Skill } from "../shared/skills";
import type { SkillManager, SkillsDialog } from "./skills-dialog";
import "./skills-dialog";
import { controls, lightDismiss } from "./shared";
import { icon } from "./icons";

type EditState = "pending" | "applying" | "accepted" | "rejected" | "stale";

/** One reviewable suggestion: an edit to the open post, an edit to a site file, or a new site file. */
interface Suggestion {
  key: string;
  edit?: Edit;
  path?: string;
  create?: string;
}

const BUILTIN_IDS = new Set([...BUILTIN_ACTIONS, ...SITE_ACTIONS].map((a) => a.id));

/**
 * The assistant: a chat with the post's agent session or the site-wide
 * session, one-click edits, and a review list for the changes the agent
 * proposes. Applying a change is the app's job (`apply-edit` for the open
 * post, `apply-file-change` for site files), since the app owns the files.
 */
@customElement("agent-panel")
export class AgentPanel extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg-2); }
      .bar { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border); }
      .bar select { flex: 1; min-width: 0; font-size: 13px; }
      .bar .seg button { min-height: 24px; padding: 0 10px; font-size: 12px; }
      .file { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg); display: grid; gap: 8px; padding: 10px 12px; }
      .file > header { display: flex; gap: 6px; align-items: center; font-size: 12px; min-width: 0; }
      .file > header code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); }
      .file > .reason { font-size: 12px; color: var(--fg-2); }
      .file .edit { box-shadow: none; }
      .file pre { margin: 0; max-height: 14em; overflow: auto; font-size: 12px; font-family: var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ok); }
      .dot.open { background: var(--ok); }
      .dot.connecting { background: var(--warn); }
      .dot.closed { background: var(--danger); }
      .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
      .actions button { min-height: 24px; padding: 0 10px; font-size: 12px; border-radius: 999px; }
      .actions + .actions { padding-top: 0; margin-top: -1px; }
      .actions .kind { font-size: 11px; color: var(--fg-2); align-self: center; min-width: 3.2em; }
      /* One scrolling line, so many skills don't push the chat down. */
      .actions.skills { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: thin; }
      .actions.skills > * { flex: none; }
      .actions button.skill .icon { width: 12px; height: 12px; color: var(--accent); }
      .log { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 10px; }
      /* Items keep their height when the log overflows; it scrolls instead. */
      .log > * { flex-shrink: 0; }
      .msg { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.55; }
      .user { align-self: flex-end; background: var(--accent); color: var(--accent-fg); padding: 7px 12px; border-radius: 14px 14px 4px 14px; max-width: 85%; }
      .user .label { font-weight: 600; }
      .assistant { padding: 0 2px; }
      .assistant.partial { color: var(--fg-2); }
      .error { color: var(--danger); font-size: 13px; }
      .tool { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-2); font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      /* Failures wrap so the reason is never clipped. */
      .tool.error { color: var(--danger); white-space: normal; overflow-wrap: anywhere; }
      .edit { border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg); padding: 10px 12px; display: grid; gap: 8px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.04); }
      .edit.accepted { border-color: color-mix(in srgb, var(--ok) 50%, var(--border)); opacity: 0.7; }
      .edit.rejected, .edit.stale { opacity: 0.55; }
      .edit .text { font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
      .edit del { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); border-radius: 3px; }
      .edit ins { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); text-decoration: none; border-radius: 3px; }
      .edit .reason { font-size: 12px; color: var(--fg-2); }
      .edit .row { display: flex; gap: 6px; align-items: center; }
      .edit .state { font-size: 12px; color: var(--fg-2); margin-left: auto; text-transform: capitalize; }
      .bulk { display: flex; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--border); align-items: center; font-size: 12px; color: var(--fg-2); }
      .bulk .spacer { flex: 1; }
      form.input { position: relative; margin: 10px; display: flex; align-items: flex-end; gap: 6px; padding: 6px 6px 6px 12px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--bg); transition: border-color 120ms var(--ease), box-shadow 120ms var(--ease); }
      form.input:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
      form.input textarea { flex: 1; resize: none; border: 0; padding: 5px 0; background: transparent; min-height: 1.6em; max-height: 10em; field-sizing: content; line-height: 1.45; box-shadow: none; }
      .empty { color: var(--fg-2); padding: 24px 12px; line-height: 1.6; text-align: center; display: grid; justify-items: center; gap: 8px; }
      .empty .icon { width: 22px; height: 22px; color: var(--accent); }
      .empty.error { color: var(--danger); }
      .usage { font-size: 11px; color: var(--fg-2); padding: 0 12px 8px; text-align: right; font-variant-numeric: tabular-nums; }
      dialog { width: min(560px, 92vw); }
      dialog form { display: grid; gap: 12px; }
      dialog textarea { min-height: 8em; resize: vertical; }
      dialog .list { display: grid; gap: 2px; max-height: 30vh; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; }
      dialog .list .row { display: flex; gap: 6px; align-items: center; padding: 2px 4px 2px 8px; border-radius: 4px; }
      dialog .list .row:hover { background: var(--hover); }
      dialog .list .row span { flex: 1; }
      dialog .buttons { display: flex; gap: 8px; justify-content: flex-end; }
    `,
  ];

  @property({ attribute: false }) connection?: AgentLink;
  @property({ attribute: false }) models: ModelInfo[] = [];
  @property() model = "";
  @property() configError = "";
  /** Which assistant this is: the open post's, or the whole site's. */
  @property() scope: ActionScope = "post";
  /** Whether a post is open, so the "This post" scope can be chosen. */
  @property({ type: Boolean }) hasPost = false;
  /** Built-in, installed and site skills, run with one click. */
  @property({ attribute: false }) skills: Skill[] = [];
  /** Installs, updates and removes skills; absent where that isn't possible. */
  @property({ attribute: false }) skillManager?: SkillManager;
  /** Quick edits that editor extensions added, shown after the others. */
  @property({ attribute: false }) extensionActions: EditAction[] = [];

  @state() private custom: EditAction[] = loadCustomActions();
  @state() private error = "";
  @state() private editing?: EditAction;

  @query(".log") private log?: HTMLElement;
  @query("#actions-dialog") private dialog?: HTMLDialogElement;
  @query("skills-dialog") private skillsDialog?: SkillsDialog;

  private onChange = () => {
    const nearBottom = this.log ? this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 80 : true;
    this.requestUpdate();
    if (nearBottom) void this.updateComplete.then(() => this.log?.scrollTo({ top: this.log.scrollHeight }));
  };
  private onError = (e: Event) => (this.error = String((e as CustomEvent).detail));

  updated(changed: Map<string, unknown>) {
    if (changed.has("connection")) {
      const old = changed.get("connection") as AgentLink | undefined;
      old?.removeEventListener("change", this.onChange);
      old?.removeEventListener("error", this.onError);
      this.connection?.addEventListener("change", this.onChange);
      this.connection?.addEventListener("error", this.onError);
      this.error = "";
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.connection?.removeEventListener("change", this.onChange);
    this.connection?.removeEventListener("error", this.onError);
  }

  private get modelRef() {
    const [provider, ...rest] = this.model.split("/");
    return provider && rest.length ? { provider, modelId: rest.join("/") } : undefined;
  }

  private send(text: string, label?: string) {
    const model = this.modelRef;
    if (!model) {
      this.error = "Pick a model first.";
      return;
    }
    this.error = "";
    this.connection?.prompt(text, model, label);
  }

  /** Runs a saved edit. Text in the message box goes with it, e.g. the topic for Research. */
  private runAction(action: EditAction) {
    const box = this.renderRoot.querySelector<HTMLTextAreaElement>("form.input textarea");
    const extra = box?.value.trim() ?? "";
    this.send(extra ? `${action.prompt}\n\n${extra}` : action.prompt, extra ? `${action.name}: ${extra.length > 60 ? `${extra.slice(0, 60)}…` : extra}` : action.name);
    if (box && extra && !this.error) box.value = "";
  }

  private setScope(scope: ActionScope) {
    if (scope !== this.scope) this.dispatchEvent(new CustomEvent("scope-change", { detail: scope }));
  }

  private submit(e: SubmitEvent) {
    e.preventDefault();
    const textarea = (e.target as HTMLFormElement).querySelector("textarea")!;
    const text = textarea.value.trim();
    if (!text) return;
    this.send(text);
    textarea.value = "";
  }

  private onInputKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  private get actions(): EditAction[] {
    const builtin = this.scope === "site" ? SITE_ACTIONS : BUILTIN_ACTIONS;
    return [...builtin, ...this.custom.filter((a) => (a.scope ?? "post") === this.scope)];
  }

  /**
   * Accepting asks the app to apply the change. Post edits are applied at
   * once; site files are read and written on disk, so `done` may come later.
   */
  private decide(s: Suggestion, accept: boolean) {
    if (!accept) {
      this.setState(s.key, "rejected");
      return;
    }
    const decisions = this.editStates;
    decisions.set(s.key, "applying");
    const done = (ok: boolean) => {
      decisions.set(s.key, ok ? "accepted" : "stale");
      this.requestUpdate();
    };
    const detail = s.path === undefined ? { edit: s.edit, done } : { path: s.path, edit: s.edit, create: s.create, done };
    this.dispatchEvent(new CustomEvent(s.path === undefined ? "apply-edit" : "apply-file-change", { detail, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  /** Decisions live with the session, not the panel, which is recreated on tab and visibility changes. */
  private get editStates(): Map<string, EditState> {
    return (this.connection ? editDecisions(this.connection.id) : new Map()) as Map<string, EditState>;
  }

  private setState(key: string, state: EditState) {
    this.editStates.set(key, state);
    this.requestUpdate();
  }

  private pendingSuggestions(items: ChatItem[]): Suggestion[] {
    const out: Suggestion[] = [];
    for (const item of items) {
      if (item.kind !== "tool") continue;
      for (const s of [...postSuggestions(item), ...(item.changes ?? []).flatMap((c) => fileSuggestions(item.callId, c))]) {
        if ((this.editStates.get(s.key) ?? "pending") === "pending") out.push(s);
      }
    }
    return out;
  }

  // ---- custom edits ----

  private saveAction(e: SubmitEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const name = String(form.get("name") ?? "").trim();
    const prompt = String(form.get("prompt") ?? "").trim();
    if (!name || !prompt) return;
    const scope = form.get("scope") === "site" ? "site" : "post";
    const id = this.editing?.id || `custom-${crypto.randomUUID()}`;
    const custom = [...loadCustomActions().filter((a) => a.id !== id), { id, name, prompt, scope } satisfies EditAction];
    saveCustomActions(custom);
    this.custom = custom;
    this.editing = undefined;
    (e.target as HTMLFormElement).reset();
  }

  private deleteAction(action: EditAction) {
    const custom = loadCustomActions().filter((a) => a.id !== action.id);
    saveCustomActions(custom);
    this.custom = custom;
  }

  private renderDecision(s: Suggestion) {
    const state = this.editStates.get(s.key) ?? "pending";
    if (state !== "pending") {
      const label = state === "stale" ? (s.create !== undefined ? "Not created: the file exists" : "No longer matches the file") : state === "applying" ? "Applying…" : state;
      return html`<span class="state">${label}</span>`;
    }
    return html`<button class="primary small" @click=${() => this.decide(s, true)}>${s.create !== undefined ? "Create" : "Accept"}</button>
      <button class="small" @click=${() => this.decide(s, false)}>Reject</button>`;
  }

  private renderEdit(s: Suggestion & { edit: Edit }) {
    const state = this.editStates.get(s.key) ?? "pending";
    return html`<div class="edit ${state}">
      <div class="text">${diffWords(s.edit.find, s.edit.replace).map((p) => (p.type === "same" ? p.text : p.type === "del" ? html`<del>${p.text}</del>` : html`<ins>${p.text}</ins>`))}</div>
      ${s.edit.reason ? html`<div class="reason">${s.edit.reason}</div>` : nothing}
      <div class="row">${this.renderDecision(s)}</div>
    </div>`;
  }

  /** A proposed change to one site file: its edits reviewed one by one, or a new file reviewed whole. */
  private renderFile(callId: string, change: FileChange) {
    const suggestions = fileSuggestions(callId, change);
    const pending = suggestions.filter((s) => (this.editStates.get(s.key) ?? "pending") === "pending");
    const open = () => this.dispatchEvent(new CustomEvent("open-path", { detail: change.path, bubbles: true, composed: true }));
    return html`<div class="file">
      <header>
        ${icon("file")}<code title=${change.path}>${change.path}</code>
        ${change.create === undefined ? html`<button class="ghost small" @click=${open}>Open</button>` : html`<span class="state">New file</span>`}
        ${change.edits && pending.length > 1 ? html`<button class="small" @click=${() => pending.forEach((s) => this.decide(s, true))}>Accept ${pending.length}</button>` : nothing}
      </header>
      ${change.reason ? html`<div class="reason">${change.reason}</div>` : nothing}
      ${change.create !== undefined
        ? html`<pre>${change.create}</pre>
            <div class="row">${this.renderDecision(suggestions[0])}</div>`
        : suggestions.map((s) => this.renderEdit(s as Suggestion & { edit: Edit }))}
    </div>`;
  }

  private renderItem(item: ChatItem) {
    switch (item.kind) {
      case "user":
        return html`<div class="msg user">${item.label ? html`<span class="label">${item.label}</span>` : item.text}</div>`;
      case "assistant":
        return html`${item.text ? html`<div class="msg assistant">${item.text}</div>` : nothing}
          ${item.error ? html`<div class="error">${item.error}</div>` : nothing}`;
      case "tool":
        return html`<div class="tool ${item.status === "error" ? "error" : ""}">
            ${item.status === "running" ? "⋯" : item.status === "error" ? "✕" : "✓"} ${item.name}${toolHint(item)}${item.status === "error" && item.summary ? html` — ${item.summary}` : nothing}
          </div>
          ${postSuggestions(item).map((s) => this.renderEdit(s as Suggestion & { edit: Edit }))}
          ${item.changes?.map((change) => this.renderFile(item.callId, change))}`;
    }
  }

  private renderDialog() {
    const custom = this.custom.filter((a) => !BUILTIN_IDS.has(a.id));
    return html`<dialog id="actions-dialog" closedby="any" aria-labelledby="actions-title" @click=${lightDismiss} @close=${() => (this.editing = undefined)}>
      <form @submit=${this.saveAction}>
        <h3 id="actions-title">Your edits</h3>
        <p class="muted">An edit is a saved instruction the assistant runs on the open post, or across the whole site. It can read posts, search your past posts and the web, and propose changes for you to accept.</p>
        ${custom.length
          ? html`<div class="list">
              ${custom.map(
                (a) => html`<div class="row">
                  <span>${a.name}${a.scope === "site" ? html` <span class="muted">· whole site</span>` : nothing}</span>
                  <button type="button" class="ghost small" @click=${() => (this.editing = a)}>Edit</button>
                  <button type="button" class="ghost small danger" @click=${() => this.deleteAction(a)}>Delete</button>
                </div>`,
              )}
            </div>`
          : nothing}
        <label>Name <input name="name" required .value=${this.editing?.name ?? ""} /></label>
        <label>Runs on
          <select name="scope">
            <option value="post" ?selected=${(this.editing ? (this.editing.scope ?? "post") : this.scope) === "post"}>The open post</option>
            <option value="site" ?selected=${(this.editing ? (this.editing.scope ?? "post") : this.scope) === "site"}>The whole site</option>
          </select>
        </label>
        <label>Instruction <textarea name="prompt" required .value=${this.editing?.prompt ?? ""} placeholder="e.g. Rewrite every heading as a question the section answers."></textarea></label>
        <div class="buttons">
          <button type="button" @click=${() => ((this.editing = undefined), this.dialog?.close())}>Close</button>
          <button class="primary" type="submit">${this.editing ? "Save changes" : "Add edit"}</button>
        </div>
      </form>
    </dialog>`;
  }

  render() {
    const view = this.connection?.view;
    const busy = view?.busy ?? false;
    const pending = view ? this.pendingSuggestions(view.items) : [];
    const site = this.scope === "site";
    const skills = skillsFor(this.skills, this.scope);
    const grouped = groupBy(this.models, (m) => m.provider);
    return html`
      <div class="bar">
        <div class="seg" role="group" aria-label="Assistant scope">
          <button aria-pressed=${!site} ?disabled=${!this.hasPost} title=${this.hasPost ? "Work on the open post" : "Open a post first"} @click=${() => this.setScope("post")}>Post</button>
          <button aria-pressed=${site} title="Work across every post on the site" @click=${() => this.setScope("site")}>Site</button>
        </div>
        <span class="dot ${this.connection?.status ?? "closed"}" title=${this.connection?.status ?? "not connected"}></span>
        <select aria-label="Model" @change=${(e: Event) => this.dispatchEvent(new CustomEvent("model-change", { detail: (e.target as HTMLSelectElement).value }))}>
          ${this.models.length ? nothing : html`<option value="">No models configured</option>`}
          ${[...grouped].map(
            ([provider, models]) => html`<optgroup label=${provider}>
              ${models.map((m) => html`<option value=${`${m.provider}/${m.modelId}`} ?selected=${this.model === `${m.provider}/${m.modelId}`}>${m.name}</option>`)}
            </optgroup>`,
          )}
        </select>
        ${busy
          ? html`<button @click=${() => this.connection?.abort()}>${icon("stop")} Stop</button>`
          : html`<button class="ghost" title="Start a new conversation" ?disabled=${!view?.items.length} @click=${() => this.connection?.reset()}>New chat</button>`}
      </div>
      <div class="actions" role="group" aria-label="Edits">
        <span class="kind">Edits</span>
        ${[...this.actions, ...this.extensionActions.filter((a) => (a.scope ?? "post") === this.scope)].map((a) => html`<button ?disabled=${busy || !this.connection} title=${`${a.prompt}\n\nText in the message box is sent with it.`} @click=${() => this.runAction(a)}>${a.name}</button>`)}
        <button class="ghost" @click=${() => this.dialog?.showModal()}>${icon("plus")} Your edits</button>
      </div>
      <div class="actions skills" role="group" aria-label="Skills">
        <span class="kind">Skills</span>
        <button class="ghost" title="Browse, install and manage skills" @click=${() => this.skillsDialog?.show()}>${icon("plus")} All skills (${skills.length})</button>
        ${skills.map(
              (s) => html`<button
                class="skill"
                ?disabled=${busy || !this.connection}
                title=${`${s.description}${s.source === "site" ? " (from the site folder)" : ""}`}
                @click=${() => this.send(skillPrompt(s), skillTitle(s))}
              >
                ${icon("sparkles")} ${skillTitle(s)}
              </button>`,
        )}
      </div>
      <skills-dialog .skills=${skills} .manager=${this.skillManager} ?disabled=${busy || !this.connection} @run-skill=${(e: CustomEvent<Skill>) => this.send(skillPrompt(e.detail), skillTitle(e.detail))}></skills-dialog>
      <div class="log" aria-live="polite">
        ${this.configError ? html`<div class="empty error">${this.configError}</div>` : nothing}
        ${!view?.items.length && !this.configError
          ? html`<div class="empty">${icon("sparkles")}<span>${site
              ? "Ask about the whole site, or run a site edit or skill above. To research something, type the topic below and press Research. Changes come back grouped by file, and nothing is written until you accept it."
              : "Ask about this post, or run an edit or skill above. Changes come back as suggestions you accept or reject."}</span></div>`
          : nothing}
        ${view?.items.map((item) => this.renderItem(item))}
        ${view?.partial ? html`<div class="msg assistant partial">${view.partial}</div>` : nothing}
        ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
      </div>
      ${pending.length > 1
        ? html`<div class="bulk">
            ${pending.length} suggestions
            <span class="spacer"></span>
            <button class="small" @click=${() => pending.forEach((s) => this.decide(s, true))}>Accept all</button>
            <button class="small" @click=${() => pending.forEach((s) => this.decide(s, false))}>Reject all</button>
          </div>`
        : nothing}
      <form class="input" @submit=${this.submit}>
        <textarea placeholder=${busy ? "Queued until the current answer finishes…" : site ? "Ask about the whole site…" : "Ask about this post…"} aria-label="Message" @keydown=${this.onInputKey}></textarea>
        <button class="primary icon-only" type="submit" aria-label="Send" title="Send (Enter)" ?disabled=${!this.connection}>${icon("send")}</button>
      </form>
      ${view?.usage ? html`<div class="usage">${view.usage.tokens.toLocaleString()} tokens · $${view.usage.cost.toFixed(4)}</div>` : nothing}
      ${this.renderDialog()}
    `;
  }
}

function postSuggestions(item: Extract<ChatItem, { kind: "tool" }>): Suggestion[] {
  return (item.edits ?? []).map((edit, i) => ({ key: `${item.callId}#${i}`, edit }));
}

function fileSuggestions(callId: string, change: FileChange): Suggestion[] {
  if (change.create !== undefined) return [{ key: `${callId}#${change.path}#create`, path: change.path, create: change.create }];
  return (change.edits ?? []).map((edit, i) => ({ key: `${callId}#${change.path}#${i}`, path: change.path, edit }));
}

function toolHint(item: Extract<ChatItem, { kind: "tool" }>) {
  const args = item.args as Record<string, unknown> | undefined;
  const hint = args?.query ?? args?.url ?? args?.path;
  return typeof hint === "string" ? ` ${hint}` : "";
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-panel": AgentPanel;
  }
}
