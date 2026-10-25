---
name: alt-text
title: Alt text and a11y
description: "Write alt text for the post's images and check accessibility: heading order, link text, tables, color-only meaning, and embedded demos."
order: 80
---

# Alt text and accessibility

1. Run analyze_post for images without alt text, skipped heading levels and vague link text, then read the post with read_post.
2. Alt text. You can't see the images, so work from the file name, caption, surrounding paragraphs and any figure shortcode attributes. For each image:
   - say what the image shows that matters for the point being made, in one sentence, usually under 125 characters;
   - don't start with "Image of" or "Picture of";
   - for charts and diagrams, give the takeaway (the trend or the relationship), and suggest a longer description in the text or a caption if the data matters;
   - decorative images get `alt=""`.
   Propose each as an edit to the markdown image or the shortcode's alt attribute, and say in the reason that the author should check it against the actual image.
3. Check, and propose fixes for:
   - heading levels that skip (h2 to h4) or a second h1;
   - link text that doesn't make sense out of context ("here", "this", bare URLs in prose);
   - tables without a header row, or tables used for layout;
   - meaning carried only by color or emoji;
   - embedded HTML demos: buttons and inputs without labels, missing focus styles, motion without a `prefers-reduced-motion` check, keyboard traps;
   - video or audio without captions or a transcript.
4. Reply with a short list of what you fixed and what the author needs to check by hand.
