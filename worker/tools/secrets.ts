import { SECRET_MASK, type ToolSettings } from "../../src/shared/tools";

// Header values are secrets: the browser sees SECRET_MASK and sends it back to mean "keep what is stored".

export function maskSecrets(settings: ToolSettings): ToolSettings {
  return {
    ...settings,
    sources: settings.sources.map((s) => ({ ...s, headers: Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k, v ? SECRET_MASK : ""])) })),
  };
}

export function unmaskSecrets(incoming: ToolSettings, stored: ToolSettings): ToolSettings {
  return {
    nativeWebTools: incoming.nativeWebTools !== false,
    sources: (incoming.sources ?? []).map((s) => {
      const before = stored.sources.find((o) => o.id === s.id)?.headers ?? {};
      return { ...s, headers: mergeHeaders(s.headers ?? {}, before) };
    }),
  };
}

export function mergeHeaders(incoming: Record<string, string>, stored: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(incoming)
      .filter(([k]) => k.trim())
      .map(([k, v]) => [k.trim(), v === SECRET_MASK ? (stored[k] ?? "") : v]),
  );
}
