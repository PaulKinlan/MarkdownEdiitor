# Hugo Editor

A markdown editor for Hugo blogs (built for [aifoc.us](https://aifoc.us) and [paul.kinlan.me](https://paul.kinlan.me)). It runs in the browser, is hosted on Cloudflare Workers, and edits the site folders on your machine directly through the File System Access API.

## What works today (step 1: the editor)

- **Local folders, remembered.** Add a Hugo site folder once. The directory handle is stored in IndexedDB, so next time you only confirm access. Several sites can be added and switched between.
- **Reads your Hugo config.** It finds `hugo.toml` / `config.toml` (and the YAML/JSON variants), the content directory, the theme, and permalink rules. That covers both the `[permalinks.page]` style used by aifoc.us and the flat `content/*.markdown` layout of paul.kinlan.me.
- **Post list.** Every content file is listed newest first, with filter, section and drafts-only views.
- **Editor.** CodeMirror 6 with markdown highlighting, highlighted Hugo shortcodes, and an "Insert shortcode" menu built from the site's and theme's `layouts/shortcodes`.
- **Front matter form.** It is generated from the keys the post already has, with a raw editor for anything else. Edits rewrite only the changed key, so comments, ordering, quoting and line folding stay as written. Checked against all 869 posts in both blogs: opening and saving a post without changes is byte-identical.
- **New posts.** Front matter is copied from the most recent post in the same section, so aifoc.us posts get `seotitle`/`authors` and paul.kinlan.me posts get `summary`/`tags`. The file extension matches too. New posts start as drafts.
- **Images.** Drop or paste an image to save it under `static/images/<slug>/` and insert a `figure` shortcode (or plain markdown if the site has no `figure`).
- **Safe saves.** Ctrl/⌘+S saves. The editor warns before overwriting a file that changed on disk, and reloads clean files that changed while the tab was in the background.
- **Live preview.** The post as rendered by your local `hugo server`, with the site's real theme. Hugo's live reload refreshes it on save. Each site has its own preview address (defaults: 1313, 1314, …).

## The assistant (step 2: agents)

The **Assistant** tab next to the preview opens an agent conversation about the open post. Each post has its own conversation, kept in an `AgentSession` Durable Object built on [Pi Durable](https://earendil.com/posts/pi-durable/). It survives reloads, deploys and evictions, and picks up where it left off.

- **Models.** Any provider with a key on the Worker shows up in the model picker: Anthropic, DeepSeek, OpenAI, Google, OpenRouter. The choice is per browser and can change mid-conversation.
- **Edits.** One-click passes: Proofread, Tighten, Check site rules, Title ideas, Suggest links, Interactive ideas, Fact check, Write summary. "+ Your edits" saves your own instructions as more buttons.
- **Suggestions, not rewrites.** The agent changes the post only through `propose_edits`, find/replace pairs checked against the current text. Each one shows as a word diff to accept or reject. Accepted body edits go through the editor, so Ctrl/⌘+Z undoes them. Nothing is written to disk until you save.
- **Tools.** `read_post` and `propose_edits`. `search_posts` and `read_past_post` work over a full-text index of the site, kept in a per-site `SiteIndex` Durable Object that the editor syncs, uploading only changed files. `web_search` (Brave or Tavily) and `fetch_url` are available when a search key is set.
- **Site rules.** A `CLAUDE.md` or `AGENTS.md` at the site root (aifoc.us has one) is sent as the site's writing rules and goes into the agent's system prompt.

### Agent configuration

Set these as Worker secrets (`wrangler secret put NAME`), or as GitHub repository secrets, which the deploy workflow copies to each Worker:

| Secret | |
|---|---|
| `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Any one is enough |
| `BRAVE_API_KEY` or `TAVILY_API_KEY` | Enables `web_search` |
| `EDITOR_TOKEN` | Requires this token on every `/api` call. Set it in the editor under Settings → Assistant. **Set this (or put the Worker behind Cloudflare Access) before adding model keys**, or anyone with the URL can spend them. |
| `ALLOWED_ORIGINS` | Comma-separated editor origins that may call this API from another origin, when the Assistant's agent server setting points here. |

For local work, copy `.dev.vars.example` to `.dev.vars` and run `npm run dev:worker` alongside `npm run dev`. `DEMO_MODEL=1` adds a scripted "Faux Model" that reads the post and proposes one edit, so the whole loop can be tried without keys. Preview deploys turn it on.

Folder access needs Chrome or Edge. Other browsers can use "Try a sample site", which lives in the browser's private file system.

## Chrome features

These turn on in Chrome when it has them. Without them the editor works as before.

- **On-device model (Prompt API, Chrome 148).** "Chrome on-device model" appears in the Assistant's model picker. It runs in the browser, needs no keys or agent server, and keeps working offline. It has no tools (no search), so it answers from the post and proposes edits through the same accept/reject review. The first use downloads the model. Conversations with it last until the tab closes.
- **Draft summaries (Summarizer API, Chrome 138).** A "Draft summary" or "Draft description" button under those front matter fields writes a short draft from the post body, on the device.
- **Live folder watching (FileSystemObserver, Chrome 133).** Changes made outside the editor (a `git pull`, another editor, an agent) update the post list straight away, reload the open post if it has no unsaved edits, and show the "changed on disk" banner if it does. Browsers without it still check when the window gets focus.
- **Tools for browser agents (WebMCP, origin trial in Chrome 149 to 156).** The editor registers `get_current_post`, `list_posts`, `open_post`, `insert_text`, `apply_edits`, `save_post`, `list_edits` and `run_edit`, so an agent in the browser can work with the open post. Its edits are undoable and stay unsaved until a save. To turn it on for the deployed editor, register for the trial and put the token in the `ORIGIN_TRIAL_TOKENS` repository secret (comma-separated for several); the build adds it to the page. A subdomain token for `kinlan-test.workers.dev` also covers the branch previews. Locally, enable WebMCP in `chrome://flags`.
- **Spell check words (custom dictionary, Chrome 159).** Spell checking is on in the editor (Settings can turn it off). Words listed under Settings → Spell check words, plus the site's tags and categories, aren't marked as misspelled.

## Running it

```sh
npm install
npm run dev        # Vite dev server at http://localhost:5173 (proxies /api to :8787)
npm run dev:worker # the Worker and Durable Objects at http://localhost:8787
npm test           # unit tests (front matter, permalinks, templates)
npm run typecheck
npm run deploy     # build and deploy to Cloudflare Workers
```

### Deploys and branch previews

`.github/workflows/deploy.yml` builds, typechecks and tests every push. Pushes to `main` then deploy the `markdown-editor` Worker. Every other branch deploys its own preview Worker, `markdown-editor-<branch>`, and the workflow posts its URL on the branch's PR. The preview Worker is deleted when the PR closes. Previews are whole Workers because Cloudflare's preview URLs don't work for Workers with Durable Objects, which the agent backend uses.

Deploys need two repository secrets: `CLOUDFLARE_API_TOKEN` (a token with *Workers Scripts: Edit*) and `CLOUDFLARE_ACCOUNT_ID`. Until they are set, the workflow only builds and tests.

For the preview, start Hugo in your site folder. Use `-D` so drafts render, and a different port per site:

```sh
hugo server -D --port 1313   # aifoc.us
hugo server -D --port 1314   # paul.kinlan.me
```

When the editor is served from Cloudflare (https) and the preview is on `http://localhost`, Chrome asks for **Local network access** the first time you press Connect.

## Layout

```
src/lib/frontmatter.ts   Post parsing and minimal-diff front matter edits (YAML/TOML/JSON)
src/lib/hugo.ts          Hugo config, permalinks, shortcode discovery
src/lib/posts.ts         Post index and new-post templates
src/lib/fs.ts            File System Access helpers
src/lib/sites.ts         Persisted directory handles and permissions
src/components/          Lit elements: app shell, editor, front matter form, preview
src/lib/agent-client.ts  WebSocket client for agent sessions, settings
src/lib/actions.ts       Built-in and custom edits
src/lib/indexer.ts       Syncs the site's posts to the search index
src/shared/protocol.ts   Messages between the editor and agent sessions
worker/index.ts          Cloudflare Worker: app assets and /api routes
worker/agent/session.ts  AgentSession Durable Object (Pi Durable harness per post)
worker/agent/writing.ts  The writing extension: tools and system prompt sections
worker/agent/site-index.ts  SiteIndex Durable Object (SQLite FTS5 over past posts)
```

## Plan

1. **Editor** (done): local folders, editing, front matter, live Hugo preview.
2. **Agents** (done). Pi Durable harnesses in Durable Objects, one per post conversation. Configurable models (Claude, DeepSeek, …). Tools for web search, search across past posts, and grammar/style edits returned as diffs to accept. User-defined edits.
3. **Demos, ACP and publishing.** A builder for aifoc.us-style inline demos and infographics, and ACP connections to external agent harnesses. Also git commit/push and an optional hosted preview. Running ACP, git and `hugo server` from the browser goes through a small local helper app.
