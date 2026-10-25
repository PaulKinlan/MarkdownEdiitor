# 0003. Editor extensions: capabilities, worker CSP and boot budget

- Status: accepted
- Date: 2026-10-25

Editor extensions (PR #13, see `docs/extensions.md`) run in module Web Workers and can show sandboxed iframe panels. Merging them with the security headers from ADR 0002 needed these changes.

## Capabilities

| Change | Why |
|---|---|
| `Permissions-Policy: microphone=(self)` (was denied) | The Dictation built-in uses the Web Speech API. Extensions only reach it through the `microphone` extension permission, which the author approves per extension, and the browser still asks for the microphone itself. |
| Notifications | Not a Permissions-Policy feature. The Assistant alerts built-in asks for permission the first time it needs it, and only shows one when the editor tab isn't in view (`notifications` extension permission). |

## Extension worker CSP

The build copies the bundled worker to `/extension-worker/sandboxed.js` and `/extension-worker/network.js`. `public/_headers` gives them an enforced policy of their own: `default-src 'none'; script-src blob:`, plus `connect-src` for the network one. A worker's CSP comes from its own response, so an extension without the `network` permission can't `fetch()` or `import()` anything.

The page's report-only policy is detached from those two paths (`! Content-Security-Policy-Report-Only`): it describes a document, and in a worker it would only report the `blob:` module every extension is loaded from.

## Extension panels

A panel used to be an `iframe.srcdoc`, which inherits the page's CSP, so every panel's inline script and style was a violation (report-only today, broken once enforced). Panels now load `/extension-panel` (`public/extension-panel.html`), a static page with a policy of its own: `script-src 'unsafe-inline'`, styles, images and fonts, no `connect-src`, no frames, `frame-ancestors 'self'`. The editor posts the panel's HTML to it, and it writes that in place of itself. The iframe is still sandboxed without `allow-same-origin`, so the panel can't reach the page or its storage.

A sandboxed frame isn't controlled by the service worker, so panels need the network to open, like the preview.

## Trusted Types

`new Worker()` is a script URL sink, so it goes through an `extension-worker` policy (`src/extensions/trusted.ts`) that only allows same-origin URLs.

## Boot JavaScript

The built-in extensions' sources, the extensions dialog, the tools dialog and the command palette now load on first use. The extension host, controller and status bar still load at boot, because word count, reading time and the other statuses show as soon as a post opens. That leaves boot JavaScript at about 280.1 KiB, so the budget goes from 280 KiB to 284 KiB. Lazy-loading the agent panel (ADR 0002, "Left for later") is the next way to bring it back down.
