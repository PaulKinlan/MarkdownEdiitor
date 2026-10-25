// Writing streak: words written per day in this browser, and the run of days
// you've written on.
import { bodyWords, escapeHtml, today } from "./text.js";

export const manifest = {
  id: "writing-streak",
  name: "Writing streak",
  description: "Counts the words you write each day and shows your streak of writing days, with a history panel.",
  version: "1.0.0",
  permissions: ["post:read", "ui"],
};

const DAY_MS = 86_400_000;

function streak(days) {
  let count = 0;
  let date = new Date();
  // Today still counts as the streak's day until it ends.
  if (!days[today(date)]) date = new Date(date.getTime() - DAY_MS);
  while (days[today(date)] > 0) {
    count++;
    date = new Date(date.getTime() - DAY_MS);
  }
  return count;
}

export default async function (editor) {
  const status = editor.ui.status("streak", "");
  const panel = editor.ui.panel({ id: "history", title: "Streak" });
  let days = (await editor.storage.get("days")) ?? {};
  const seen = new Map();
  let saveTimer;

  const render = () => {
    const n = streak(days);
    const written = days[today()] ?? 0;
    status.set(n ? `🔥 ${n} day${n === 1 ? "" : "s"} · ${written.toLocaleString()} today` : written ? `${written.toLocaleString()} words today` : "", "Words you've written per day, in this browser");
    const last = Array.from({ length: 14 }, (_, i) => today(new Date(Date.now() - (13 - i) * DAY_MS)));
    const max = Math.max(1, ...last.map((d) => days[d] ?? 0));
    void panel.render(`<!doctype html><meta name="color-scheme" content="light dark">
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 12px; }
  .bars { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; align-items: end; height: 120px; margin: 12px 0 4px; }
  .bar { background: color-mix(in srgb, CanvasText 60%, transparent); border-radius: 3px 3px 0 0; min-height: 2px; }
  .labels { display: grid; grid-template-columns: repeat(14, 1fr); gap: 4px; font-size: 10px; opacity: .6; text-align: center; }
</style>
<p><strong>${n}</strong> day streak · <strong>${written.toLocaleString()}</strong> words today</p>
<div class="bars">${last.map((d) => `<div class="bar" title="${escapeHtml(d)}: ${days[d] ?? 0} words" style="height:${((days[d] ?? 0) / max) * 100}%"></div>`).join("")}</div>
<div class="labels">${last.map((d) => `<span>${Number(d.slice(8))}</span>`).join("")}</div>`);
  };

  const count = (post) => bodyWords(post).length;
  editor.on("post:open", (post) => seen.set(post.path, count(post)));
  editor.on("post:change", (post) => {
    const now = count(post);
    const before = seen.get(post.path) ?? now;
    seen.set(post.path, now);
    if (now <= before) return;
    days[today()] = (days[today()] ?? 0) + (now - before);
    // Keep about a year.
    const cutoff = today(new Date(Date.now() - 400 * DAY_MS));
    for (const d of Object.keys(days)) if (d < cutoff) delete days[d];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => editor.storage.set("days", days), 2000);
    render();
  });
  if (editor.document.post) seen.set(editor.document.post.path, count(editor.document.post));
  render();
  setInterval(render, 60 * 60 * 1000);
}
