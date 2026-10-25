// Declarations for Chrome APIs that TypeScript's DOM library doesn't have yet.
// Only the parts the editor uses are declared, and every one is optional at
// runtime: check for it before calling.

type AIAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface AIDownloadMonitor extends EventTarget {
  addEventListener(type: "downloadprogress", listener: (e: ProgressEvent) => void): void;
}

interface AICreateOptions {
  signal?: AbortSignal;
  monitor?: (m: AIDownloadMonitor) => void;
}

// ---- Prompt API (Chrome 148) ----

interface LanguageModelExpected {
  type: "text" | "image" | "audio";
  languages?: string[];
}

interface LanguageModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LanguageModelCreateOptions extends AICreateOptions {
  initialPrompts?: LanguageModelMessage[];
  expectedInputs?: LanguageModelExpected[];
  expectedOutputs?: LanguageModelExpected[];
}

interface LanguageModelPromptOptions {
  signal?: AbortSignal;
  responseConstraint?: object;
}

interface LanguageModelSession {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  measureContextUsage?(input: string, options?: LanguageModelPromptOptions): Promise<number>;
  /** Older builds: measureInputUsage / inputQuota. */
  measureInputUsage?(input: string, options?: LanguageModelPromptOptions): Promise<number>;
  readonly contextWindow?: number;
  readonly contextUsage?: number;
  readonly inputQuota?: number;
  readonly inputUsage?: number;
  destroy(): void;
}

declare var LanguageModel:
  | {
      availability(options?: Omit<LanguageModelCreateOptions, "initialPrompts" | "monitor" | "signal">): Promise<AIAvailability>;
      create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
    }
  | undefined;

// ---- Summarizer API (Chrome 138) ----

interface SummarizerOptions extends AICreateOptions {
  type?: "tldr" | "teaser" | "key-points" | "headline";
  format?: "plain-text" | "markdown";
  length?: "short" | "medium" | "long";
  sharedContext?: string;
  expectedInputLanguages?: string[];
  outputLanguage?: string;
}

interface SummarizerSession {
  summarize(input: string, options?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

declare var Summarizer:
  | {
      availability(options?: Omit<SummarizerOptions, "monitor" | "signal">): Promise<AIAvailability>;
      create(options?: SummarizerOptions): Promise<SummarizerSession>;
    }
  | undefined;

// ---- FileSystemObserver (Chrome 133) ----

type FileSystemChangeType = "appeared" | "disappeared" | "modified" | "moved" | "unknown" | "errored";

interface FileSystemChangeRecord {
  readonly root: FileSystemHandle;
  readonly changedHandle: FileSystemHandle | null;
  readonly relativePathComponents: readonly string[];
  readonly type: FileSystemChangeType;
  readonly relativePathMovedFrom: readonly string[] | null;
}

interface FileSystemObserver {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  unobserve(handle: FileSystemHandle): void;
  disconnect(): void;
}

declare var FileSystemObserver:
  | { new (callback: (records: FileSystemChangeRecord[], observer: FileSystemObserver) => void): FileSystemObserver }
  | undefined;

// ---- WebMCP (origin trial, Chrome 149 to 156) ----

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema?: object;
  execute(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean; consequentialHint?: boolean };
}

interface ModelContext {
  /** The spec returns a promise; early builds returned `{ unregister() }`. */
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): unknown;
}

interface Document {
  readonly modelContext?: ModelContext;
  /** Spell check custom dictionary (Chrome 159). Write-only: words can't be read back. */
  readonly spellCheckCustomDictionary?: {
    addWords(words: string[]): void;
    removeWords(words: string[]): void;
  };
}

interface Navigator {
  /** Where early WebMCP builds put it, before it moved to `document`. */
  readonly modelContext?: ModelContext;
}
