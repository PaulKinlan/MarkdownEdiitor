import type { AgentSession } from "./agent/session";
import type { SiteIndex } from "./agent/site-index";
import type { SiteSession } from "./agent/site-session";
import type { ToolStore } from "./tools/store";
import type { ExtensionStore } from "./extension-store";
import type { Observability } from "./observability/store";

export interface Env {
  ASSETS: Fetcher;
  AGENT_SESSION: DurableObjectNamespace<AgentSession>;
  SITE_INDEX: DurableObjectNamespace<SiteIndex>;
  SITE_SESSION: DurableObjectNamespace<SiteSession>;
  /** The author's MCP servers and HTTP API tools, shared by every agent. */
  TOOL_STORE: DurableObjectNamespace<ToolStore>;
  /** Installed editor extensions (see worker/extension-store.ts). */
  EXTENSION_STORE: DurableObjectNamespace<ExtensionStore>;
  OBSERVABILITY: DurableObjectNamespace<Observability>;
  /** The deployed commit, set by the deploy workflow (--var COMMIT:<sha>). Reported by /api/health. */
  COMMIT?: string;
  /** "1" makes installed copies unregister their service worker and clear caches (emergency switch). */
  KILL_SW?: string;
  /** When set, every /api request must carry it (Authorization: Bearer, or ?token= for WebSockets). */
  EDITOR_TOKEN?: string;
  /** Comma-separated editor origins allowed to call the API cross-origin (e.g. http://localhost:5173). */
  ALLOWED_ORIGINS?: string;
  ANTHROPIC_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  BRAVE_API_KEY?: string;
  /** "1" adds a scripted model for local development without API keys. */
  DEMO_MODEL?: string;
  TAVILY_API_KEY?: string;
}
