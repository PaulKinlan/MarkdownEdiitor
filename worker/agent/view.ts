import type { ChatItem, Edit, FileChange, ServerToClient } from "../../src/shared/protocol";

type Block = { type: string; text?: string; id?: string; name?: string; arguments?: unknown };
type Message = {
  role: string;
  content?: string | Block[];
  toolCallId?: string;
  details?: unknown;
  isError?: boolean;
  stopReason?: string;
  errorMessage?: string;
  provider?: string;
  model?: string;
};
type EntryLike = { id: number; kind: string; model?: Message[]; data?: unknown };
type LiveTool = { callId: string; name: string; status: string };
type ViewLike = {
  entries: readonly EntryLike[];
  docs: Record<string, unknown>;
};

/**
 * Projects a Pi Durable conversation view into the small chat model the
 * editor renders. Tool calls are paired with their results by call id.
 */
export function projectView(view: ViewLike): Extract<ServerToClient, { type: "view" }> {
  const items: ChatItem[] = [];
  const tools = new Map<string, Extract<ChatItem, { kind: "tool" }>>();

  for (const entry of view.entries) {
    const message = entry.model?.[0];
    if (!message) continue;
    if (entry.kind === "pi.user" || (message.role === "user" && !entry.kind.startsWith("pi."))) {
      const label = (entry.data as { label?: string } | undefined)?.label;
      items.push({ kind: "user", id: entry.id, text: textOf(message.content), ...(label ? { label } : {}) });
    } else if (entry.kind === "pi.assistant") {
      const text = textOf(message.content);
      const error = message.stopReason === "error" || message.stopReason === "aborted" ? message.errorMessage ?? message.stopReason : undefined;
      if (text || error) items.push({ kind: "assistant", id: entry.id, text, ...(error ? { error } : {}), model: message.model });
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block.type !== "toolCall" || !block.id) continue;
        const item: Extract<ChatItem, { kind: "tool" }> = { kind: "tool", id: entry.id, callId: block.id, name: block.name ?? "", args: block.arguments, status: "running" };
        tools.set(block.id, item);
        items.push(item);
      }
    } else if (entry.kind === "pi.tool-result" && message.toolCallId) {
      const item = tools.get(message.toolCallId);
      if (!item) continue;
      item.status = message.isError ? "error" : "done";
      item.summary = textOf(message.content).split("\n")[0]?.slice(0, 200);
      const details = message.details as { edits?: Edit[]; changes?: FileChange[] } | undefined;
      if (details?.edits?.length) item.edits = details.edits;
      if (details?.changes?.length) item.changes = details.changes;
    } else if (entry.kind === "pi.reset") {
      items.length = 0;
      tools.clear();
    }
  }

  const live = (view.docs["pi.live"] ?? {}) as { run?: unknown; generation?: { partial?: Message }; tools?: LiveTool[] };
  for (const t of live.tools ?? []) {
    const item = tools.get(t.callId);
    if (item && item.status === "running" && t.status === "done") item.status = "done";
  }
  const partial = live.generation?.partial ? textOf(live.generation.partial.content) : undefined;
  const usage = summariseUsage(view.docs["pi.usage"]);
  return { type: "view", items, busy: live.run !== undefined, ...(partial ? { partial } : {}), ...(usage ? { usage } : {}) };
}

function textOf(content: string | Block[] | undefined): string {
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

function summariseUsage(doc: unknown): { cost: number; tokens: number } | undefined {
  const models = (doc as { models?: Record<string, { totalTokens?: number; cost?: { total?: number } }> } | undefined)?.models;
  if (!models) return undefined;
  let cost = 0;
  let tokens = 0;
  for (const u of Object.values(models)) {
    cost += u.cost?.total ?? 0;
    tokens += u.totalTokens ?? 0;
  }
  return { cost, tokens };
}
