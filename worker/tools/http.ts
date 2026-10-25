import type { HttpToolSource } from "../../src/shared/tools";

const MAX_CHARS = 12_000;

/** Builds the request for one call of a configured HTTP tool. */
export function buildHttpRequest(tool: HttpToolSource, args: Record<string, unknown>): Request {
  const used = new Set<string>();
  const url = new URL(
    tool.url.replace(/\{(\w+)\}/g, (_, name: string) => {
      used.add(name);
      const value = args[name];
      if (value === undefined || value === null) throw new Error(`Missing ${name}`);
      // A full URL as a path parameter (a reader proxy) is passed through as it is.
      return /^https?:\/\//.test(String(value)) ? String(value) : encodeURIComponent(String(value));
    }),
  );
  const body: Record<string, unknown> = { ...(tool.body ?? {}) };
  for (const p of tool.params) {
    const value = args[p.name];
    if (value === undefined || value === null || used.has(p.name)) continue;
    if (p.in === "query") url.searchParams.set(p.name, String(value));
    else if (p.in === "body") body[p.name] = value;
  }
  const headers = new Headers(tool.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json, text/plain, */*");
  const hasBody = tool.method === "POST";
  if (hasBody) headers.set("Content-Type", "application/json");
  return new Request(url, { method: tool.method, headers, ...(hasBody ? { body: JSON.stringify(body) } : {}) });
}

/** Calls the tool and returns text for the model: the selected part of a JSON reply, or the body, truncated. */
export async function runHttpTool(tool: HttpToolSource, args: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const res = await fetch(buildHttpRequest(tool, args), { signal });
  const text = await res.text();
  if (!res.ok) throw new Error(`${tool.name} returned ${res.status}: ${text.slice(0, 300)}`);
  if (!(res.headers.get("content-type") ?? "").includes("json")) return truncate(text);
  return truncate(shapeJson(JSON.parse(text), tool.resultPath, tool.fields));
}

export function shapeJson(data: unknown, resultPath?: string, fields?: string[]): string {
  let value = data;
  for (const key of (resultPath ?? "").split(".").filter(Boolean)) {
    value = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
  }
  if (Array.isArray(value) && fields?.length) {
    value = value.map((item) =>
      item && typeof item === "object" ? Object.fromEntries(fields.filter((f) => f in item).map((f) => [f, (item as Record<string, unknown>)[f]])) : item,
    );
  }
  return value === undefined ? "No result." : JSON.stringify(value, null, 1);
}

export function truncate(text: string, max = MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated at ${max} characters]` : text;
}
