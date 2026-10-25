import type { Env } from "../env";

export type WebResult = { title: string; url: string; snippet: string };

/** Web search through Brave or Tavily, whichever has a key. Undefined when neither is configured. */
export function webSearcher(env: Env): ((query: string, limit: number) => Promise<WebResult[]>) | undefined {
  if (env.BRAVE_API_KEY) {
    const key = env.BRAVE_API_KEY;
    return async (query, limit) => {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
      const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": key } });
      if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
      const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
      return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? "") }));
    };
  }
  if (env.TAVILY_API_KEY) {
    const key = env.TAVILY_API_KEY;
    return async (query, limit) => {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query, max_results: limit }),
      });
      if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
      const data = (await res.json()) as { results?: { title: string; url: string; content?: string }[] };
      return (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: (r.content ?? "").slice(0, 300) }));
    };
  }
  return undefined;
}

const MAX_CHARS = 12_000;

/** Fetches a page and returns its title and readable text, truncated. */
export async function fetchReadable(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) URLs can be fetched");
  const res = await fetch(parsed, { headers: { "User-Agent": "hugo-editor/1.0 (+https://github.com/PaulKinlan/MarkdownEdiitor)", Accept: "text/html,text/plain,*/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (!type.includes("html")) return truncate(raw);
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
  const main = raw.match(/<(main|article)[\s>][\s\S]*?<\/\1>/i)?.[0] ?? raw;
  const text = stripTags(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|br|section)>/gi, "\n"),
  );
  return truncate(`${title ? `# ${decode(title)}\n\n` : ""}${text}`);
}

function stripTags(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function truncate(text: string): string {
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated at ${MAX_CHARS} characters]` : text;
}
