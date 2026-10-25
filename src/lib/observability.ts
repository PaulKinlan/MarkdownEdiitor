/// <reference types="vite/client" />
// Field telemetry: uncaught errors, browser reports (deprecations,
// interventions, CSP), Core Web Vitals with the element or interaction
// behind them, and long animation frames. Everything goes to the Worker's
// /api/reports collector (worker/observability/) in small beacons, so a slow
// or offline network never holds up the editor. Nothing about post content
// is sent: only URLs paths, selectors and error messages, which the collector
// redacts again.

const ENDPOINT = "/api/reports";

interface ClientReport {
  type: string;
  url: string;
  body: Record<string, unknown>;
  /** The build that sent it, which can be older than the Worker receiving it. */
  commit: string;
}

let queue: ClientReport[] = [];
let started = false;

/** Starts collecting. Production builds only: in `vite dev` there is usually no Worker to send to. */
export function startObservability() {
  if (started || !import.meta.env.PROD) return;
  started = true;
  trapErrors();
  observeReports();
  observeVitals();
  stampCrashKeys();
  // Flush when the page is hidden: that is the last moment a beacon is reliable.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  addEventListener("pagehide", flush);
}

function send(type: string, body: Record<string, unknown>) {
  queue.push({ type, url: location.href, body, commit: __COMMIT__ });
  if (queue.length >= 20) flush();
}

function flush() {
  // Each metric is sent again only if it got worse since the last flush (the page can be hidden many times).
  vitals.forEach((value, name) => {
    if (sentVitals.get(name) === value) return;
    sentVitals.set(name, value);
    queue.push({ type: "web-vital", url: location.href, body: { name, value, ...vitalDetail.get(name) }, commit: __COMMIT__ });
  });
  if (!queue.length) return;
  const batch = queue;
  queue = [];
  try {
    navigator.sendBeacon(ENDPOINT, new Blob([JSON.stringify(batch)], { type: "application/json" }));
  } catch {
    // Telemetry never gets in the way.
  }
}

function trapErrors() {
  // Capture phase, so failed <script>, <link> and <img> loads (which don't bubble) are seen too.
  addEventListener(
    "error",
    (e: Event) => {
      const target = e.target;
      if (e instanceof ErrorEvent) {
        send("error", { message: e.message, sourceFile: e.filename, lineNumber: e.lineno, columnNumber: e.colno, stack: stackOf(e.error) });
      } else if (target instanceof Element) {
        send("error", { message: `Failed to load <${target.localName}>`, sourceFile: (target as HTMLImageElement).src ?? (target as HTMLLinkElement).href ?? "" });
      }
    },
    true,
  );
  addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason;
    send("unhandledrejection", { message: reason instanceof Error ? reason.message : String(reason).slice(0, 500), stack: stackOf(reason) });
  });
}

function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack?.split("\n").slice(0, 8).join("\n") : undefined;
}

/** Deprecations, interventions and the like. CSP and crash reports also arrive by header (Reporting-Endpoints). */
function observeReports() {
  if (!("ReportingObserver" in window)) return;
  const observer = new ReportingObserver(
    (reports) => {
      for (const r of reports) send(r.type ?? "report", { ...(r.body as { toJSON?: () => Record<string, unknown> })?.toJSON?.() });
    },
    { types: ["deprecation", "intervention"], buffered: true },
  );
  observer.observe();
}

/** The current value of each metric, sent when the page is hidden. */
const vitals = new Map<string, number>();
const sentVitals = new Map<string, number>();
const vitalDetail = new Map<string, Record<string, unknown>>();

function observeVitals() {
  observe("largest-contentful-paint", (entries) => {
    const last = entries.at(-1) as PerformanceEntry & { element?: Element; url?: string };
    if (!last) return;
    vitals.set("LCP", Math.round(last.startTime));
    vitalDetail.set("LCP", { target: selectorOf(last.element), resource: last.url || undefined });
  });

  // INP: the slowest interaction so far (close to the 98th percentile for a session of normal length).
  observe(
    "event",
    (entries) => {
      for (const entry of entries as (PerformanceEventTiming & { interactionId?: number })[]) {
        if (!entry.interactionId || entry.duration <= (vitals.get("INP") ?? -1)) continue;
        vitals.set("INP", Math.round(entry.duration));
        vitalDetail.set("INP", { target: selectorOf(entry.target), interaction: entry.name });
      }
    },
    { durationThreshold: 40 },
  );

  // CLS: the largest burst of shifts (a session window: < 1s apart, < 5s in all).
  let windowValue = 0;
  let windowStart = 0;
  let previous = 0;
  // A page that never shifts scores 0: count it, or CLS percentiles only see unstable visits.
  if (PerformanceObserver.supportedEntryTypes?.includes("layout-shift")) vitals.set("CLS", 0);
  observe("layout-shift", (entries) => {
    for (const entry of entries as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node }[] })[]) {
      if (entry.hadRecentInput) continue;
      if (entry.startTime - previous > 1000 || entry.startTime - windowStart > 5000) {
        windowValue = 0;
        windowStart = entry.startTime;
      }
      previous = entry.startTime;
      windowValue += entry.value;
      if (windowValue > (vitals.get("CLS") ?? 0)) {
        vitals.set("CLS", Math.round(windowValue * 1000) / 1000);
        vitalDetail.set("CLS", { targets: entry.sources?.map((s) => selectorOf(s.node)).filter(Boolean).slice(0, 3) });
      }
    }
  });

  // Long animation frames: which script held up rendering.
  observe("long-animation-frame", (entries) => {
    for (const frame of entries as (PerformanceEntry & { blockingDuration: number; scripts?: { sourceURL: string; sourceFunctionName: string; sourceCharPosition: number; invoker: string; duration: number }[] })[]) {
      if (frame.duration < 150) continue;
      const script = frame.scripts?.toSorted((a, b) => b.duration - a.duration)[0];
      send("long-animation-frame", {
        duration: Math.round(frame.duration),
        blockingDuration: Math.round(frame.blockingDuration),
        sourceURL: script?.sourceURL,
        sourceFunctionName: script?.sourceFunctionName,
        sourceCharPosition: script?.sourceCharPosition,
        invoker: script?.invoker,
      });
    }
  });
}

function observe(type: string, callback: (entries: PerformanceEntry[]) => void, options: Record<string, unknown> = {}) {
  if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
  try {
    new PerformanceObserver((list) => callback(list.getEntries())).observe({ type, buffered: true, ...options });
  } catch {
    // An option this browser doesn't know.
  }
}

/** A short CSS selector for an element, enough to find it again. Shadow roots are named by their host. */
function selectorOf(node: Node | null | undefined): string | undefined {
  if (!(node instanceof Element)) return undefined;
  const parts: string[] = [];
  let el: Element | null = node;
  while (el && parts.length < 5) {
    let part = el.localName;
    if (el.id) part += `#${el.id}`;
    else if (el.classList.length) part += `.${[...el.classList].slice(0, 2).join(".")}`;
    parts.unshift(part);
    const parent: Node | null = el.parentNode;
    // Stop at the document; step out of a shadow root to its host.
    el = parent instanceof ShadowRoot ? parent.host : parent instanceof Element ? parent : null;
  }
  return parts.join(" > ");
}

/** Chrome's crash reporter keys: a renderer crash report then says which build and view it came from. */
function stampCrashKeys() {
  const reporter = (navigator as Navigator & { crashReporter?: { setKey(key: string, value: string): void } }).crashReporter;
  if (!reporter?.setKey) return;
  try {
    reporter.setKey("commit", __COMMIT__);
    reporter.setKey("route", location.pathname);
  } catch {
    // Unsupported key or too many keys.
  }
}
