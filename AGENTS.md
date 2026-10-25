# Working on this repository

Instructions for coding agents (and people) changing the Hugo Editor.

## Read first

- `README.md`: what the editor does and how to run it; `docs/features/` for each feature.
- `docs/adr/`: decisions, including what was deliberately not done.
- `DESIGN.md` before touching UI; `THREAT_MODEL.md` before touching headers, auth, `/api` routes or manifest OS surfaces.

## Before you push

```sh
npm run gate   # typecheck, unit tests, build, discovery files, performance budget
```

CI runs the same checks on every push.

## Rules

- **A feature is a folder or a file, not an edit to a shared list.** Built-in skills go in `src/skills/<name>/SKILL.md`, quick edits in `src/quick-edits/<id>.md`, built-in extensions in `src/extensions/builtin/<id>.js`, features that run in the page in `src/modules/<id>/module.ts` (`docs/modules.md`; reach the app through `shell`, not by editing `app.ts`), feature docs in `docs/features/<name>.md`. Order comes from an `order` value in the file itself. Front-end code finds files with `import.meta.glob`; code the Worker needs gets a generated registry from `scripts/registries.mjs` (`*.gen.ts`, gitignored, written by npm's pre-scripts and the Vite plugin). Don't commit generated files and don't add hand-kept arrays of built-ins.
- **Worker:** a new `/api` endpoint is a file in `worker/routes/` that default-exports `defineRoutes(...)` (`worker/route.ts`); don't add branches to `worker/index.ts`. A new kind of assistant is a profile in `worker/agent/profiles/`. New messages between the editor and a session are declared next to the feature by augmenting `ClientMessages` / `ServerMessages` in `src/shared/protocol.ts`, handled by a profile's `messages` and `AgentConnection.on()`.
- **Durable Objects:** store a feature's data in `FeatureStore` (`featureStore(env, "<feature>", scope)`, or `/api/features/<feature>/<scope>/<key>` from the browser). A new Durable Object class needs an ADR; its migration lands on `main` on its own first, with a tag named `YYYY-MM-DD-<feature>`. Never rename or reorder existing tags.
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
