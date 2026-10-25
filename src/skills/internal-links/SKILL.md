---
name: internal-links
title: Link my posts
description: Suggest links from this post to the author's earlier posts on the same site, and tags or categories the post should have.
order: 20
---

# Link to earlier posts

1. Read the post with read_post and note its main topics, named technologies, and arguments.
2. Run several search_posts queries: one per topic or named thing, plus one for the overall argument. Read the most promising hits with read_past_post to make sure they really cover the point; a matching word is not enough.
3. Pick at most 8 links that help a reader: the earlier post explains a term, gives background, or is the author's previous take on the same question. Do not link the same post twice, and do not link to this post itself.
4. Propose each as an edit that turns existing words in the post into a markdown link with the site-relative URL from search_posts, for example `[service workers](/service-workers-explained/)`. Do not add new sentences just to hold a link, unless a short "I wrote about this in ..." line clearly helps; then say so in the reason.
5. Tags: look at the tags or categories in the front matter of related posts (read_past_post, or list_terms if it is available) and suggest tags this post is missing, reusing the site's existing spelling. Propose them as an edit to the front matter, keeping its format (YAML, TOML or JSON).

Reply with the list of links and why each one fits.
