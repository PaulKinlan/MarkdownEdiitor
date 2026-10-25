---
name: code-check
title: Check code samples
description: Check the post's code blocks for syntax errors, outdated or wrong APIs, missing context, and whether they match what the text says they do.
order: 90
---

# Check code samples

1. Read the post with read_post and find every fenced code block and inline code that names an API.
2. For each block:
   - check the syntax for its language, and that the fence has the right language tag;
   - check that it does what the surrounding text claims, step by step;
   - check names, signatures and return types of every API it uses. Use browser_support for web platform features and fetch_url on MDN, the library's docs or its repo for anything else. Flag deprecated or removed APIs and suggest the current one;
   - look for missing context a reader needs to run it: imports, HTML it expects, permissions, a secure context, top-level await, a server;
   - look for bugs: unhandled promise rejections, missing `await`, race conditions, wrong event names, leaking listeners, XSS through innerHTML, secrets in code;
   - check it is consistent with other blocks in the post (same variable names, same version).
3. Don't restyle working code (quotes, semicolons, formatting) unless the author asks.
4. Reply with a list per block: OK, or what's wrong and why, with a source link for API claims.
5. Propose edits for real errors only. Keep each fix to the lines that change.
