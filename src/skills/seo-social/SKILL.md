---
name: seo-social
title: SEO and social
description: Draft the title, meta description, summary and social posts, and check the front matter (slug, tags, images, dates) for search and sharing.
order: 40
---

# SEO and social

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
5. Propose front matter edits for the description or summary, and for any missing or broken field, keeping the existing format. Do not change the title without the author asking; give options instead.
