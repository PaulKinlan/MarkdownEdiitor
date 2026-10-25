---
name: demo-builder
title: Build a demo
description: Turn a paragraph, idea or dataset in the post into an inline interactive demo or infographic, embedded the way the site already embeds them.
order: 30
---

# Build an inline demo or infographic

The author's sites (for example aifoc.us) include small interactive demos and infographics inside posts. Build one that helps a reader understand or test the point being made.

1. Read the post with read_post. If the author named a paragraph or idea, use that; otherwise pick the passage where an interactive element helps most and say why.
2. Find how this site embeds demos. Use search_posts for words like "demo", "interactive", "infographic", "try it", and read one or two matching posts with read_past_post. Copy their pattern exactly: a Hugo shortcode (`{{< name ... >}}`), a raw HTML block, or an iframe to a file under static/. Follow the site's writing rules if they describe demos.
3. If there is no existing pattern, write a self-contained block of HTML in the post: one wrapping element with a unique class, a `<style>` scoped to that class, and a `<script type="module">` that only touches elements inside the wrapper. Note in chat that Hugo needs `markup.goldmark.renderer.unsafe = true` for raw HTML.
4. Rules for the demo itself:
   - No external libraries or network requests unless the author asks. Plain DOM, CSS and SVG.
   - It must work with keyboard and screen readers: real buttons and inputs with labels, visible focus, text alternatives for charts.
   - It must fit a narrow phone screen and respect `prefers-color-scheme` and `prefers-reduced-motion`.
   - Use real numbers from the post or from cited sources; never invent data. Label units and sources.
   - Keep it small: one idea, one interaction.
5. Propose it with propose_edits, inserting the block after an existing sentence (find a sentence, replace it with the sentence plus the block). Give the reason as the question the demo answers.

Reply with what the demo shows, how a reader uses it, and anything the author must check.
