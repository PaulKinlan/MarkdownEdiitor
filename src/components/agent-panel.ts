import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ChatItem, Edit, ModelInfo } from "../shared/protocol";
import { editDecisions, type AgentLink } from "../lib/agent-client";
import { BUILTIN_ACTIONS, loadCustomActions, saveCustomActions, type EditAction } from "../lib/actions";
import { diffWords } from "../lib/diff";
import { controls } from "./shared";

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
      .bar { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--border); }
      .bar select { flex: 1; min-width: 0; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fg-2); flex: none; }
      .dot.open { background: var(--ok); }
      .dot.closed { background: var(--danger); }
      .actions { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--border); }
      .actions button { font-size: 12px; padding: 2px 8px; }
      .log { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
      .msg { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
      .user { align-self: flex-end; background: color-mix(in srgb, var(--accent) 14%, transparent); padding: 6px 10px; border-radius: 10px; max-width: 90%; }
      .user .label { font-weight: 600; }
      .assistant { padding: 0 2px; }
      .assistant.partial { color: var(--fg-2); }
      .error { color: var(--danger); font-size: 13px; }
      .tool { font-size: 12px; color: var(--fg-2); font-family: var(--mono); }
      .tool.error { color: var(--danger); }
      .edit { border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); padding: 6px 8px; display: grid; gap: 4px; }
      .edit.accepted { border-color: var(--ok); opacity: 0.7; }
      .edit.rejected, .edit.stale { opacity: 0.55; }
      .edit .text { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .edit del { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
      .edit ins { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); text-decoration: none; }
      .edit .reason { font-size: 12px; color: var(--fg-2); }
      .edit .row { display: flex; gap: 6px; align-items: center; }
      .edit .row button { font-size: 12px; padding: 1px 8px; }
      .edit .state { font-size: 12px; color: var(--fg-2); margin-left: auto; }
      .bulk { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--border); align-items: center; font-size: 12px; }
      form.input { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border); }
      form.input textarea { flex: 1; resize: none; min-height: 2.6em; max-height: 10em; field-sizing: content; }
      .empty { color: var(--fg-2); padding: 16px; line-height: 1.6; }
      .usage { font-size: 11px; color: var(--fg-2); }
      dialog { border: 1px solid var(--border); border-radius: 10px; background: var(--bg); color: var(--fg); padding: 20px; width: min(560px, 92vw); }
      dialog::backdrop { background: rgb(0 0 0 / 0.35); }
      dialog form { display: grid; gap: 10px; }
      dialog label { display: grid; gap: 4px; font-size: 13px; color: var(--fg-2); }
      dialog textarea { min-height: 8em; resize: vertical; }
      dialog .list { display: grid; gap: 4px; max-height: 30vh; overflow-y: auto; }
      dialog .list .row { display: flex; gap: 6px; align-items: center; }
      dialog .list .row span { flex: 1; }
      dialog .buttons { display: flex; gap: 8px; justify-content: flex-end; }
    `,
  ];

  @property({ attribute: false }) connection?: AgentLink;
  @property({ attribute: false }) models: ModelInfo[] = [];
  @property() model = "";
  @property() configError = "";

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
          ? html`<button class="primary" @click=${() => this.decide(key, edit, true)}>Accept</button>
              <button @click=${() => this.decide(key, edit, false)}>Reject</button>`
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
    return html`<dialog id="actions-dialog">
      <form @submit=${this.saveAction}>
        <h3>Your edits</h3>
        <p class="muted">An edit is a saved instruction the assistant runs on the open post. It can read the post, search your past posts and the web, and propose changes for you to accept.</p>
        ${custom.length
          ? html`<div class="list">
              ${custom.map(
                (a) => html`<div class="row">
                  <span>${a.name}</span>
                  <button type="button" @click=${() => (this.editing = a)}>Edit</button>
                  <button type="button" @click=${() => this.deleteAction(a)}>Delete</button>
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
          ? html`<button @click=${() => this.connection?.abort()}>Stop</button>`
          : html`<button class="ghost" title="Start a new conversation" ?disabled=${!view?.items.length} @click=${() => this.connection?.reset()}>New chat</button>`}
      </div>
      <div class="actions">
        ${this.actions.map((a) => html`<button ?disabled=${busy || !this.connection} title=${a.prompt} @click=${() => this.send(a.prompt, a.name)}>${a.name}</button>`)}
        <button class="ghost" @click=${() => this.dialog?.showModal()}>+ Your edits</button>
      </div>
      <div class="log" aria-live="polite">
        ${this.configError ? html`<div class="empty error">${this.configError}</div>` : nothing}
        ${!view?.items.length && !this.configError
          ? html`<div class="empty">Ask about this post, or run an edit above. Changes come back as suggestions you accept or reject.</div>`
          : nothing}
        ${view?.items.map((item) => this.renderItem(item))}
        ${view?.partial ? html`<div class="msg assistant partial">${view.partial}</div>` : nothing}
        ${this.error ? html`<div class="error" role="alert">${this.error}</div>` : nothing}
      </div>
      ${pending.length > 1
        ? html`<div class="bulk">
            ${pending.length} suggestions
            <button @click=${() => pending.forEach(({ key, edit }) => this.decide(key, edit, true))}>Accept all</button>
            <button @click=${() => pending.forEach(({ key, edit }) => this.decide(key, edit, false))}>Reject all</button>
          </div>`
        : nothing}
      <form class="input" @submit=${this.submit}>
        <textarea placeholder=${busy ? "Queued until the current answer finishes…" : "Ask about this post…"} aria-label="Message" @keydown=${this.onInputKey}></textarea>
        <button class="primary" type="submit" ?disabled=${!this.connection}>Send</button>
      </form>
      ${view?.usage ? html`<div class="usage bulk">${view.usage.tokens.toLocaleString()} tokens · $${view.usage.cost.toFixed(4)}</div>` : nothing}
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
