# Threat model

## What is being protected

1. **The user's site folders.** The editor holds File System Access handles with write permission to Hugo site folders on the user's disk.
2. **Model and search API keys**, which cost money. They live only on the Worker as secrets.
3. **Unpublished drafts**, which are sent to the agent backend and the chosen model provider when the assistant is used.

## Trust boundaries

| Boundary | Control |
|---|---|
| Browser ↔ Worker API | `EDITOR_TOKEN` bearer token on every `/api/*` route except `/api/health` and `/api/reports` (the routes marked `public` in `worker/routes/`); unknown paths answer 401 without it. Cross-origin calls only from `ALLOWED_ORIGINS`. |
| Worker ↔ model providers | Keys are Worker secrets; the browser never sees them. Only the post and conversation are sent. |
| Page ↔ preview iframe | The preview is the user's own `hugo server` (or a site they configured), shown cross-origin; it can't reach the editor's DOM or storage. |
| Model output ↔ the post | The agent can only *propose* find/replace edits; the user accepts each one, and nothing is written to disk until they save. Model text is rendered as text, never as HTML. |
| Browser agents (WebMCP) ↔ the post | Tools edit the in-memory post (undoable) and save only through the normal save path. |
| Anyone ↔ `/api/reports` | Unauthenticated by necessity (browsers send reports without credentials). Write-only: 64 KiB body cap, at most 50 events per request, 120 events per client IP per minute, prototype keys stripped, secret-looking strings redacted, events de-duplicated. Reading requires the token. |

## Capabilities (Permissions-Policy and CSP)

Declared in `public/_headers`. Any change needs an ADR.

| Capability | Setting | Why |
|---|---|---|
| `clipboard-write` | `self` | Not used yet; kept for copy buttons in the editor and assistant (writing only, never reading) |
| `fullscreen` | `self` | Not used yet; kept for a distraction-free writing mode |
| Prompt API, Summarizer (`language-model`, `summarizer`) | default (`self`) | On-device model and draft summaries; not delegated to the preview iframe |
| `microphone` | `self` | Dictation (Web Speech API), only for extensions the author gave the `microphone` permission (ADR 0003) |
| Everything else listed (camera, geolocation, payment, USB, serial, HID, sensors, …) | denied | Not used |
| `connect-src` | `'self' https: wss:` and `localhost` | The agent server can be set to another origin in Settings, and the preview checks the local `hugo server` |
| `frame-src` | `'self' https:` and `localhost` | The preview server address is user-configured |
| `img-src` | adds `data: blob:` | Pasted and dropped images before they are saved |
| `script-src` | `'self'` plus SHA-256 hashes of the two inline pre-paint scripts | No inline or eval |
| `require-trusted-types-for 'script'` | on | Script URL sinks are the service worker registration (`service-worker` policy) and extension workers (`extension-worker`, same origin only) (ADR 0003) |
| Extension workers | `default-src 'none'; script-src blob:` (enforced), plus `connect-src` for extensions with `network` | An extension reaches the network only if it was given the `network` permission (ADR 0003) |
| Extension panels (`/extension-panel`) | Own policy: inline script and style, images and fonts; no `connect-src`; `frame-ancestors 'self'`; sandboxed without `allow-same-origin` | A panel is the extension's own page and can't reach the editor (ADR 0003) |

The full CSP is report-only until reports show it is clean in real use (see ADR 0002); `frame-ancestors 'none'`, `object-src 'none'` and `base-uri 'self'` are enforced.

## OS integration surfaces

| Surface | Risk | Control |
|---|---|---|
| `file_handlers` (`.md`, `.markdown`) | A file from outside a known site is opened | The editor only writes to it after the user adds its site folder |
| `share_target` (GET `/share`) | Arbitrary shared text arrives in the URL | It only pre-fills a new, unsaved draft; the URL is cleaned immediately |
| `shortcuts` (`/?action=new-post`) | None beyond opening the new-post dialog | |

## Discovery endpoints

`/.well-known/security.txt` (contact: GitHub private security advisories) and `/.well-known/traffic-advice`. No auth-related `.well-known` endpoints exist.

## Known gaps

- The CSP is not enforced yet.
- `connect-src` and `frame-src` allow any HTTPS origin because both addresses are user settings.
- Rate limiting on `/api/reports` is per Durable Object instance memory, so it resets when the object is evicted.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/PaulKinlan/MarkdownEdiitor/security/advisories/new).
