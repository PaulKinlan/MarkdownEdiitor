import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { skillTitle, type Skill } from "../shared/skills";
import { originLabel } from "../lib/skill-install";
import { controls, lightDismiss } from "./shared";
import { icon } from "./icons";

export type InstallTarget = "site" | "browser";

/** What the app does for the dialog: it owns the site folder and the browser's skill store. */
export interface SkillManager {
  /** Installs every skill at a GitHub source; returns the installed names. */
  install(source: string, target: InstallTarget): Promise<string[]>;
  update(skill: Skill): Promise<void>;
  remove(skill: Skill): Promise<void>;
  /** Whether a site folder is open, so skills can be installed into it. */
  hasSite: boolean;
}

/**
 * Every skill the assistant has, to run one or manage them, and a form to
 * install more from GitHub. Fires `run-skill` with the skill to run.
 */
@customElement("skills-dialog")
export class SkillsDialog extends LitElement {
  static styles = [
    controls,
    css`
      dialog { width: min(640px, 94vw); max-height: min(720px, 90vh); padding: 0; display: none; flex-direction: column; }
      dialog[open] { display: flex; }
      header, .install, footer { padding: 12px 16px; display: grid; gap: 8px; }
      header { border-bottom: 1px solid var(--border); }
      header h3 { margin: 0; }
      .install { border-top: 1px solid var(--border); }
      .install form { display: flex; gap: 6px; flex-wrap: wrap; }
      .install input[type="text"], .install input:not([type]) { flex: 1 1 220px; }
      .install .where { display: flex; gap: 12px; font-size: 13px; color: var(--fg-2); flex-wrap: wrap; }
      .install .where label { display: inline-flex; gap: 4px; align-items: center; }
      .status { font-size: 13px; color: var(--fg-2); }
      .status.error { color: var(--danger); }
      ul { list-style: none; margin: 0; padding: 4px 8px; overflow-y: auto; flex: 1; min-height: 120px; }
      li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 8px; border-radius: var(--radius); }
      li:hover { background: var(--hover); }
      li .name { font-weight: 600; font-size: 13px; display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; }
      li .badge { font-weight: 500; font-size: 11px; color: var(--fg-2); border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; }
      li .desc { grid-column: 1; font-size: 12px; color: var(--fg-2); line-height: 1.45; }
      li .row { grid-row: 1 / span 2; grid-column: 2; display: flex; gap: 4px; align-items: center; }
      footer { border-top: 1px solid var(--border); display: flex; justify-content: flex-end; }
    `,
  ];

  @property({ attribute: false }) skills: Skill[] = [];
  @property({ attribute: false }) manager?: SkillManager;
  @property({ type: Boolean }) disabled = false;

  @state() private filter = "";
  @state() private busy = "";
  @state() private status = "";
  @state() private failed = false;

  @query("dialog") private dialog?: HTMLDialogElement;

  show() {
    this.status = "";
    this.dialog?.showModal();
  }

  private run(skill: Skill) {
    this.dialog?.close();
    this.dispatchEvent(new CustomEvent("run-skill", { detail: skill, bubbles: true, composed: true }));
  }

  private async act(label: string, work: () => Promise<string>) {
    this.busy = label;
    this.failed = false;
    this.status = `${label}…`;
    try {
      this.status = await work();
    } catch (e) {
      this.failed = true;
      this.status = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = "";
    }
  }

  private install(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const source = String(data.get("source") ?? "").trim();
    const target = (data.get("target") as InstallTarget) ?? "browser";
    if (!source || !this.manager) return;
    void this.act("Installing", async () => {
      const names = await this.manager!.install(source, target);
      form.reset();
      return `Installed ${names.join(", ")}${target === "site" ? " into this site's .agents/skills folder" : " for all sites in this browser"}.`;
    });
  }

  private sourceBadge(skill: Skill) {
    if (skill.source === "site") return html`<span class="badge" title=${skill.folder ?? ""}>site</span>`;
    if (skill.source === "installed") return html`<span class="badge">this browser</span>`;
    if (skill.source?.startsWith("extension:")) return html`<span class="badge">${skill.source.slice(10)}</span>`;
    return nothing;
  }

  render() {
    const q = this.filter.toLowerCase();
    const shown = this.skills.filter((s) => !q || `${s.name} ${skillTitle(s)} ${s.description}`.toLowerCase().includes(q));
    const canInstall = !!this.manager;
    return html`<dialog closedby="any" aria-labelledby="skills-title" @click=${lightDismiss}>
      <header>
        <h3 id="skills-title">Skills</h3>
        <p class="muted">Skills are instructions the assistant loads when a task needs them. Run one on this post, or just ask for it in chat.</p>
        <input type="search" placeholder="Filter skills" aria-label="Filter skills" .value=${this.filter} @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)} />
      </header>
      <ul>
        ${shown.map(
          (s) => html`<li>
            <span class="name">${skillTitle(s)} ${this.sourceBadge(s)} ${s.origin ? html`<span class="badge" title="Installed from GitHub">${originLabel(s.origin)}</span>` : nothing}</span>
            <span class="desc">${s.description}</span>
            <span class="row">
              ${s.origin && canInstall
                ? html`<button class="ghost small" ?disabled=${!!this.busy} title="Download the latest version" aria-label=${`Update ${s.name}`} @click=${() => this.act("Updating", async () => (await this.manager!.update(s), `Updated ${s.name}.`))}>${icon("refresh")}</button>`
                : nothing}
              ${(s.source === "site" || s.source === "installed") && canInstall
                ? html`<button
                    class="ghost small danger"
                    ?disabled=${!!this.busy}
                    @click=${() => confirm(`Remove the ${s.name} skill${s.source === "site" ? ` (deletes ${s.folder})` : ""}?`) && this.act("Removing", async () => (await this.manager!.remove(s), `Removed ${s.name}.`))}
                  >
                    Remove
                  </button>`
                : nothing}
              <button class="small" ?disabled=${this.disabled} @click=${() => this.run(s)}>Run</button>
            </span>
          </li>`,
        )}
        ${shown.length ? nothing : html`<li class="muted">No skills match.</li>`}
      </ul>
      ${canInstall
        ? html`<section class="install">
            <form @submit=${this.install}>
              <input name="source" required placeholder="owner/repo or a github.com link to a skill folder" aria-label="GitHub repo or folder" ?disabled=${!!this.busy} />
              <button class="primary" type="submit" ?disabled=${!!this.busy}>${icon("plus")} Install</button>
              <div class="where" role="radiogroup" aria-label="Install for">
                <label><input type="radio" name="target" value="site" ?checked=${this.manager!.hasSite} ?disabled=${!this.manager!.hasSite} /> This site (saved in the folder, so git tracks it)</label>
                <label><input type="radio" name="target" value="browser" ?checked=${!this.manager!.hasSite} /> All my sites (this browser)</label>
              </div>
            </form>
            <div class="status">A skill is instructions the assistant follows, so install ones from people you trust. Edits still come to you for review.</div>
            ${this.status ? html`<div class="status ${this.failed ? "error" : ""}" role="status">${this.status}</div>` : nothing}
          </section>`
        : nothing}
      <footer><button @click=${() => this.dialog?.close()}>Close</button></footer>
    </dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "skills-dialog": SkillsDialog;
  }
}
