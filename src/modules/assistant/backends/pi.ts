import { AgentConnection, fetchAgentConfig } from "../../../lib/agent-client";
import { defineBackend } from "../backend";

// The Pi Durable agent server (this site's Worker, or the one in Assistant
// settings): every model it has a key for, with the site index and tools.
export default defineBackend({
  id: "pi",
  name: "Agent server",
  order: 10,
  server: true,
  async models(settings) {
    try {
      const config = await fetchAgentConfig(settings);
      return { models: config.models, webSearch: config.webSearch };
    } catch (e) {
      return { models: [], error: `Agent server unavailable: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
  connect: (settings, sessionId) => new AgentConnection(settings, sessionId),
  connectSite: (settings, siteId) => AgentConnection.forSite(settings, siteId),
});
