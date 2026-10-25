# Security and telemetry

Every page carries a `Permissions-Policy` that denies the capabilities the editor doesn't use, and a hash-based Content Security Policy with Trusted Types, currently in report-only mode. CSP reports, browser reports (deprecations, interventions, crashes), uncaught errors and Core Web Vitals go to `POST /api/reports` and are kept, de-duplicated and redacted, in an `Observability` Durable Object. Read them with the editor token:

```sh
curl -H "Authorization: Bearer $EDITOR_TOKEN" https://<worker>/api/observability/summary
curl -H "Authorization: Bearer $EDITOR_TOKEN" "https://<worker>/api/observability/errors?since=0"
```

`/api/health` reports the deployed commit, which open editors use to notice a new deploy. Setting `KILL_SW=1` on the Worker makes installed copies remove their service worker and caches. See `THREAT_MODEL.md` and `docs/adr/`.
