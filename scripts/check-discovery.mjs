#!/usr/bin/env node
// Checks the files browsers, crawlers and agents look for at fixed paths
// (public/), and that the security headers are still declared. Fails CI when
// security.txt is about to expire, so it is renewed before it lapses.
import { readFile } from "node:fs/promises";

const pub = new URL("../public/", import.meta.url);
const read = (path) => readFile(new URL(path, pub), "utf8");
const problems = [];
const check = (ok, message) => ok || problems.push(message);

const security = await read(".well-known/security.txt");
check(/^Contact: \S+/m.test(security), "security.txt needs a Contact: line");
const expires = Date.parse(security.match(/^Expires: (.+)$/m)?.[1] ?? "");
const days = (expires - Date.now()) / 86_400_000;
check(days > 30, `security.txt expires in ${Math.floor(days)} days: move Expires: forward (at most a year)`);
check(days <= 366, "security.txt Expires: should be at most a year away (RFC 9116)");

const advice = JSON.parse(await read(".well-known/traffic-advice"));
check(Array.isArray(advice) && advice.some((a) => a.user_agent === "prefetch-proxy"), "traffic-advice needs a prefetch-proxy entry");

for (const file of ["robots.txt", "humans.txt", "llms.txt"]) check((await read(file)).trim().length > 0, `${file} is empty`);
check(/^# /m.test(await read("llms.txt")), "llms.txt should start with a # title");

const manifest = JSON.parse(await read("manifest.webmanifest"));
for (const key of ["id", "name", "short_name", "start_url", "display", "background_color", "theme_color", "icons"]) check(key in manifest, `manifest.webmanifest is missing ${key}`);
check(manifest.icons?.some((i) => i.purpose?.includes("maskable")), "manifest.webmanifest needs a maskable icon");
const forms = new Set((manifest.screenshots ?? []).map((s) => s.form_factor));
check(forms.has("wide") && forms.has("narrow"), "manifest.webmanifest needs wide and narrow screenshots");

const headers = await read("_headers");
for (const h of ["Permissions-Policy", "Content-Security-Policy:", "Content-Security-Policy-Report-Only", "X-Content-Type-Options", "Reporting-Endpoints"]) {
  check(headers.includes(h), `_headers no longer sets ${h}`);
}
check(headers.includes("__SCRIPT_HASHES__"), "_headers lost the __SCRIPT_HASHES__ placeholder the build fills in");
check(!/unsafe-(inline|eval)/.test(headers), "_headers must not allow unsafe-inline or unsafe-eval");

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok   discovery files and security headers");
