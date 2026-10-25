---
name: Check internal links
scope: site
order: 60
---

Find internal links (markdown links to site-relative URLs, and ref/relref shortcodes) with grep_posts. Check each target against the URLs and paths from list_posts. Report broken links grouped by post, and propose fixes where the right target is clear.
