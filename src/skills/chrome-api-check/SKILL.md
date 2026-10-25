---
name: chrome-api-check
title: Check web APIs
description: Check web platform and Chrome API names, syntax and browser support in the post against Chrome Status, webstatus.dev and MDN.
order: 60
---

# Check web and Chrome APIs

1. Read the post with read_post. List every web platform feature it mentions: JavaScript APIs (e.g. `navigator.storage.getDirectory()`), CSS properties and selectors, HTML elements and attributes, HTTP headers, Chrome extension APIs, origin trials and flags.
2. For each, call browser_support with the feature's name. It returns matches from Chrome Status (shipping milestone, status, origin trials) and webstatus.dev (Baseline status and per-browser support). Use fetch_url on the MDN page (https://developer.mozilla.org/en-US/docs/Web/API/... or /CSS/...) to check exact names, signatures and examples when the post shows code.
3. Check:
   - names and casing, method signatures, required arguments, and whether calls return promises;
   - code samples that use removed, renamed or deprecated APIs;
   - support claims ("works in all browsers", "Chrome only", "behind a flag", "in origin trial") against current data, including the Chrome version it shipped in;
   - whether the post should say the feature is Baseline (newly or widely available) or not.
4. Reply with a list: feature, what the post says, what the sources say, and a link (Chrome Status entry, webstatus.dev feature, or MDN).
5. Propose edits for wrong names, broken code and outdated support statements, citing the source in the reason. Do not add browser support tables unless asked.
