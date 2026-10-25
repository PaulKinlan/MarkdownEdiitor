# Working on this repository

Instructions for coding agents (and people) changing the Hugo Editor.

## Read first

- `README.md`: what the editor does and how to run it.
- `docs/adr/`: decisions, including what was deliberately not done.
- `DESIGN.md` before touching UI; `THREAT_MODEL.md` before touching headers, auth, `/api` routes or manifest OS surfaces.

## Before you push

```sh
npm run gate   # typecheck, unit tests, build, discovery files, performance budget
```

CI runs the same checks on every push.

## Rules

- **Frontend:** look up the native platform feature first (the `modern-web-guidance` skill, or `npx -y modern-web-guidance@latest search "<what you need>"`) before writing code or adding a library. New client dependencies need an ADR.
- **Feature-detect** every API that isn't Baseline, with a working fallback.
- **Styles:** use the tokens in `src/styles.css`. No inline `style="…"` attributes and no inline scripts: the CSP will block them once it is enforced. Lit shadow roots don't get page-level rules, so shared control styles live in `src/components/shared.ts`.
- **Secrets** go in Worker secrets or `.dev.vars`, never in client code.
- **Performance budget:** if a change shrinks the build, lower `perf-budget.json` in the same PR; raising it needs an ADR.
- **Copy:** plain, direct, and don't anthropomorphise the models.

## Testing in a browser

- Build and serve with the Worker: `npm run build && npx wrangler dev --port 8787`. The service worker and telemetry only run in production builds.
- Headless Playwright crashes when a `FileSystemHandle` is read back from IndexedDB in a non-persistent context: use `chromium.launchPersistentContext`.
- "Try a sample site" gives a site in the Origin Private File System without a real folder.
- After a run, `curl localhost:8787/api/observability/errors` shows any errors and CSP report-only violations the page sent.
