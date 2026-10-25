import { defineExtension, defineTool, hook, section, ToolTask, type Extension, type Registry, type ToolExecutionResult } from "@earendil-works/pi-durable";
import {
  agentExtensionName,
  EXTENSION_ID,
  type AgentExtensionSpec,
  type AgentScope,
  type ExtensionCall,
  type ExtensionCallResults,
  type ExtensionToolSpec,
} from "../../src/shared/extensions";

const TOOL_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 5_000;
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const MAX_EXTENSIONS = 32;
const MAX_TOOLS = 32;
const MAX_SECTION_CHARS = 8_000;

/** Carries calls to the editor, where extension code runs. Rejects when no editor is connected or it doesn't answer in time. */
export interface ExtensionTransport {
  call<C extends ExtensionCall>(call: C, timeoutMs: number): Promise<ExtensionCallResults[C["kind"]]>;
}

export interface BridgeOptions {
  /** Which assistant this is; tools scoped to the other one are left out. */
  scope: Exclude<AgentScope, "both">;
  /** Tool names extensions may not take (the built-in tools), so an extension can't silently replace them. */
  reserved: ReadonlySet<string>;
}

/**
 * Keeps one Pi Durable extension installed per enabled editor extension.
 * Each one's tools, prompt sections and tool hooks forward to the editor.
 */
export class ExtensionBridge {
  private installed = new Map<string, { json: string; extension: Extension }>();

  constructor(
    private registry: Registry,
    private transport: ExtensionTransport,
    private options: BridgeOptions,
  ) {}

  /** Replaces the installed set with `specs`. Returns problems with specs that were skipped or trimmed. */
  sync(specs: readonly AgentExtensionSpec[]): string[] {
    const problems: string[] = [];
    const next = new Map<string, AgentExtensionSpec>();
    for (const spec of specs.slice(0, MAX_EXTENSIONS)) {
      const checked = this.check(spec, problems);
      if (checked) next.set(checked.id, checked);
    }
    for (const [id, { extension }] of this.installed) {
      if (next.has(id)) continue;
      this.registry.uninstall(extension);
      this.installed.delete(id);
    }
    for (const [id, spec] of next) {
      const json = JSON.stringify(spec);
      if (this.installed.get(id)?.json === json) continue;
      const extension = createEditorExtension(spec, this.transport, this.options.scope);
      try {
        this.registry.install(extension);
        this.installed.set(id, { json, extension });
      } catch (e) {
        problems.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return problems;
  }

  get ids(): string[] {
    return [...this.installed.keys()];
  }

  private check(spec: AgentExtensionSpec, problems: string[]): AgentExtensionSpec | undefined {
    if (!spec || typeof spec.id !== "string" || !EXTENSION_ID.test(spec.id)) {
      problems.push(`Skipped an extension with an invalid id: ${JSON.stringify(spec?.id)}`);
      return undefined;
    }
    const seen = new Set<string>();
    const tools: ExtensionToolSpec[] = [];
    for (const tool of (spec.tools ?? []).slice(0, MAX_TOOLS)) {
      if (!TOOL_NAME.test(tool?.name ?? "") || typeof tool.description !== "string" || typeof tool.parameters !== "object" || tool.parameters === null) {
        problems.push(`${spec.id}: skipped tool ${JSON.stringify(tool?.name)} (needs a name, description and JSON Schema parameters)`);
      } else if (this.options.reserved.has(tool.name)) {
        problems.push(`${spec.id}: skipped tool ${tool.name}, a built-in tool has that name`);
      } else if (!seen.has(tool.name)) {
        seen.add(tool.name);
        tools.push(tool);
      }
    }
    const sections = (spec.sections ?? [])
      .filter((s) => typeof s?.name === "string" && typeof s.text === "string" && /^[a-z0-9_-]{1,64}$/.test(s.name))
      .map((s) => ({ name: s.name, text: s.text.slice(0, MAX_SECTION_CHARS) }));
    return {
      id: spec.id,
      name: String(spec.name ?? spec.id).slice(0, 100),
      tools,
      sections,
      hooks: { beforeTool: Boolean(spec.hooks?.beforeTool), afterTool: Boolean(spec.hooks?.afterTool) },
    };
  }
}

/** The Pi Durable extension standing in for one editor extension. */
export function createEditorExtension(spec: AgentExtensionSpec, transport: ExtensionTransport, scope: Exclude<AgentScope, "both"> = "post"): Extension {
  const tools = spec.tools
    .filter((t) => (t.scope ?? "post") === scope || t.scope === "both")
    .map((t) =>
      defineTool({
        name: t.name,
        description: t.description,
        // Pi Durable validates arguments against plain JSON Schema as well as TypeBox schemas.
        parameters: t.parameters as never,
        ...(t.replay === "safe" ? { replay: "safe" as const } : {}),
        execute: async (args) => {
          try {
            const result = await transport.call({ kind: "tool", extension: spec.id, name: t.name, args }, TOOL_TIMEOUT_MS);
            return { output: [{ type: "text" as const, text: String(result?.text ?? "") }], isError: Boolean(result?.isError) };
          } catch (e) {
            return { output: [{ type: "text" as const, text: `${spec.name}: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
          }
        },
      }),
    );

  const hooks = [];
  if (spec.hooks.beforeTool || spec.hooks.afterTool) {
    // Hooks fail open: if the editor is closed or slow, the call goes ahead unchanged.
    hooks.push(
      hook(ToolTask, {
        ...(spec.hooks.beforeTool
          ? {
              beforeTool: async (call) => {
                try {
                  const answer = await transport.call({ kind: "beforeTool", extension: spec.id, tool: call.name, args: call.arguments }, HOOK_TIMEOUT_MS);
                  if (answer?.block) return { block: String(answer.block) };
                  if (answer?.args && typeof answer.args === "object") return { arguments: answer.args as never };
                } catch {
                  // Fall through: leave the call alone.
                }
                return undefined;
              },
            }
          : {}),
        ...(spec.hooks.afterTool
          ? {
              afterTool: async (call, result) => {
                try {
                  const outcome = { text: textOf(result), isError: Boolean(result.isError) };
                  const answer = await transport.call({ kind: "afterTool", extension: spec.id, tool: call.name, args: call.arguments, result: outcome }, HOOK_TIMEOUT_MS);
                  if (answer && typeof answer.text === "string") {
                    return { ...result, output: [{ type: "text" as const, text: answer.text }], isError: Boolean(answer.isError) };
                  }
                } catch {
                  // Keep the original result.
                }
                return undefined;
              },
            }
          : {}),
      }),
    );
  }

  return defineExtension({
    name: agentExtensionName(spec.id),
    tools,
    sections: spec.sections.map((s) => section(`${spec.id}-${s.name}`, () => s.text)),
    hooks,
  });
}

function textOf(result: ToolExecutionResult): string {
  return (result.output ?? [])
    .map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
    .join("\n");
}
