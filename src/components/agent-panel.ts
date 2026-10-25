import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ChatItem, Edit, ModelInfo } from "../shared/protocol";
import { editDecisions, type AgentLink } from "../lib/agent-client";
import { BUILTIN_ACTIONS, loadCustomActions, saveCustomActions, type EditAction } from "../lib/actions";
import { diffWords } from "../lib/diff";
import { skillPrompt, skillTitle, type Skill } from "../shared/skills";
import { controls, lightDismiss } from "./shared";
import { icon } from "./icons";

type EditState = "pending" | "accepted" | "rejected" | "stale";

/**
 * The assistant: a chat with the post's agent session, one-click edits, and a
 * review list for the find/replace edits the agent proposes. Applying an edit
 * is the app's job (`apply-edit` event), since the app owns the post text.
 */
@customElement("agent-panel")
export class AgentPanel extends LitElement {
  static styles = [
    controls,
    css`
      :host { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg-2); }
      .bar { display: flex; gap: 6px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border); }
      .bar select { flex: 1; min-width: 0; font-size: 13px; }
      .dot.open { background: var(--ok); }
      .dot.connecting { background: var(--warn); }
      .dot.closed { background: var(--danger); }
      .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); }
      .actions button { min-height: 24px; padding: 0 10px; font-size: 12px; border-radius: 999px; }
      .actions + .actions { padding-top: 0; margin-top: -1px; }
      .actions .kind { font-size: 11px; color: var(--fg-2); align-self: center; min-width: 3.2em; }
      .actions button.skill .icon { width: 12px; height: 12px; color: var(--accent); }
      .log { flex: 1; overflow-y: auto; padding: 14px 12px; display: flex; flex-direction: column; gap: 10px; }
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
  /** Built-in skills plus the site's own, run with one click. */
  @property({ attribute: false }) skills: Skill[] = [];

  @state() private actions: EditAction[] = [...BUILTIN_ACTIONS, ...loadCustomActions()];
  @state() private error = "";
  @state() private editing?: EditAction;

  @query(".log") private log?: HTMLElement;
  @query("#actions-dialog") private dialog?: HTMLDialogElement;

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

  private decide(key: string, edit: Edit, accept: boolean) {
    if (!accept) {
      this.setState(key, "rejected");
      return;
    }
    let applied = false;
    this.dispatchEvent(new CustomEvent("apply-edit", { detail: { edit, done: (ok: boolean) => (applied = ok) }, bubbles: true, composed: true }));
    this.setState(key, applied ? "accepted" : "stale");
  }

  /** Decisions live with the session, not the panel, which is recreated on tab and visibility changes. */
  private get editStates(): Map<string, EditState> {
    return (this.connection ? editDecisions(this.connection.id) : new Map()) as Map<string, EditState>;
  }

  private setState(key: string, state: EditState) {
    this.editStates.set(key, state);
    this.requestUpdate();
  }

  private pendingEdits(items: ChatItem[]) {
    const out: { key: string; edit: Edit }[] = [];
    for (const item of items) {
      if (item.kind !== "tool" || !item.edits) continue;
      item.edits.forEach((edit, i) => {
        const key = `${item.callId}#${i}`;
        if ((this.editStates.get(key) ?? "pending") === "pending") out.push({ key, edit });
      });
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
    const id = this.editing?.id || `custom-${crypto.randomUUID()}`;
    const custom = [...loadCustomActions().filter((a) => a.id !== id), { id, name, prompt }];
    saveCustomActions(custom);
    this.actions = [...BUILTIN_ACTIONS, ...custom];
    this.editing = undefined;
    (e.target as HTMLFormElement).reset();
  }

  private deleteAction(action: EditAction) {
    const custom = loadCustomActions().filter((a) => a.id !== action.id);
    saveCustomActions(custom);
    this.actions = [...BUILTIN_ACTIONS, ...custom];
  }

  private renderEdit(key: string, edit: Edit) {
    const s = this.editStates.get(key) ?? "pending";
    return html`<div class="edit ${s}">
      <div class="text">${diffWords(edit.find, edit.replace).map((p) => (p.type === "same" ? p.text : p.type === "del" ? html`<del>${p.text}</del>` : html`<ins>${p.text}</ins>`))}</div>
      ${edit.reason ? html`<div class="reason">${edit.reason}</div>` : nothing}
      <div class="row">
        ${s === "pending"
          ? html`<button class="primary small" @click=${() => this.decide(key, edit, true)}>Accept</button>
              <button class="small" @click=${() => this.decide(key, edit, false)}>Reject</button>`
          : html`<span class="state">${s === "stale" ? "No longer matches the post" : s}</span>`}
      </div>
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
          ${item.edits?.map((edit, i) => this.renderEdit(`${item.callId}#${i}`, edit))}`;
    }
  }

  private renderDialog() {
    const custom = this.actions.filter((a) => !BUILTIN_ACTIONS.some((b) => b.id === a.id));
    return html`<dialog id="actions-dialog" closedby="any" aria-labelledby="actions-title" @click=${lightDismiss} @close=${() => (this.editing = undefined)}>
      <form @submit=${this.saveAction}>
        <h3 id="actions-title">Your edits</h3>
        <p class="muted">An edit is a saved instruction the assistant runs on the open post. It can read the post, search your past posts and the web, and propose changes for you to accept.</p>
        ${custom.length
          ? html`<div class="list">
              ${custom.map(
                (a) => html`<div class="row">
                  <span>${a.name}</span>
                  <button type="button" class="ghost small" @click=${() => (this.editing = a)}>Edit</button>
                  <button type="button" class="ghost small danger" @click=${() => this.deleteAction(a)}>Delete</button>
                </div>`,
              )}
            </div>`
          : nothing}
        <label>Name <input name="name" required .value=${this.editing?.name ?? ""} /></label>
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
    const pending = view ? this.pendingEdits(view.items) : [];
    const grouped = groupBy(this.models, (m) => m.provider);
    return html`
      <div class="bar">
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
        ${this.actions.map((a) => html`<button ?disabled=${busy || !this.connection} title=${a.prompt} @click=${() => this.send(a.prompt, a.name)}>${a.name}</button>`)}
        <button class="ghost" @click=${() => this.dialog?.showModal()}>${icon("plus")} Your edits</button>
      </div>
      ${this.skills.length
        ? html`<div class="actions" role="group" aria-label="Skills">
            <span class="kind">Skills</span>
            ${this.skills.map(
              (s) => html`<button
                class="skill"
                ?disabled=${busy || !this.connection}
                title=${`${s.description}${s.source === "site" ? " (from the site folder)" : ""}`}
                @click=${() => this.send(skillPrompt(s), skillTitle(s))}
              >
                ${icon("sparkles")} ${skillTitle(s)}
              </button>`,
            )}
          </div>`
        : nothing}
      <div class="log" aria-live="polite">
        ${this.configError ? html`<div class="empty error">${this.configError}</div>` : nothing}
        ${!view?.items.length && !this.configError
          ? html`<div class="empty">${icon("sparkles")}<span>Ask about this post, or run an edit or skill above. Changes come back as suggestions you accept or reject.</span></div>`
          : nothing}
        ${view?.items.map((item) => this.renderItem(item))}
        ${view?.partial ? html`<div class="msg assistant partial">${view.partial}</div>` : nothing}
        ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
      </div>
      ${pending.length > 1
        ? html`<div class="bulk">
            ${pending.length} suggestions
            <span class="spacer"></span>
            <button class="small" @click=${() => pending.forEach(({ key, edit }) => this.decide(key, edit, true))}>Accept all</button>
            <button class="small" @click=${() => pending.forEach(({ key, edit }) => this.decide(key, edit, false))}>Reject all</button>
          </div>`
        : nothing}
      <form class="input" @submit=${this.submit}>
        <textarea placeholder=${busy ? "Queued until the current answer finishes…" : "Ask about this post…"} aria-label="Message" @keydown=${this.onInputKey}></textarea>
        <button class="primary icon-only" type="submit" aria-label="Send" title="Send (Enter)" ?disabled=${!this.connection}>${icon("send")}</button>
      </form>
      ${view?.usage ? html`<div class="usage">${view.usage.tokens.toLocaleString()} tokens · $${view.usage.cost.toFixed(4)}</div>` : nothing}
      ${this.renderDialog()}
    `;
  }
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
