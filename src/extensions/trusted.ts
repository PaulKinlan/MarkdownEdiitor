// The Trusted Types policy for extension workers' script URLs (the page's CSP
// asks for Trusted Types; see THREAT_MODEL.md). Where the browser has no
// Trusted Types, the URL passes through.

interface Policy {
  createScriptURL?(url: string): string;
}
type Factory = { createPolicy(name: string, rules: Policy): Required<Policy> };

const tt = (globalThis as { trustedTypes?: Factory }).trustedTypes;

const workers = tt?.createPolicy("extension-worker", {
  createScriptURL: (url) => {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) throw new TypeError(`Extension workers load from this origin only: ${url}`);
    return url;
  },
});

export function workerScriptUrl(url: URL): string | URL {
  return workers ? workers.createScriptURL(url.href) : url;
}
