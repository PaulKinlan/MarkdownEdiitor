/// <reference types="vite/client" />
// Installable-app plumbing: the service worker and its update flow, and the
// ways the OS can launch the editor (opening a .md file, sharing to it, the
// "New post" shortcut). The manifest is public/manifest.webmanifest.

/** Something the editor was launched to do. */
export interface Launch {
  /** Markdown files opened with the app (manifest file_handlers). */
  files: FileSystemFileHandle[];
  /** Text shared to the app (manifest share_target). */
  share?: { title: string; text: string };
  /** A manifest shortcut, e.g. "new-post". */
  action?: string;
}

interface LaunchParams {
  readonly files: readonly FileSystemHandle[];
  readonly targetURL?: string;
}

declare global {
  interface Window {
    launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
  }
}

/**
 * Calls `onLaunch` for every launch. With launch_handler "focus-existing", a
 * launch while the editor is already open arrives here instead of opening a
 * second window, so unsaved edits are never split across two copies.
 */
export function listenForLaunches(onLaunch: (launch: Launch) => void) {
  // The URL this page loaded with counts once, whether or not the browser also queues it as a launch
  // (it does in an installed app window, but not in a tab).
  const initialUrl = location.href;
  const initial = fromUrl(initialUrl);
  if (initial.share || initial.action) onLaunch(initial);
  let first = true;
  window.launchQueue?.setConsumer((params) => {
    const files = params.files.filter((h): h is FileSystemFileHandle => h.kind === "file");
    const repeat = first && params.targetURL === initialUrl;
    first = false;
    const launch = { ...(repeat ? {} : fromUrl(params.targetURL)), files };
    if (launch.files.length || launch.share || launch.action) onLaunch(launch);
  });
  // Leave a clean URL, so a reload doesn't share the same text again.
  if (location.search || location.pathname !== "/") history.replaceState(null, "", "/");
}

function fromUrl(href?: string): Launch {
  const launch: Launch = { files: [] };
  if (!href) return launch;
  const url = new URL(href);
  const params = url.searchParams;
  // A GET share target replaces the action's query with the shared fields, so the share is marked by its path.
  if (url.pathname === "/share") {
    // Android puts a shared link in `text`, desktop Chrome in `url`: keep whichever arrived.
    const title = params.get("title")?.trim() ?? "";
    const text = [params.get("text"), params.get("url")].filter(Boolean).join("\n\n").trim();
    if (title || text) launch.share = { title, text };
  }
  launch.action = params.get("action") ?? undefined;
  return launch;
}

/**
 * Registers the service worker (production builds only: in `vite dev` it
 * would cache modules the dev server is about to change). `onUpdate` is called
 * when a new version has installed and is waiting; call the function it gets
 * to switch to it, which reloads the page.
 */
export async function registerServiceWorker(onUpdate: (apply: () => void) => void) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  if ((await fetchHealth())?.killSw) return removeServiceWorker();
  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register(swUrl(), { updateViaCache: "none" });
  } catch (e) {
    console.warn("Service worker registration failed", e);
    return;
  }

  let switching = false;
  const offer = (worker: ServiceWorker) =>
    onUpdate(() => {
      switching = true;
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      worker.postMessage({ type: "skip-waiting" });
    });

  // Another window accepted the update. This one keeps running the old build (the worker keeps the
  // previous version's files for it), and offers a plain reload once the user is ready.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !switching) onUpdate(() => location.reload());
  });

  // Only an update waits: a first install takes over without asking.
  if (registration.waiting && navigator.serviceWorker.controller) offer(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
    });
  });

  // An installed app can stay open for days: look for a new deploy when it comes back into view.
  // /api/health names the deployed commit, so a deploy is noticed on the next look rather than
  // after the browser's own update check; without a commit, check every half hour.
  let lastHealth = Date.now();
  let lastUpdate = Date.now();
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || Date.now() - lastHealth < 60_000) return;
    lastHealth = Date.now();
    const health = await fetchHealth();
    if (health?.killSw) return removeServiceWorker();
    const drift = !!health?.commit && health.commit !== "dev" && health.commit !== __COMMIT__;
    if (!drift && Date.now() - lastUpdate < 30 * 60_000) return;
    lastUpdate = Date.now();
    void registration.update().catch(() => {});
  });
}

/**
 * The worker's URL as a TrustedScriptURL where Trusted Types are on (the CSP
 * asks for them), from a policy that allows only that one URL.
 */
function swUrl(): string {
  const tt = (window as Window & { trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(url: string): string }): { createScriptURL(url: string): string } } }).trustedTypes;
  if (!tt) return "/sw.js";
  const policy = tt.createPolicy("service-worker", {
    createScriptURL: (url) => {
      if (url !== "/sw.js") throw new TypeError(`Not the service worker: ${url}`);
      return url;
    },
  });
  return policy.createScriptURL("/sw.js");
}

async function fetchHealth(): Promise<{ commit?: string; killSw?: boolean } | undefined> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

/** The emergency switch (KILL_SW=1 on the Worker): drop every service worker and cache, so the next load is plain network. */
async function removeServiceWorker() {
  for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
  for (const key of await caches.keys()) await caches.delete(key);
}

/**
 * Asks the browser not to evict this origin's storage, which holds the saved
 * site folder handles. Installed apps are usually granted it without a prompt.
 */
export async function persistStorage() {
  try {
    if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.();
  } catch {
    // Not supported: storage stays best-effort.
  }
}
