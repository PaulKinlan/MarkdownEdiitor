/// <reference types="vite/client" />
// Agent backends: what runs the model loop for the assistant. Each is a file
// in ./backends that default-exports defineBackend(), found by folder like
// modules are: the Pi agent server, Chrome's on-device model, and next an ACP
// harness through the local helper. The panel only sees an AgentLink (chat
// items and proposed edits), so it doesn't care which one it's talking to.

import type { AgentConnection, AgentLink, AgentSettings } from "../../lib/agent-client";
import type { ModelInfo } from "../../shared/protocol";

export interface BackendListing {
  models: ModelInfo[];
  /** Set when the backend couldn't be reached; its models are then empty. */
  error?: string;
  /** The agent server has a key for web_search (DeepSeek, Brave or Tavily). */
  webSearch?: boolean;
}

export interface AgentBackend {
  id: string;
  name: string;
  /** Lower first in the model picker (default 1000). */
  order?: number;
  /**
   * The agent server: the site's search index, the extension library and
   * server-side tools depend on it being reachable. At most one backend sets this.
   */
  server?: boolean;
  /** Providers whose models are always this backend's, so a saved model finds its backend before the lists load. */
  providers?: string[];
  /** The models it offers now. Model ids are "<provider>/<modelId>" and belong to the backend that listed them. */
  models(settings: AgentSettings): Promise<BackendListing>;
  /** A conversation about one post. */
  connect(settings: AgentSettings, sessionId: string): AgentLink;
  /** A conversation about the whole site, for backends that can have one. */
  connectSite?(settings: AgentSettings, siteId: string): AgentConnection;
}

export function defineBackend(backend: AgentBackend): AgentBackend {
  return backend;
}

const BACKENDS = import.meta.glob<AgentBackend>("./backends/*.ts", { eager: true, import: "default" });

/** Every backend in ./backends, in `order`. */
export function backends(): AgentBackend[] {
  return Object.values(BACKENDS).sort((a, b) => (a.order ?? 1000) - (b.order ?? 1000) || a.id.localeCompare(b.id));
}
