import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";

/**
 * A scripted model for local development and end-to-end tests without API
 * keys (enabled with DEMO_MODEL=1). It reads the post and proposes deleting
 * the first "very " or "really " it finds, which exercises the whole loop:
 * tool calls, streaming, edit proposals, and the editor's review UI. In the
 * site assistant it lists the posts, reads the newest, and proposes the same
 * edit as a file change (or a new note when there is nothing to tighten).
 * A prompt like `/tool list_claims {}` calls that tool instead (for trying
 * extension tools), and the answer quotes the start of its result.
 */
/** Tools the script itself calls; results of any other tool came from a `/tool` prompt. */
const SCRIPTED = new Set(["read_post", "list_posts", "propose_edits", "propose_changes"]);

export function addDemoModel(models: MutableModels) {
  const faux = fauxProvider({ tokensPerSecond: 120 });
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond]);
    const last = context.messages.at(-1) as { role: string; toolName?: string; content?: string | { type: string; text?: string }[] } | undefined;
    const result = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((b) => b.text ?? "").join("");
    // Tool declarations travel in the system messages; the site agent is the one with propose_changes.
    const site = context.messages.some((m) => (m.role as string) === "system" && JSON.stringify(m).includes("propose_changes"));
    if (last?.role === "user") {
      const tool = result.trim().match(/^\/tool ([\w-]+)\s*(\{[\s\S]*\})?$/);
      if (tool) {
        let args = {};
        try {
          args = tool[2] ? JSON.parse(tool[2]) : {};
        } catch {
          return fauxAssistantMessage([fauxText("The arguments after the tool name must be JSON.")]);
        }
        return fauxAssistantMessage([fauxToolCall(tool[1], args)], { stopReason: "toolUse" });
      }
    }
    if (last?.role === "toolResult" && !SCRIPTED.has(last.toolName ?? "")) {
      return fauxAssistantMessage([fauxText(`${last.toolName} said:\n\n${result.slice(0, 400)}`)]);
    }
    if (site && last?.role === "toolResult" && last.toolName === "list_posts") {
      const path = result.match(/\[([^\]\n]+\.md)\]/)?.[1];
      if (!path) return fauxAssistantMessage([fauxText("This site has no posts in the index yet.")]);
      return fauxAssistantMessage([fauxText(`Reading ${path}.`), fauxToolCall("read_post", { path })], { stopReason: "toolUse" });
    }
    if (last?.role === "toolResult" && last.toolName === "read_post") {
      const path = site ? result.slice(0, result.indexOf(":")) : "";
      const text = result
        .split("\n")
        .slice(2)
        .map((l) => l.replace(/^\s*\d+\| /, ""))
        .join("\n");
      const hit = text.match(/[^\n]{0,30}\b(very|really) [^\n]{0,30}/i);
      if (site) {
        const change: Record<string, string | { find: string; replace: string }[]> = hit
          ? { path, reason: "intensifier adds nothing", edits: [{ find: hit[0], replace: hit[0].replace(/\b(very|really) /i, "") }] }
          : { path: "notes/demo-idea.md", reason: "an idea to follow up", create: `---\ntitle: Follow up on ${path}\nstatus: idea\ntags: []\n---\n\n## Sources\n\n## Notes\n\n- What changed since this was written?\n` };
        return fauxAssistantMessage([fauxText("Here is a change for your review."), fauxToolCall("propose_changes", { changes: [change] })], { stopReason: "toolUse" });
      }
      if (!hit) return fauxAssistantMessage([fauxText("I read the post and found nothing to tighten.")]);
      const find = hit[0];
      const replace = find.replace(/\b(very|really) /i, "");
      return fauxAssistantMessage([fauxText("One intensifier can go."), fauxToolCall("propose_edits", { edits: [{ find, replace, reason: "intensifier adds nothing" }] })], { stopReason: "toolUse" });
    }
    if (last?.role === "toolResult") return fauxAssistantMessage([fauxText("Sent for your review.")]);
    if (site) return fauxAssistantMessage([fauxText("Looking across the site."), fauxToolCall("list_posts", { limit: 5 })], { stopReason: "toolUse" });
    return fauxAssistantMessage([fauxText("Reading the post first."), fauxToolCall("read_post", {})], { stopReason: "toolUse" });
  };
  faux.setResponses([respond]);
  models.setProvider(faux.provider);
}
