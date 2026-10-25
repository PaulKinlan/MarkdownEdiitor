# 0001. Platform baseline, client stack and hosting

- Status: accepted
- Date: 2026-10-25

These are the four kickoff choices from the [default web app prompt](https://github.com/PaulKinlan/default-web-app-prompt/blob/main/PROMPT.md), recorded after the fact for a project that was already running.

## 1. Web platform baseline: Chromium first, Baseline Newly Available elsewhere

The editor's core job (editing Hugo site folders on the user's disk) needs the File System Access API's `showDirectoryPicker`, which only Chromium ships. So:

- **Chrome and Edge** get the full editor, plus cutting-edge APIs: the Prompt API and Summarizer, FileSystemObserver, WebMCP (origin trial), the custom spell check dictionary, Service Worker static routing, `navigator.crashReporter`.
- **Every cutting-edge API is behind feature detection** with a working fallback (see the README's "Chrome features").
- **Other browsers** get the sample site in the Origin Private File System, and the rest of the UI uses Baseline Newly Available features (`light-dark()`, `@starting-style`, `:has()`, popover, `<dialog>`), with fallbacks where a gap would break the page (for example the `light-dark()` fallback in `src/styles.css`).

## 2. Client stack: Lit and CodeMirror 6, not vanilla

The prompt's default is vanilla Web Components with no client dependencies. This project keeps:

- **Lit** for components. It *is* standard custom elements and shadow DOM; it adds reactive properties and efficient templating for a UI with a lot of live state (dirty tracking, agent streams, diff review). Rewriting to vanilla would cost weeks for no user-visible gain.
- **CodeMirror 6** for the editor. There is no native rich code/markdown editing surface; `contenteditable` or a `<textarea>` can't give syntax highlighting, shortcode decoration, undo-integrated agent edits, or spell check over large posts.
- **yaml / smol-toml** to round-trip front matter byte-for-byte (comments, anchors, quoting).
- **idb-keyval** for storing directory handles in IndexedDB.
- **Pi Durable / pi-ai / chord** (Earendil) for the agent harness, which Paul chose as the agent runtime.

Any new client dependency needs its own ADR showing the platform can't do the job.

The cost of these is a boot bundle far above the prompt's 4 KiB target (about 250 KiB gzipped today). `perf-budget.json` ratchets it at today's size so it can only shrink. Lazy-loading the agent panel and CodeMirror language data are the obvious next cuts.

## 3. Hosting: Cloudflare Workers, Static Assets, Durable Objects (SQLite)

As the prompt recommends. One Worker serves the built app as static assets and the `/api/*` routes. State lives in SQLite-backed Durable Objects: `AgentSession` (one per post conversation), `SiteIndex` (one per site, full-text search), `Observability` (browser reports and Web Vitals). Route handlers use only `Request`, `Response`, Web Crypto and Web Streams, so they stay portable.

Things the browser can't do (stdio ACP harnesses, git, `hugo server`) go to a small local helper app, agreed with Paul.

## 4. Visual direction

Minimal and calm, so the writing is the focus: neutral greys, one blue accent, system fonts, no gradients. Recorded in [`DESIGN.md`](../../DESIGN.md).

## What was not adopted from the prompt, and why

- **Vertical feature slices with build-time discovery, slot shell and micro-bus (§7).** The app is one Lit shell (`md-app`) with a handful of components. Restructuring it would conflict with every open PR for little gain at this size. Revisit if parallel work keeps colliding in `src/components/app.ts`.
- **Per-response CSP nonces (§8.1).** The page is a static asset that never runs Worker code, so there is nothing to mint a nonce per request. The CSP uses SHA-256 hashes of the two inline pre-paint scripts instead, filled in at build time. It ships as `Content-Security-Policy-Report-Only` until the reports show no violations in real use; `frame-ancestors`, `object-src` and `base-uri` are enforced now.
- **Route-scoped Permissions-Policy (§8.3 tier 1).** There is one route. Everything not used is denied; clipboard write and fullscreen stay allowed for the page itself, for features that are likely soon.
- **Beads, worktrees, cross-family review (§12.3).** Work here is coordinated through project threads and PR review.
