# The assistant

The **Assistant** tab next to the preview opens an agent conversation about the open post. Each post has its own conversation, kept in an `AgentSession` Durable Object built on [Pi Durable](https://earendil.com/posts/pi-durable/). It survives reloads, deploys and evictions, and picks up where it left off.

- **Models.** Any provider with a key on the Worker shows up in the model picker: Anthropic, DeepSeek, OpenAI, Google, OpenRouter. The choice is per browser and can change mid-conversation.
- **Edits.** (One file each in `src/quick-edits/`.) One-click passes: Proofread, Tighten, Check site rules, Title ideas, Suggest links, Write summary. "+ Your edits" saves your own instructions as more buttons.
- **Skills.** (One folder each in `src/skills/<name>/SKILL.md`.) Bigger, multi-step tasks the agent loads when it needs them, also one click away: Fact check, Link my posts (internal links and tags), Build a demo (inline demos and infographics, embedded the way the site already does it), SEO and social, Editor's critique, Check web APIs (Chrome Status, webstatus.dev, MDN), Check the data, Alt text and a11y, Check code samples, Headline and hook, Series and updates, Check quotes, Newsletter digest, and Image prompts. "All skills" lists them with descriptions. The agent sees every skill's name and description and reads the full instructions with `load_skill`, so you can also just ask ("fact check the second section").
- **Skills from GitHub.** In "All skills", paste `owner/repo` or a link to a skill's folder (for example `vstaln/noslop`). Every folder with a `SKILL.md` is installed, with the text files next to it (reference docs the instructions point to), either into the site folder's `.agents/skills/` (so git tracks it) or for all sites in this browser. Installed skills can be updated from GitHub or removed. The agent reads supporting files with `load_skill({ name, file })`.
- **Your own skills.** Put a `SKILL.md` in `.agents/skills/<name>/` or `.claude/skills/<name>/` in the site folder, the same layout coding agents use. It has YAML front matter with `name` and `description` (and optionally `title` for the button and `scope`: `post`, `site` or `both`), then the instructions in markdown. A site skill with a built-in skill's name replaces it.
- **Suggestions, not rewrites.** The agent changes the post only through `propose_edits`, find/replace pairs checked against the current text. Each one shows as a word diff to accept or reject. Accepted body edits go through the editor, so Ctrl/⌘+Z undoes them. Nothing is written to disk until you save.
- **Tools.** `read_post` and `propose_edits`. `search_posts` and `read_past_post` work over a full-text index of the site, kept in a per-site `SiteIndex` Durable Object that the editor syncs, uploading only changed files. `web_search` and `fetch_url` use DeepSeek Search and Fetch when `DEEPSEEK_API_KEY` is set (or Brave/Tavily for search when those keys are set), for every model. For skills: `analyze_post` (length, outline, long sentences, vague links, missing alt text, front matter lengths), `calculate` (exact arithmetic), `table_stats` (column statistics for a markdown table or CSV) and `browser_support` (Chrome Status and webstatus.dev).
- **The model's own web tools.** Claude models search and read pages with Anthropic's server-side `web_search` and `web_fetch`, and OpenAI models with their `web_search`, in place of the editor's two tools. Turn this off under Settings → Assistant → Tools and MCP servers.
- **Your own tools.** The same dialog adds remote MCP servers (Streamable HTTP, with a token in a header) and plain HTTP APIs, with ready-made Brave Search, Tavily and Jina Reader tools. They live in a `ToolStore` Durable Object on the agent server, so every device and every agent gets them. Keys go in and never come back out to the browser.
- **Site rules.** A `CLAUDE.md` or `AGENTS.md` at the site root (aifoc.us has one) is sent as the site's writing rules and goes into the agent's system prompt.

## The site assistant

The **Post / Site** switch at the top of the Assistant tab moves between the open post's conversation and one conversation for the whole site. That one is kept in a `SiteSession` Durable Object, one per site. With no post open, the side panel shows the site assistant.

- **Tools over every post.** `list_posts` filters by section, date, draft state, a front matter value, or a missing field. `list_terms` counts tags, categories or series across the site. `grep_posts` finds exact text or a regex in every file, front matter included. `read_post` reads any post. `search_posts`, `web_search` and `fetch_url` work as in the post assistant.
- **Multi-file changes for review.** `propose_changes` sends find/replace edits grouped by file, or the full text of a new file. Each file shows as a card with its edits as word diffs, plus "Open" and "Accept all" buttons. Accepted edits to other files are written to disk straight away, one at a time. Edits to the open post go into the editor like the post assistant's, so you save them yourself.
- **Site edits.** Research, Ideas from notes, Draft from note, Tidy tags, Cross-link posts, Check internal links, Missing metadata, Plan a series and Check site rules. Any text in the message box is sent along with an edit, e.g. the topic to research. Your own edits can run on the post or on the whole site.

## Research notes

**Notes** in the sidebar lists markdown files in `notes/` at the site root. It sits outside `content/`, so Hugo never publishes it, but it lives next to the posts and is versioned with git. A note has YAML front matter (`title`, `date`, `status`: idea, researching, ready or drafted, and `tags`) and sections for sources and notes. **Research** has the site assistant search the web and your past posts and save what it finds as a note. **Draft from note** turns a note into a draft post. Notes are indexed with the posts, so both assistants find them with `search_posts`.

## Agent configuration

Set these as Worker secrets (`wrangler secret put NAME`), or as GitHub repository secrets, which the deploy workflow copies to each Worker:

| Secret | |
|---|---|
| `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Any one is enough. The deploy also accepts a `CLAUDE_API_KEY` repository secret as the Anthropic key, and the Live tools workflow uses it to check Claude's web search and fetch. |
| `DEEPSEEK_API_KEY`, `BRAVE_API_KEY` or `TAVILY_API_KEY` | Enables `web_search` (the first set of Brave, Tavily, DeepSeek). DeepSeek also backs `fetch_url`. |
| `EDITOR_TOKEN` | Requires this token on every `/api` call. Set it in the editor under Settings → Assistant. **Set this (or put the Worker behind Cloudflare Access) before adding model keys**, or anyone with the URL can spend them. |
| `ALLOWED_ORIGINS` | Comma-separated editor origins that may call this API from another origin, when the Assistant's agent server setting points here. |

For local work, copy `.dev.vars.example` to `.dev.vars` and run `npm run dev:worker` alongside `npm run dev`. `DEMO_MODEL=1` adds a scripted "Faux Model" that reads the post and proposes one edit, so the whole loop can be tried without keys. Preview deploys turn it on.

Folder access needs Chrome or Edge. Other browsers can use "Try a sample site", which lives in the browser's private file system.
