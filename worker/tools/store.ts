import { DurableObject } from "cloudflare:workers";
import { DEFAULT_TOOL_SETTINGS, validateToolSettings, type ToolSettings } from "../../src/shared/tools";
import type { Env } from "../env";
import { maskSecrets, unmaskSecrets } from "./secrets";

/**
 * The author's tool settings (MCP servers, HTTP API tools, native web tools),
 * one instance for the whole editor. Every agent reads the full settings;
 * the browser only ever gets them with header values masked.
 */
export class ToolStore extends DurableObject<Env> {
  async settings(): Promise<ToolSettings> {
    return { ...DEFAULT_TOOL_SETTINGS, ...((await this.ctx.storage.get<ToolSettings>("settings")) ?? {}) };
  }

  async publicSettings(): Promise<ToolSettings> {
    return maskSecrets(await this.settings());
  }

  /** Saves settings from the browser, keeping stored secrets wherever the mask came back. */
  async save(incoming: ToolSettings): Promise<{ settings?: ToolSettings; problems?: string[] }> {
    const merged = unmaskSecrets(incoming, await this.settings());
    const problems = validateToolSettings(merged);
    if (problems.length) return { problems };
    await this.ctx.storage.put("settings", merged);
    return { settings: maskSecrets(merged) };
  }

  /** The stored headers of one source, for discovering an MCP server's tools without the browser knowing its token. */
  async headersFor(id: string): Promise<Record<string, string>> {
    return (await this.settings()).sources.find((s) => s.id === id)?.headers ?? {};
  }
}
