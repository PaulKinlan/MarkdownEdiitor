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
];
