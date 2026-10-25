# 0002. Adopting the default web app prompt

- Status: accepted
- Date: 2026-10-25

The [default web app prompt](https://github.com/PaulKinlan/default-web-app-prompt/blob/main/PROMPT.md) is written for new projects. This records what an audit of the existing editor found, what was changed, and what is left.

## Already in place before this change

- `light-dark()` colour tokens with `color-scheme: light dark`, and a theme override (PR #5).
- Native `<dialog>` with `@starting-style` entry/exit transitions and reduced-motion handling.
- Installable PWA: manifest with file handlers, share target and shortcuts; a service worker that never `skipWaiting()`s over an open window and asks the user before reloading into an update (PR #4).
- Feature-detected Chrome APIs: Prompt API, Summarizer, FileSystemObserver, WebMCP, Service Worker static routing (PR #6).
- SQLite Durable Objects; secrets only on the Worker (`wrangler secret`, `.dev.vars` git-ignored); model calls proxied through the Worker.
- Typecheck and unit tests on every push.

## Added

| Area | Change |
|---|---|
| Security headers | `Permissions-Policy` denying every capability the editor doesn't use; `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`; enforced `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`; a full hash-based CSP with Trusted Types in report-only mode. API responses get `default-src 'none'`. |
| CSP readiness | The service worker URL goes through a Trusted Types policy; the one inline `style` attribute became a class. A headless run of the editor shows zero report-only violations. |
| Observability | `POST /api/reports` collects CSP reports, Reporting API batches (deprecations, interventions, crashes) and the page's own beacons: uncaught errors, unhandled rejections, failed resource loads, LCP/INP/CLS with their target element, and long animation frames. Bodies are capped at 64 KiB, prototype keys stripped, secrets redacted, events de-duplicated by fingerprint, and clients rate-limited. `GET /api/observability/summary` and `/errors?since=` read them (token required). |
| Updates | `/api/health` reports the deployed commit. An open editor compares it with its own build when it comes back into view and looks for the update straight away. `KILL_SW=1` on the Worker makes installed copies drop their service worker and caches. |
| Discovery | `/.well-known/security.txt`, `/.well-known/traffic-advice`, `robots.txt` (private tool: disallow all), `humans.txt`, `llms.txt`. Manifest gains wide and narrow screenshots and `minimal-ui`. |
| Gates | `scripts/check-discovery.mjs` (security.txt expiry, manifest fields, headers present), `scripts/check-perf-budget.mjs` against `perf-budget.json`, `npm run gate` to run everything; CI runs both checks. |
| Accessibility | 3px focus rings on buttons and links; dialogs contain overscroll. |
| Docs | These ADRs, `DESIGN.md`, `THREAT_MODEL.md`, `AGENTS.md`. |

## Left for later

- **Enforce the CSP.** Watch `/api/observability/errors` for `csp-violation` events for a week of real use (including the agent panel and on-device model), then rename the header to `Content-Security-Policy`.
- **Unsaved-draft recovery (§11.3).** Checkpoint the open post's unsaved text to IndexedDB on input and `pagehide`, and offer it back after a crash. Touches `app.ts`, so it waits for the phone layout PR (#7) to land.
- **Boot JavaScript.** The budget started at 260 KiB (252 KiB measured). Merging the site-wide assistant (PR #9) took the boot bundle to 261.3 KiB, so it was raised to 270 KiB rather than block that work, and to 280 KiB when the tools and skill installs (PRs #11, #12) took it to 272.8 KiB; the next step is to lazy-load the agent panel, the site assistant and CodeMirror language data, then lower `perf-budget.json`.
- **Offline / stale state (UI state 9).** Show when the assistant is unreachable and the time of the last index sync.
- **An `/__admin` dashboard** over the observability endpoints, and hourly percentile rollups if the raw Vitals table grows large.
- **Browser acceptance tests in CI** (CSP blocks inline script, zero console errors, zero layout shift).
