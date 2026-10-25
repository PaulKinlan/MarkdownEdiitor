import type { Models, MutableModels, Provider } from "@earendil-works/pi-ai/models";

/** Our own web tools, which a provider's server-side tools replace. */
const REPLACED = new Set(["web_search", "fetch_url"]);

// Claude models that take the dynamic-filtering versions of web search and fetch; older ones get the basic versions.
const DYNAMIC_FILTERING = /^claude-(opus-(4-[6-9]|[5-9])|sonnet-(4-[6-9]|[5-9]))/;

type Payload = { tools?: { name?: string; type?: string }[] } & Record<string, unknown>;

/**
 * The provider's own server-side web tools for a model, or undefined when it
 * has none we can use. These run on the provider's side within one request,
 * so the harness never sees them as tool calls; the answer arrives as text.
 */
export function nativeWebTools(api: string, modelId: string): Record<string, unknown>[] | undefined {
  if (api === "anthropic-messages") {
    const dynamic = DYNAMIC_FILTERING.test(modelId);
    return [
      { type: dynamic ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 5 },
      { type: dynamic ? "web_fetch_20260209" : "web_fetch_20250910", name: "web_fetch", max_uses: 5 },
    ];
  }
  if (api === "openai-responses") return [{ type: "web_search" }];
  return undefined;
}

/** Swaps web_search/fetch_url for the provider's tools in one request payload. Leaves payloads without function tools alone. */
export function withNativeWebTools(payload: Payload, api: string, modelId: string): Payload | undefined {
  const native = nativeWebTools(api, modelId);
  if (!native || !Array.isArray(payload.tools)) return undefined;
  const tools = payload.tools.filter((t) => !REPLACED.has(t.name ?? ""));
  return { ...payload, tools: [...tools, ...native] };
}

/**
 * Wraps every provider in `models` so its requests carry the provider's
 * native web tools while `enabled()` says so. Read per request, so a
 * settings change applies from the next answer.
 */
export function addNativeWebTools(models: MutableModels, enabled: () => boolean): MutableModels {
  for (const provider of models.getProviders()) models.setProvider(wrapProvider(provider, enabled));
  return models;
}

function wrapProvider(provider: Provider, enabled: () => boolean): Provider {
  const withPayload = <O extends { onPayload?: (payload: unknown, model: never) => unknown }>(model: { api: string; id: string }, options?: O): O | undefined => {
    if (!enabled() || !nativeWebTools(model.api, model.id)) return options;
    const previous = options?.onPayload;
    return {
      ...(options ?? ({} as O)),
      onPayload: async (payload: unknown, m: never) => {
        const replaced = (await previous?.(payload, m)) ?? payload;
        return withNativeWebTools(replaced as Payload, model.api, model.id) ?? replaced;
      },
    };
  };
  return new Proxy(provider, {
    get(target, key) {
      if (key === "stream") return (model: never, context: never, options?: never) => target.stream(model, context, withPayload(model, options) as never);
      if (key === "streamSimple") return (model: never, context: never, options?: never) => target.streamSimple(model, context, withPayload(model, options) as never);
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** Which models answer with the provider's own web search when native tools are on. */
export function hasNativeWebSearch(models: Models, provider: string, modelId: string): boolean {
  const model = models.getModel(provider, modelId);
  return !!model && !!nativeWebTools(model.api, model.id);
}
