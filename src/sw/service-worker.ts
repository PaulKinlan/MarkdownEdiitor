/// <reference lib="webworker" />
// The editor's service worker. Built by the `serviceWorker` plugin in
// vite.config.ts, which replaces the two declarations below with the build's
// file list and a version derived from it.
//
// It only ever handles same-origin GETs for the app's own files. The agent API
// (/api/*, including its WebSockets), the local `hugo server` preview and
// anything else cross-origin go straight to the network: static routes tell
// the browser to skip the worker for those, and the fetch handler ignores them
// in browsers without static routing.

declare const PRECACHE: string[];
declare const VERSION: string;
// A classic script (no imports), so `self` keeps the generic worker type: narrow it once here.
const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `app-${VERSION}`;
// Cloudflare serves index.html at "/" (and redirects /index.html there), so that is the key.
const SHELL = "/";

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await addStaticRoutes(event);
      const cache = await caches.open(CACHE);
      // cache: "reload" skips the HTTP cache, so a stale copy can't sneak into a new version.
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" })));
      // The first install has no old version to keep consistent with: take over straight away.
      // Later versions wait for the page to ask (see the "skip-waiting" message), so an open
      // editor never loses the lazily loaded chunks it was built with.
      if (!sw.registration.active) await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Keep the previous version too: other open windows still run it until they reload, and may
      // lazily load its chunks, which the new deploy no longer serves. Anything older goes.
      // caches.keys() lists caches in creation order.
      const old = (await caches.keys()).filter((key) => key.startsWith("app-") && key !== CACHE);
      for (const key of old.slice(0, -1)) await caches.delete(key);
      await sw.registration.navigationPreload?.enable();
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  if (event.data?.type === "skip-waiting") void sw.skipWaiting();
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(navigate(event));
  else event.respondWith(fromCache(request));
});

/**
 * Network first, so a reload always gets the latest deploy, using the response
 * the browser started fetching while the worker booted (navigation preload).
 * Offline, or if the Worker is down, the cached shell opens instead. Every
 * route is the single-page app, so the shell serves any path, including the
 * share target and shortcut URLs.
 */
async function navigate(event: FetchEvent): Promise<Response> {
  try {
    const response = ((await event.preloadResponse) as Response | undefined) ?? (await fetch(event.request));
    if (response.status < 500) return response;
  } catch {
    // Offline: fall through to the cache.
  }
  return (await caches.match(SHELL, { cacheName: CACHE })) ?? Response.error();
}

/** Built files have hashed names, so a cached copy is always right. Misses are cached for offline use. */
async function fromCache(request: Request): Promise<Response> {
  // Any version's cache: a window still on the previous version needs its files.
  // Extension workers are precached without the ?v= the page adds to their URL (src/extensions/host.ts).
  const ignoreSearch = new URL(request.url).pathname.startsWith("/extension-worker/");
  const cached = (await caches.match(request, { cacheName: CACHE, ignoreSearch })) ?? (await caches.match(request, { ignoreSearch }));
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && new URL(request.url).pathname.startsWith("/assets/")) {
    const copy = response.clone();
    void caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return response;
}

/**
 * Service Worker Static Routing API (Chrome 123+): the browser applies these
 * rules before starting the worker, so API calls, the preview server and other
 * origins never wait on it or pass through it.
 */
async function addStaticRoutes(event: ExtendableEvent) {
  const e = event as ExtendableEvent & { addRoutes?: (rules: unknown) => Promise<void> };
  if (!e.addRoutes) return;
  try {
    await e.addRoutes([
      { condition: { urlPattern: new URLPattern({ pathname: "/api/*" }) }, source: "network" },
      { condition: { not: { urlPattern: new URLPattern({ protocol: location.protocol.slice(0, -1), hostname: location.hostname, port: location.port }) } }, source: "network" },
    ]);
  } catch (err) {
    // Older versions of the API lack `not`; the fetch handler covers the same cases.
    console.warn("Static routes not added", err);
    try {
      await e.addRoutes([{ condition: { urlPattern: new URLPattern({ pathname: "/api/*" }) }, source: "network" }]);
    } catch {
      // The fetch handler already skips /api/.
    }
  }
}
