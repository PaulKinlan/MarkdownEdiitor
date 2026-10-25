import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";

type Content = string | { type: string; text?: string }[];

const textOf = (content: Content | undefined) => (typeof content === "string" ? content : (content ?? []).map((b) => b.text ?? "").join(""));

/**
 * A scripted model for local development and end-to-end tests without API
 * keys (enabled with DEMO_MODEL=1). It reads the post and proposes deleting
 * the first "very " or "really " it finds, which exercises the whole loop:
 * tool calls, streaming, edit proposals, and the editor's review UI.
 * A prompt like `/tool list_claims {}` calls that tool instead (for trying
 * extension tools), and the answer quotes the start of its result.
 */
export function addDemoModel(models: MutableModels) {
  const faux = fauxProvider({ tokensPerSecond: 120 });
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond]);
    const last = context.messages.at(-1) as { role: string; toolName?: string; content?: Content } | undefined;
    if (last?.role === "toolResult" && last.toolName === "read_post") {
      const text = textOf(last.content)
        .split("\n")
        .slice(2)
        .map((l) => l.replace(/^\s*\d+\| /, ""))
        .join("\n");
      const hit = text.match(/[^\n]{0,30}\b(very|really) [^\n]{0,30}/i);
      if (!hit) return fauxAssistantMessage([fauxText("I read the post and found nothing to tighten.")]);
      const find = hit[0];
      const replace = find.replace(/\b(very|really) /i, "");
      return fauxAssistantMessage([fauxText("One intensifier can go."), fauxToolCall("propose_edits", { edits: [{ find, replace, reason: "intensifier adds nothing" }] })], { stopReason: "toolUse" });
    }
    if (last?.role === "toolResult" && last.toolName !== "propose_edits") {
      const result = textOf(last.content);
      return fauxAssistantMessage([fauxText(`${last.toolName} said:\n\n${result.slice(0, 400)}`)]);
    }
    if (last?.role === "toolResult") return fauxAssistantMessage([fauxText("Sent for your review.")]);
    const prompt = last?.role === "user" ? textOf(last.content) : "";
    const tool = prompt.trim().match(/^\/tool ([\w-]+)\s*(\{[\s\S]*\})?$/);
    if (tool) {
      let args = {};
      try {
        args = tool[2] ? JSON.parse(tool[2]) : {};
      } catch {
        return fauxAssistantMessage([fauxText("The arguments after the tool name must be JSON.")]);
      }
      return fauxAssistantMessage([fauxToolCall(tool[1], args)], { stopReason: "toolUse" });
    }
    return fauxAssistantMessage([fauxText("Reading the post first."), fauxToolCall("read_post", {})], { stopReason: "toolUse" });
  };
  faux.setResponses([respond]);
  models.setProvider(faux.provider);
}
