#!/usr/bin/env node
// Fails when the built app grows past perf-budget.json. Run after `npm run build`.
// The budget is a ratchet: when a change makes the app smaller, lower the
// numbers in the same PR; raising them needs a note in docs/adr/ saying why.
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budget = JSON.parse(await readFile(new URL("../perf-budget.json", import.meta.url), "utf8"));
const dist = new URL("../dist/", import.meta.url);
const html = await readFile(new URL("index.html", dist));
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;

const text = html.toString();
const css = [...text.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\/([^"]+)"/g)].map((m) => m[1]);
const entries = [...text.matchAll(/<script[^>]+type="module"[^>]+src="\/([^"]+)"/g)].map((m) => m[1]);
const preloads = [...text.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/([^"]+)"/g)].map((m) => m[1]);

let critical = gz(html);
for (const f of css) critical += gz(await readFile(new URL(f, dist)));
let bootJs = 0;
for (const f of new Set([...entries, ...preloads])) bootJs += gz(await readFile(new URL(f, dist)));
const blocking = [...text.matchAll(/<script(?![^>]*\b(type="module"|async|defer))[^>]*\bsrc=/g)].length;

const checks = [
  ["Critical HTML + CSS (gzip)", critical, budget.criticalHtmlCssGzipBytes],
  ["Boot JavaScript (gzip)", bootJs, budget.bootJsGzipBytes],
  ["Render-blocking external scripts", blocking, budget.renderBlockingScripts],
];
let failed = false;
for (const [name, actual, limit] of checks) {
  const ok = actual <= limit;
  failed ||= !ok;
  const show = name.includes("gzip") ? kib : String;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${show(actual)} (budget ${show(limit)})`);
}
process.exit(failed ? 1 : 0);
