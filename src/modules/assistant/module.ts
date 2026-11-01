import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { defineModule, type ShellChange } from "../../core/modules";
import { BUILTIN_ACTIONS, loadCustomActions, type ActionScope, type EditAction } from "../../lib/actions";
import { BUILTIN_SKILLS } from "../../shared/builtin-skills";
import { mergeSkills } from "../../shared/skills";
import type { Edit } from "../../shared/protocol";
import { apiUrl } from "../../lib/agent-client";
import { Assistant, SITE_RULE_FILES } from "./assistant";
import type { ToolsSettings } from "./tools-settings";

// The assistant: the post's and the site's conversations in the side panel,
// its settings, the tools dialog and the palette's quick edits. It provides
// the `prompt` and `agentServer` services that WebMCP and extensions use.
export default defineModule({
  id: "assistant",
  name: "Assistant",
  order: 20,
  activate({ shell, addSideTab, addSettingsSection, addDialog, addCommands, setStatus, provide }) {
    const assistant = new Assistant(shell, setStatus);
    const onChange = (e: Event) => assistant.onShellChange((e as ShellChange).detail);
    const onExtensionsChange = () => assistant.onExtensionsChange();
    shell.addEventListener("change", onChange);
    shell.extensions.addEventListener("change", onExtensionsChange);
    provide("prompt", (text, label) => assistant.prompt(text, label));
    provide("agentServer", () => (assistant.serverUp ? assistant.settings : undefined));

    const quickEdits = () => shell.extensions.host.quickEdits.map((e): EditAction => ({ id: `${e.extension}:${e.spec.id}`, name: e.spec.name, prompt: e.spec.prompt }));

    addSideTab({
      id: "assistant",
      title: "Assistant",
      order: 20,
      icon: "sparkles",
      render: () => {
        // Loaded the first time the tab shows, to keep it out of the boot bundle; the element upgrades when it arrives.
        void import("./agent-panel");
        const site = assistant.scope === "site";
        return html`<agent-panel
          .connection=${site ? assistant.siteConnection : assistant.connection}
          .models=${site ? assistant.siteModels : assistant.models}
          .model=${site ? assistant.siteModel : (assistant.settings.model ?? "")}
          .configError=${site && !assistant.serverUp && !assistant.error ? "The site assistant needs the agent server (Assistant settings)." : assistant.error}
          .scope=${assistant.scope}
          .hasPost=${!!shell.open}
          @scope-change=${(e: CustomEvent<ActionScope>) => assistant.setScope(e.detail)}
          .skills=${mergeSkills(BUILTIN_SKILLS, assistant.extraSkills())}
          .skillManager=${assistant.skillManager()}
          @model-change=${(e: CustomEvent<string>) => assistant.setModel(e.detail)}
          @apply-edit=${(e: CustomEvent<{ edit: Edit; done: (ok: boolean) => void }>) => e.detail.done(shell.applyEdit(e.detail.edit))}
          .extensionActions=${quickEdits()}
          .server=${assistant.serverUp ? assistant.settings : undefined}
          @apply-file-change=${(e: CustomEvent<{ path: string; edit?: Edit; create?: string; done: (ok: boolean) => void }>) => {
            const { path, edit, create, done } = e.detail;
            assistant.applyFileChange(path, edit, create).then(done, (err) => {
              shell.fail(`Couldn't change ${path}: ${err instanceof Error ? err.message : String(err)}`);
              done(false);
            });
          }}
          @open-path=${async (e: CustomEvent<string>) => {
            const problem = await shell.openPath(e.detail);
            if (problem) shell.fail(problem);
          }}
        ></agent-panel>`;
      },
    });

    // Loaded on first use, to keep it out of the boot bundle.
    let tools: ToolsSettings | undefined;
    const showTools = async () => {
      await import("./tools-settings");
      tools?.show();
    };
    addDialog(
      () => html`<tools-settings
        ${ref((el) => (tools = el as ToolsSettings | undefined))}
        .agentSettings=${assistant.settings}
        ?webSearch=${assistant.serverWebSearch}
      ></tools-settings>`,
    );

    addSettingsSection({
      id: "assistant",
      order: 70,
      render: () => html`<h4>Assistant</h4>
        <label>Agent server <input placeholder="This site" .value=${assistant.settings.server} @change=${(e: Event) => assistant.updateSettings({ server: (e.target as HTMLInputElement).value.trim().replace(/\/$/, "") })} /></label>
        <label>Access token <input type="password" autocomplete="off" .value=${assistant.settings.token} @change=${(e: Event) => assistant.updateSettings({ token: (e.target as HTMLInputElement).value.trim() })} /></label>
        <div><button type="button" ?disabled=${!assistant.serverUp} @click=${showTools}>Tools and MCP servers…</button></div>
        ${assistant.serverUp && shell.site && shell.config ? mcpAddress(apiUrl(assistant.settings, `/api/mcp/sites/${encodeURIComponent(shell.site.id)}`), shell.config.contentDir) : nothing}
        <p class="muted">Writing rules sent to the assistant: ${assistant.siteInstructions ? SITE_RULE_FILES.join(" / ") + " from the site folder" : html`none (add a <code>CLAUDE.md</code> or <code>AGENTS.md</code> to the site root)`}.</p>`,
    });

    // The post assistant's quick edits, as "Assistant: …" in the command palette.
    addCommands(() => {
      if (!shell.open) return [];
      const edits = [...BUILTIN_ACTIONS, ...loadCustomActions().filter((a) => (a.scope ?? "post") === "post"), ...quickEdits()];
      return edits.map((a) => ({
        id: `edit:${a.name}`,
        title: `Assistant: ${a.name}`,
        run: () => {
          const problem = assistant.prompt(a.prompt, a.name);
          if (problem) shell.fail(problem);
        },
      }));
    });

    return () => {
      shell.removeEventListener("change", onChange);
      shell.extensions.removeEventListener("change", onExtensionsChange);
      assistant.dispose();
    };
  },
});

/** Where other agents (Claude Code, Gemini CLI) can reach this site's posts over MCP (worker/routes/mcp.ts). */
function mcpAddress(url: URL, contentDir: string) {
  if (contentDir !== "content") url.searchParams.set("contentDir", contentDir);
  const address = url.toString();
  return html`<p class="muted">
    Other agents can search and read this site's posts over MCP at <code>${address}</code>, with the access token as a Bearer token.
    <button type="button" class="small" @click=${() => void navigator.clipboard.writeText(address)}>Copy</button>
  </p>`;
}
