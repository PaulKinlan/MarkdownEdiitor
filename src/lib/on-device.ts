// Chrome's built-in AI: the Prompt API as a model in the assistant's picker,
// and the Summarizer API for drafting front matter summaries. Both run on the
// device, cost nothing, and work without the agent server.

import type { ChatItem, Edit, ModelInfo, PostContext } from "../shared/protocol";
import { BUILTIN_SKILLS } from "../shared/builtin-skills";
import { checkEdits } from "../shared/edits";
import { inlineSkill, mergeSkills } from "../shared/skills";
import type { AgentLink, ViewMessage } from "./agent-client";

export const ON_DEVICE_PROVIDER = "chrome";
const ON_DEVICE: ModelInfo = { provider: ON_DEVICE_PROVIDER, modelId: "on-device", name: "Chrome on-device model", reasoning: false, contextWindow: 0 };
const LANGUAGES = { expectedInputs: [{ type: "text" as const, languages: ["en"] }], expectedOutputs: [{ type: "text" as const, languages: ["en"] }] };
/** Rough characters per token, for trimming the post to fit the context window. */
const CHARS_PER_TOKEN = 3;
const REPLY_TOKENS = 1024;
const HISTORY_MESSAGES = 6;

/** The on-device model, if this browser has one (possibly still to download). */
export async function onDeviceModels(): Promise<ModelInfo[]> {
  if (typeof LanguageModel === "undefined") return [];
  try {
    return (await LanguageModel.availability(LANGUAGES)) === "unavailable" ? [] : [ON_DEVICE];
  } catch {
    return [];
  }
}

export function isOnDevice(model: string | undefined): boolean {
  return !!model?.startsWith(`${ON_DEVICE_PROVIDER}/`);
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    edits: {
      type: "array",
      maxItems: 15,
      items: {
        type: "object",
        properties: { find: { type: "string" }, replace: { type: "string" }, reason: { type: "string" } },
        required: ["find", "replace"],
      },
    },
  },
  required: ["reply", "edits"],
};

export function systemPrompt(post: PostContext): string {
  return [
    `You are an editing assistant for the blog "${post.siteName}". You help the author with the post they are writing.`,
    post.siteInstructions ? `The site's writing rules:\n${post.siteInstructions}` : "",
    `Answer in JSON with two fields. "reply" is your answer to the author, in plain text. "edits" lists changes to the post, each with "find" (text copied exactly from the post, long enough to appear only once), "replace" (the new text) and "reason". Keep each edit to a phrase or a sentence. Leave "edits" empty unless the author asks for changes. Never change code, URLs or Hugo shortcodes ({{< ... >}}) unless asked.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Cuts the post to `maxChars`, keeping the start, and says so. */
export function fitPost(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 60))}\n\n[The rest of the post is cut to fit. Only edit the text above.]`;
}

export function parseResponse(raw: string): { reply: string; edits: Edit[] } {
  try {
    const data = JSON.parse(raw) as { reply?: unknown; edits?: unknown };
    const edits = Array.isArray(data.edits)
      ? data.edits.filter((e): e is Edit => !!e && typeof e.find === "string" && typeof e.replace === "string")
      : [];
    return { reply: typeof data.reply === "string" ? data.reply : "", edits };
  } catch {
    return { reply: raw.trim(), edits: [] };
  }
}

interface Conversation {
  items: ChatItem[];
  history: LanguageModelMessage[];
  nextId: number;
}

// Kept per post across panel and connection changes, like the server's sessions (but only until the tab closes).
const conversations = new Map<string, Conversation>();

/**
 * An assistant conversation run by the Prompt API. No tools: it answers from
 * the post and proposes find/replace edits through structured output, which go
 * through the same accept/reject review as the server agent's edits.
 */
export class OnDeviceConnection extends EventTarget implements AgentLink {
  readonly status = "open" as const;
  view?: ViewMessage;
  private post?: PostContext;
  private queue: Promise<void> = Promise.resolve();
  private controller?: AbortController;
  private conversation: Conversation;
  private busy = false;
  private partial?: string;
  private closed = false;

  constructor(readonly id: string) {
    super();
    let conversation = conversations.get(id);
    if (!conversation) conversations.set(id, (conversation = { items: [], history: [], nextId: 1 }));
    this.conversation = conversation;
    this.publish();
  }

  updatePost(post: PostContext) {
    this.post = post;
  }

  prompt(text: string, _model: { provider: string; modelId: string }, label?: string) {
    const c = this.conversation;
    c.items.push({ kind: "user", id: c.nextId++, text, label });
    this.publish();
    this.queue = this.queue.then(() => this.run(text));
  }

  abort() {
    this.controller?.abort();
  }

  reset() {
    this.abort();
    this.conversation.items = [];
    this.conversation.history = [];
    this.publish();
  }

  close() {
    // The conversation outlives the connection; a running prompt and any queued ones stop.
    this.closed = true;
    this.abort();
  }

  private async run(text: string) {
    const post = this.post;
    const c = this.conversation;
    if (this.closed) {
      c.items.push({ kind: "assistant", id: c.nextId++, text: "", error: "Stopped." });
      return this.publish();
    }
    if (!post || typeof LanguageModel === "undefined") {
      c.items.push({ kind: "assistant", id: c.nextId++, text: "", error: "The on-device model isn't available in this browser." });
      return this.publish();
    }
    const controller = (this.controller = new AbortController());
    this.busy = true;
    this.partial = "Thinking on this device…";
    this.publish();
    let session: LanguageModelSession | undefined;
    try {
      session = await LanguageModel.create({
        ...LANGUAGES,
        signal: controller.signal,
        initialPrompts: [{ role: "system", content: systemPrompt(post) }, ...c.history.slice(-HISTORY_MESSAGES)],
        monitor: (m) =>
          m.addEventListener("downloadprogress", (e) => {
            this.partial = `Downloading the on-device model… ${Math.round(e.loaded * 100)}%`;
            this.publish();
          }),
      });
      this.partial = "Thinking on this device…";
      this.publish();
      const input = await this.buildInput(session, post.text, inlineSkill(text, mergeSkills(BUILTIN_SKILLS, post.skills)));
      const raw = await session.prompt(input, { responseConstraint: RESPONSE_SCHEMA, signal: controller.signal });
      const { reply, edits } = parseResponse(raw);
      const { valid, problems } = checkEdits(post.text, edits);
      const skipped = problems.length ? `\n\n(${problems.length} suggestion${problems.length === 1 ? "" : "s"} skipped: the text didn't match the post exactly.)` : "";
      c.items.push({ kind: "assistant", id: c.nextId++, text: reply + skipped, model: ON_DEVICE.name });
      if (valid.length) {
        c.items.push({ kind: "tool", id: c.nextId++, callId: `local-${crypto.randomUUID()}`, name: "propose_edits", args: {}, status: "done", edits: valid });
      }
      c.history.push(
        { role: "user", content: text },
        { role: "assistant", content: reply + (valid.length ? `\n(Proposed ${valid.length} edits.)` : "") },
      );
    } catch (e) {
      const aborted = controller.signal.aborted;
      c.items.push({ kind: "assistant", id: c.nextId++, text: "", error: aborted ? "Stopped." : describeError(e) });
    } finally {
      session?.destroy();
      this.busy = false;
      this.partial = undefined;
      if (this.controller === controller) this.controller = undefined;
      this.publish();
    }
  }

  /** The request plus as much of the post as fits in what's left of the context window. */
  private async buildInput(session: LanguageModelSession, postText: string, request: string): Promise<string> {
    const build = (post: string) => `<post>\n${post}\n</post>\n\n${request}`;
    const window = session.contextWindow ?? session.inputQuota;
    if (!window) return build(postText);
    const measure = (s: string) => (session.measureContextUsage ?? session.measureInputUsage)?.call(session, s, { responseConstraint: RESPONSE_SCHEMA });
    // contextUsage already counts the system prompt and history; measure() gives the cost of the new input.
    const used = session.contextUsage ?? session.inputUsage ?? 0;
    let budget = Math.max(500, (window - used - REPLY_TOKENS) * CHARS_PER_TOKEN);
    let input = build(fitPost(postText, budget));
    for (let tries = 0; tries < 3; tries++) {
      const cost = await measure(input);
      if (cost === undefined || used + cost + REPLY_TOKENS <= window) break;
      budget = Math.floor(budget * 0.7);
      input = build(fitPost(postText, budget));
    }
    return input;
  }

  private publish() {
    this.view = { type: "view", items: [...this.conversation.items], busy: this.busy, partial: this.partial };
    this.dispatchEvent(new Event("change"));
  }
}

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") return "Chrome needs a click to start downloading the on-device model. Try again.";
    if (e.name === "QuotaExceededError") return "The post is too long for the on-device model. Try a shorter question, or pick a server model.";
    if (e.name === "NotSupportedError") return "The on-device model can't handle this request (it may not support the post's language).";
  }
  return `On-device model error: ${e instanceof Error ? e.message : String(e)}`;
}

// ---- Summarizer ----

export function canSummarize(): boolean {
  return typeof Summarizer !== "undefined";
}

/** Strips what a summary shouldn't see: front matter is already separate, so code, shortcodes and HTML. */
export function proseOnly(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\{\{[<%][\s\S]*?[%>]\}\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drafts a one- or two-sentence summary of the post body for a front matter field. */
export async function summarizePost(body: string, siteName: string, field: string): Promise<string> {
  if (typeof Summarizer === "undefined") throw new Error("This browser has no on-device summarizer.");
  const summarizer = await Summarizer.create({
    type: field.toLowerCase() === "description" ? "teaser" : "tldr",
    format: "plain-text",
    length: "short",
    expectedInputLanguages: ["en"],
    outputLanguage: "en",
    sharedContext: `A post from the blog "${siteName}", summarised for its ${field} field. Write in the author's voice, not about "the author".`,
  });
  try {
    let text = proseOnly(body);
    for (;;) {
      try {
        return (await summarizer.summarize(text)).trim();
      } catch (e) {
        // Too long for the model: summarise the opening, which carries the argument in most posts.
        if (!(e instanceof DOMException && e.name === "QuotaExceededError") || text.length < 2000) throw e;
        text = text.slice(0, Math.floor(text.length / 2));
      }
    }
  } finally {
    summarizer.destroy();
  }
}
