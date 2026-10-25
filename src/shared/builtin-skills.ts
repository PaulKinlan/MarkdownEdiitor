import type { Skill } from "./skills";

// Skills that ship with the editor. Site folders, the author and extensions
// can add more, or replace one of these by using the same name.

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: "fact-check",
    title: "Fact check",
    description: "Find the factual claims in the post (numbers, dates, quotes, product behaviour, attributions) and check each against sources on the web.",
    instructions: `# Fact check

1. Read the post with read_post. List every checkable claim: numbers and statistics, dates and versions, quotes and who said them, how a product or API behaves, and claims about what a person or company did. Skip opinions and predictions.
2. For each claim, search with web_search and open the best one or two sources with fetch_url. Prefer primary sources: specs, official docs, release notes, papers, the original announcement or interview. A blog that repeats a claim is weak evidence.
3. Decide for each claim: **confirmed**, **wrong**, **outdated** (true when written, not now), or **unverifiable**.
4. Reply with a short table or list: the claim (quoted briefly), the verdict, and the source URL. Put wrong and outdated claims first.
5. Propose edits only for claims that are wrong or outdated, with the correction and the source in the reason. Where a confirmed claim has no link and a reader would want one, you may propose turning the existing words into a markdown link to the source.

If web_search is not available, say so, check what you can with fetch_url on URLs already in the post, and mark the rest unverifiable.`,
  },
  {
    name: "internal-links",
    title: "Link my posts",
    description: "Suggest links from this post to the author's earlier posts on the same site, and tags or categories the post should have.",
    instructions: `# Link to earlier posts

1. Read the post with read_post and note its main topics, named technologies, and arguments.
2. Run several search_posts queries: one per topic or named thing, plus one for the overall argument. Read the most promising hits with read_past_post to make sure they really cover the point; a matching word is not enough.
3. Pick at most 8 links that help a reader: the earlier post explains a term, gives background, or is the author's previous take on the same question. Do not link the same post twice, and do not link to this post itself.
4. Propose each as an edit that turns existing words in the post into a markdown link with the site-relative URL from search_posts, for example \`[service workers](/service-workers-explained/)\`. Do not add new sentences just to hold a link, unless a short "I wrote about this in ..." line clearly helps; then say so in the reason.
5. Tags: look at the tags or categories in the front matter of related posts (read_past_post, or list_terms if it is available) and suggest tags this post is missing, reusing the site's existing spelling. Propose them as an edit to the front matter, keeping its format (YAML, TOML or JSON).

Reply with the list of links and why each one fits.`,
  },
  {
    name: "demo-builder",
    title: "Build a demo",
    description: "Turn a paragraph, idea or dataset in the post into an inline interactive demo or infographic, embedded the way the site already embeds them.",
    instructions: `# Build an inline demo or infographic

The author's sites (for example aifoc.us) include small interactive demos and infographics inside posts. Build one that helps a reader understand or test the point being made.

1. Read the post with read_post. If the author named a paragraph or idea, use that; otherwise pick the passage where an interactive element helps most and say why.
2. Find how this site embeds demos. Use search_posts for words like "demo", "interactive", "infographic", "try it", and read one or two matching posts with read_past_post. Copy their pattern exactly: a Hugo shortcode (\`{{< name ... >}}\`), a raw HTML block, or an iframe to a file under static/. Follow the site's writing rules if they describe demos.
3. If there is no existing pattern, write a self-contained block of HTML in the post: one wrapping element with a unique class, a \`<style>\` scoped to that class, and a \`<script type="module">\` that only touches elements inside the wrapper. Note in chat that Hugo needs \`markup.goldmark.renderer.unsafe = true\` for raw HTML.
4. Rules for the demo itself:
   - No external libraries or network requests unless the author asks. Plain DOM, CSS and SVG.
   - It must work with keyboard and screen readers: real buttons and inputs with labels, visible focus, text alternatives for charts.
   - It must fit a narrow phone screen and respect \`prefers-color-scheme\` and \`prefers-reduced-motion\`.
   - Use real numbers from the post or from cited sources; never invent data. Label units and sources.
   - Keep it small: one idea, one interaction.
5. Propose it with propose_edits, inserting the block after an existing sentence (find a sentence, replace it with the sentence plus the block). Give the reason as the question the demo answers.

Reply with what the demo shows, how a reader uses it, and anything the author must check.`,
  },
  {
    name: "seo-social",
    title: "SEO and social",
    description: "Draft the title, meta description, summary and social posts, and check the front matter (slug, tags, images, dates) for search and sharing.",
    instructions: `# SEO and social

1. Read the post with read_post and run analyze_post for word count, headings, links, images and front matter lengths.
2. Check the front matter and report problems:
   - title: specific, says what the reader gets, ideally under 60 characters (the full title can be longer if a separate seo title field exists).
   - description or summary: one or two sentences, 120 to 160 characters, no clickbait, matches the post.
   - slug or url: short, lowercase, words separated by hyphens.
   - date, draft, tags or categories present; tags reuse the site's existing ones (search_posts can show related posts).
   - an image for social cards if the site uses one (image, images, cover, og_image or similar), and alt text for images in the body.
3. Check the body: one clear H1 or none (Hugo themes usually render the title as H1), headings in order, the first paragraph says what the post is about, descriptive link text (not "here").
4. Draft, in chat:
   - 3 title options and which you'd pick,
   - a meta description,
   - a post for Bluesky or Mastodon (under 300 characters), one for LinkedIn (2 to 4 short sentences), and one for X (under 280 characters). Write them in the author's voice: plain, no hashtag spam, no emoji unless the author uses them.
5. Propose front matter edits for the description or summary, and for any missing or broken field, keeping the existing format. Do not change the title without the author asking; give options instead.`,
  },
  {
    name: "critique",
    title: "Editor's critique",
    description: "Give an editor's critique of structure, argument, pacing, the intro and the ending, without rewriting the post.",
    instructions: `# Editor's critique

Act like a good editor reading a draft: direct, specific, and kind. Do not rewrite the post and do not propose edits unless the author asks for them afterwards.

1. Read the post with read_post and run analyze_post for its outline and paragraph lengths.
2. In one or two sentences, say what you think the post's argument is. If you can't tell, that is the first problem.
3. Then cover, in this order, only what matters:
   - **Opening**: does the first paragraph make a reader want to keep going and tell them what they'll get? Is there throat-clearing before the point?
   - **Structure**: does each section earn its place and follow from the last? Anything to cut, merge or move?
   - **Argument**: claims without support, leaps, counterarguments a sceptical reader would raise, places where an example would help.
   - **Pacing**: sections that drag or rush, walls of text, lists that should be prose or prose that should be a list.
   - **Ending**: does it land, or trail off or repeat the intro? What should the reader do or think next?
   - **Voice**: places where it stops sounding like the author (compare with one or two past posts via search_posts and read_past_post if useful).
4. Quote short phrases to point at places; give line numbers from read_post.
5. End with the three changes that would improve the post most, in priority order.

Keep the whole critique under about 400 words.`,
  },
  {
    name: "chrome-api-check",
    title: "Check web APIs",
    description: "Check web platform and Chrome API names, syntax and browser support in the post against Chrome Status, webstatus.dev and MDN.",
    instructions: `# Check web and Chrome APIs

1. Read the post with read_post. List every web platform feature it mentions: JavaScript APIs (e.g. \`navigator.storage.getDirectory()\`), CSS properties and selectors, HTML elements and attributes, HTTP headers, Chrome extension APIs, origin trials and flags.
2. For each, call browser_support with the feature's name. It returns matches from Chrome Status (shipping milestone, status, origin trials) and webstatus.dev (Baseline status and per-browser support). Use fetch_url on the MDN page (https://developer.mozilla.org/en-US/docs/Web/API/... or /CSS/...) to check exact names, signatures and examples when the post shows code.
3. Check:
   - names and casing, method signatures, required arguments, and whether calls return promises;
   - code samples that use removed, renamed or deprecated APIs;
   - support claims ("works in all browsers", "Chrome only", "behind a flag", "in origin trial") against current data, including the Chrome version it shipped in;
   - whether the post should say the feature is Baseline (newly or widely available) or not.
4. Reply with a list: feature, what the post says, what the sources say, and a link (Chrome Status entry, webstatus.dev feature, or MDN).
5. Propose edits for wrong names, broken code and outdated support statements, citing the source in the reason. Do not add browser support tables unless asked.`,
  },
  {
    name: "data-check",
    title: "Check the data",
    description: "Check the numbers, tables, charts and calculations in the post: arithmetic, percentages, units, and whether the conclusions follow from the data.",
    instructions: `# Check the data

1. Read the post with read_post. Find every number that is derived or compared: totals, averages, percentages, growth rates, ratios, "X times faster", unit conversions, and every markdown table or data block (CSV, JSON, chart data in a shortcode or script).
2. Recompute, never estimate in your head:
   - use calculate for each derived number (for example \`(132 - 98) / 98 * 100\` for a percentage change);
   - use table_stats on each table or data block to get column totals, means, medians, ranges and percentage shares, and compare them with what the text says.
3. Check:
   - arithmetic and rounding; percentages that should add to 100;
   - percentage vs percentage points, mean vs median, relative vs absolute change;
   - units and orders of magnitude (ms vs s, KB vs KiB, per day vs per month);
   - small samples, missing baselines, cherry-picked ranges, and correlation presented as causation;
   - whether each conclusion in the text follows from the data shown;
   - whether numbers quoted from elsewhere have a source (use web_search to find it if not).
4. Reply with what is right, what is wrong (with the corrected value and the calculation), and what is weak but not wrong.
5. Propose edits for wrong numbers and conclusions, showing the calculation in the reason. Suggest, in chat, a chart or table where the data would read better that way (the demo-builder skill can build it).`,
  },
  {
    name: "alt-text",
    title: "Alt text and a11y",
    description: "Write alt text for the post's images and check accessibility: heading order, link text, tables, color-only meaning, and embedded demos.",
    instructions: `# Alt text and accessibility

1. Run analyze_post for images without alt text, skipped heading levels and vague link text, then read the post with read_post.
2. Alt text. You can't see the images, so work from the file name, caption, surrounding paragraphs and any figure shortcode attributes. For each image:
   - say what the image shows that matters for the point being made, in one sentence, usually under 125 characters;
   - don't start with "Image of" or "Picture of";
   - for charts and diagrams, give the takeaway (the trend or the relationship), and suggest a longer description in the text or a caption if the data matters;
   - decorative images get \`alt=""\`.
   Propose each as an edit to the markdown image or the shortcode's alt attribute, and say in the reason that the author should check it against the actual image.
3. Check, and propose fixes for:
   - heading levels that skip (h2 to h4) or a second h1;
   - link text that doesn't make sense out of context ("here", "this", bare URLs in prose);
   - tables without a header row, or tables used for layout;
   - meaning carried only by color or emoji;
   - embedded HTML demos: buttons and inputs without labels, missing focus styles, motion without a \`prefers-reduced-motion\` check, keyboard traps;
   - video or audio without captions or a transcript.
4. Reply with a short list of what you fixed and what the author needs to check by hand.`,
  },
  {
    name: "code-check",
    title: "Check code samples",
    description: "Check the post's code blocks for syntax errors, outdated or wrong APIs, missing context, and whether they match what the text says they do.",
    instructions: `# Check code samples

1. Read the post with read_post and find every fenced code block and inline code that names an API.
2. For each block:
   - check the syntax for its language, and that the fence has the right language tag;
   - check that it does what the surrounding text claims, step by step;
   - check names, signatures and return types of every API it uses. Use browser_support for web platform features and fetch_url on MDN, the library's docs or its repo for anything else. Flag deprecated or removed APIs and suggest the current one;
   - look for missing context a reader needs to run it: imports, HTML it expects, permissions, a secure context, top-level await, a server;
   - look for bugs: unhandled promise rejections, missing \`await\`, race conditions, wrong event names, leaking listeners, XSS through innerHTML, secrets in code;
   - check it is consistent with other blocks in the post (same variable names, same version).
3. Don't restyle working code (quotes, semicolons, formatting) unless the author asks.
4. Reply with a list per block: OK, or what's wrong and why, with a source link for API claims.
5. Propose edits for real errors only. Keep each fix to the lines that change.`,
  },
  {
    name: "headline-hook",
    title: "Headline and hook",
    description: "Work on just the title and the opening: make the title specific and the first paragraph pull the reader in, without touching the rest.",
    instructions: `# Headline and hook

Only the title (and seo title or description if they exist) and the first one or two paragraphs. Leave everything else alone.

1. Read the post with read_post. Write down, in one sentence, what the reader gets from the post. Everything below serves that sentence.
2. Opening. Check whether the first paragraph:
   - gets to the point or the tension within two or three sentences;
   - avoids throat-clearing ("In this post I will...", "Recently I have been thinking about...", a dictionary definition, a rhetorical question);
   - gives the reader a reason to care: a surprising fact, a concrete scene, a problem they have, or a clear claim.
   Propose one rewrite of the opening as an edit, in the author's voice, using only facts already in the post. If the strongest line is buried later in the post, say where it is and propose moving it up.
3. Title. In chat, give 5 options in different styles (a plain statement of the finding, a question the post answers, a how-to, a concrete number or example, and the author's own playful style if past posts show one; check with search_posts). Each must be accurate: no promise the post doesn't keep. Say which you'd pick. Don't change the title in the front matter unless asked.
4. Keep the author's voice. No hype words, no clickbait, no colon-subtitle formula unless the author uses it.`,
  },
  {
    name: "update-notes",
    title: "Series and updates",
    description: "When the post revisits or follows an earlier one: add cross-links both ways, an 'Update' note for the old post, and series front matter.",
    instructions: `# Series and update notes

1. Read the post with read_post. Use search_posts (several queries on its main topics and named things) and read_past_post to find earlier posts it continues, corrects or contradicts.
2. For this post, propose edits that:
   - mention and link the earlier post near where it becomes relevant, saying what changed since ("Two years ago I argued X; here's what changed.");
   - add series front matter if the site uses it (check related posts for a \`series\`, \`related\` or similar field and reuse the same key and value).
3. For each earlier post, you can't edit it from here. Instead, draft in chat the exact text to add to it, in the author's voice:
   - an "Update (date):" note for the top or the relevant section, one or two sentences, linking to this post;
   - which existing sentence it belongs after.
   Give the earlier post's path so the author can open it.
4. If this post contradicts an earlier one, say so plainly and suggest whether the old post needs a correction note rather than just a link.`,
  },
  {
    name: "quote-check",
    title: "Check quotes",
    description: "Verify every quote and attribution in the post word for word against the original source, and fix misquotes and missing links.",
    instructions: `# Check quotes and citations

1. Read the post with read_post. List every direct quote (in quotation marks or blockquotes), paraphrase attributed to a named person or organization, and "according to" claim.
2. For each, find the original: the first-party source (the talk, paper, post, interview transcript, docs, or social post), not an article that repeats it. Use web_search and fetch_url.
3. Compare word for word. Report:
   - **exact**: matches the source;
   - **altered**: words changed, cut without an ellipsis, or merged from two places; give the original wording;
   - **misattributed**: someone else said it, or it's commonly misattributed (check quote-investigation sites);
   - **out of context**: the source says something different once you read around it;
   - **not found**: you couldn't find a source.
4. Check each quote has a link to its source, and that the link goes to the original, not an aggregator.
5. Propose edits that fix the wording to match the source, add the source link to the existing words, or soften an unverified quote to a paraphrase. Never invent a source.`,
  },
  {
    name: "newsletter",
    title: "Newsletter digest",
    description: "Turn the post into a short newsletter section: a subject line, a teaser, the key points and a link, in the author's voice.",
    instructions: `# Newsletter digest

Write in chat; don't propose edits to the post.

1. Read the post with read_post. Find its main point, the two or three most useful details, and the best single line.
2. If the author's past posts include newsletters or "weekly" round-ups (check with search_posts), match their format and tone.
3. Write:
   - **Subject line**: under 50 characters, specific, no clickbait. Give two options.
   - **Preview text**: under 90 characters, adding to the subject rather than repeating it.
   - **Section**: a heading, then 80 to 150 words: what the post is about and why it matters to the reader, the key points as two or three short bullets or sentences, and a call to read the full post with its full URL (the site URL plus the post's path).
   - **One-line version**: a single sentence with the link, for a round-up list.
4. Use only facts from the post. Keep the author's voice: plain and direct, with no hype words or exclamation marks unless the author uses them.`,
  },
  {
    name: "image-prompts",
    title: "Image prompts",
    description: "Draft prompts and captions for a header image, social card and diagrams that explain the post, matching the site's existing image style.",
    instructions: `# Image prompts and captions

Write in chat; propose edits only for captions or alt text the author asks for.

1. Read the post with read_post and run analyze_post. Check the front matter for image fields (image, images, cover, featured, og_image) and look at one or two related posts' front matter with read_past_post to see what kind of images the site uses.
2. Header or social image: give 3 concepts. Each one is a visual metaphor or concrete scene tied to the post's main point, not generic "AI brain" or "glowing network" imagery. For each, write:
   - a prompt for an image model: subject, composition, style, color palette, aspect ratio (1200x630 for social cards, or the site's existing ratio). Say "no text in the image" unless text is the point;
   - alt text;
   - a one-line caption if the site uses captions.
3. Diagrams: find up to 3 places where a diagram explains something better than prose (a process, an architecture, a comparison, a timeline). For each, say where it goes and what it shows, and give either a Mermaid or SVG sketch, or a prompt for an image model. If it needs interactivity, suggest the demo-builder skill instead.
4. Don't suggest images of real people or company logos unless the post is about them.`,
  },
];
