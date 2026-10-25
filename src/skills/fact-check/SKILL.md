---
name: fact-check
title: Fact check
description: Find the factual claims in the post (numbers, dates, quotes, product behaviour, attributions) and check each against sources on the web.
order: 10
---

# Fact check

1. Read the post with read_post. List every checkable claim: numbers and statistics, dates and versions, quotes and who said them, how a product or API behaves, and claims about what a person or company did. Skip opinions and predictions.
2. For each claim, search with web_search and open the best one or two sources with fetch_url. Prefer primary sources: specs, official docs, release notes, papers, the original announcement or interview. A blog that repeats a claim is weak evidence.
3. Decide for each claim: **confirmed**, **wrong**, **outdated** (true when written, not now), or **unverifiable**.
4. Reply with a short table or list: the claim (quoted briefly), the verdict, and the source URL. Put wrong and outdated claims first.
5. Propose edits only for claims that are wrong or outdated, with the correction and the source in the reason. Where a confirmed claim has no link and a reader would want one, you may propose turning the existing words into a markdown link to the source.

If web_search is not available, say so, check what you can with fetch_url on URLs already in the post, and mark the rest unverifiable.
