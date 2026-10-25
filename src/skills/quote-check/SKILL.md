---
name: quote-check
title: Check quotes
description: Verify every quote and attribution in the post word for word against the original source, and fix misquotes and missing links.
order: 120
---

# Check quotes and citations

1. Read the post with read_post. List every direct quote (in quotation marks or blockquotes), paraphrase attributed to a named person or organization, and "according to" claim.
2. For each, find the original: the first-party source (the talk, paper, post, interview transcript, docs, or social post), not an article that repeats it. Use web_search and fetch_url.
3. Compare word for word. Report:
   - **exact**: matches the source;
   - **altered**: words changed, cut without an ellipsis, or merged from two places; give the original wording;
   - **misattributed**: someone else said it, or it's commonly misattributed (check quote-investigation sites);
   - **out of context**: the source says something different once you read around it;
   - **not found**: you couldn't find a source.
4. Check each quote has a link to its source, and that the link goes to the original, not an aggregator.
5. Propose edits that fix the wording to match the source, add the source link to the existing words, or soften an unverified quote to a paraphrase. Never invent a source.
