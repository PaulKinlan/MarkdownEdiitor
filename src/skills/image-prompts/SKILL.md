---
name: image-prompts
title: Image prompts
description: Draft prompts and captions for a header image, social card and diagrams that explain the post, matching the site's existing image style.
order: 140
---

# Image prompts and captions

Write in chat; propose edits only for captions or alt text the author asks for.

1. Read the post with read_post and run analyze_post. Check the front matter for image fields (image, images, cover, featured, og_image) and look at one or two related posts' front matter with read_past_post to see what kind of images the site uses.
2. Header or social image: give 3 concepts. Each one is a visual metaphor or concrete scene tied to the post's main point, not generic "AI brain" or "glowing network" imagery. For each, write:
   - a prompt for an image model: subject, composition, style, color palette, aspect ratio (1200x630 for social cards, or the site's existing ratio). Say "no text in the image" unless text is the point;
   - alt text;
   - a one-line caption if the site uses captions.
3. Diagrams: find up to 3 places where a diagram explains something better than prose (a process, an architecture, a comparison, a timeline). For each, say where it goes and what it shows, and give either a Mermaid or SVG sketch, or a prompt for an image model. If it needs interactivity, suggest the demo-builder skill instead.
4. Don't suggest images of real people or company logos unless the post is about them.
