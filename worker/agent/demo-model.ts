import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall, type FauxResponseFactory } from "@earendil-works/pi-ai";
import type { MutableModels } from "@earendil-works/pi-ai/models";

/**
 * A scripted model for local development and end-to-end tests without API
 * keys (enabled with DEMO_MODEL=1). It reads the post and proposes deleting
 * the first "very " or "really " it finds, which exercises the whole loop:
 * tool calls, streaming, edit proposals, and the editor's review UI.
 */
export function addDemoModel(models: MutableModels) {
  const faux = fauxProvider({ tokensPerSecond: 120 });
  const respond: FauxResponseFactory = (context) => {
    faux.appendResponses([respond]);
    const last = context.messages.at(-1) as { role: string; toolName?: string; content?: { type: string; text?: string }[] } | undefined;
    if (last?.role === "toolResult" && last.toolName === "read_post") {
      const text = (last.content ?? [])
        .map((b) => b.text ?? "")
        .join("")
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
    if (last?.role === "toolResult") return fauxAssistantMessage([fauxText("Sent for your review.")]);
    return fauxAssistantMessage([fauxText("Reading the post first."), fauxToolCall("read_post", {})], { stopReason: "toolUse" });
  };
  faux.setResponses([respond]);
  models.setProvider(faux.provider);
}
