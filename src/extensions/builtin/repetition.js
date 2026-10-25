// Repetition: underlines words used again soon after, and lists the post's
// most used words.
import { prose } from "./text.js";

export const manifest = {
  id: "repetition",
  name: "Repetition",
  order: 60,
  description: "Underlines words repeated within a few lines of each other, and shows your most used words.",
  version: "1.0.0",
  permissions: ["post:read", "ui", "agent"],
  enabledByDefault: false,
};

const WINDOW = 40;
const STOP = new Set(
  "about above after again against also because been before being below between both could does doing down during each every from further have having here into itself just more most much must only other over same should some such than that their theirs them then there these they this those through under until very what when where which while will with would your yours yourself really thing things like make made want need know".split(
    " ",
  ),
);

/** Words of four letters or more, with offsets, lowercased. */
function tokens(post) {
  const text = prose(post);
  return [...text.matchAll(/[A-Za-z][A-Za-z’']{3,}/g)].map((m) => ({ word: m[0].toLowerCase().replace(/[’']s$/, ""), from: m.index, to: m.index + m[0].length }));
}

function analyse(post) {
  const list = tokens(post);
  const repeats = [];
  const counts = new Map();
  const lastSeen = new Map();
  list.forEach((t, i) => {
    if (STOP.has(t.word)) return;
    counts.set(t.word, (counts.get(t.word) ?? 0) + 1);
    const before = lastSeen.get(t.word);
    if (before !== undefined && i - before <= WINDOW) repeats.push({ ...t, gap: i - before });
    lastSeen.set(t.word, i);
  });
  const top = [...counts].filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return { repeats, top };
}

export default function (editor) {
  const status = editor.ui.status("repeats", "");
  let show = true;

  const update = (post) => {
    if (!post) return status.set("");
    const { repeats, top } = analyse(post);
    status.set(
      repeats.length ? `${repeats.length} repeats` : "",
      top.length ? `Most used: ${top.map(([w, n]) => `${w} (${n})`).join(", ")}` : "",
    );
    editor.document.annotate(
      "repeats",
      show ? repeats.slice(0, 300).map((r) => ({ from: r.from, to: r.to, severity: "info", message: `“${r.word}” again, ${r.gap} words after the last one` })) : [],
    );
  };

  editor.registerCommand({
    id: "toggle",
    title: "Show or hide repeated words",
    run: () => {
      show = !show;
      update(editor.document.post);
    },
  });
  editor.agent.registerTool({
    name: "repeated_words",
    description: `Words repeated within ${WINDOW} words of each other in the open post, and its most used words. Use it before varying word choice.`,
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: async () => {
      const post = await editor.document.read();
      if (!post) return { text: "No post is open.", isError: true };
      const { repeats, top } = analyse(post);
      const grouped = new Map();
      for (const r of repeats) grouped.set(r.word, (grouped.get(r.word) ?? 0) + 1);
      return [
        `Most used words: ${top.map(([w, n]) => `${w} (${n})`).join(", ") || "none used more than twice"}.`,
        grouped.size ? `Repeated close together: ${[...grouped].map(([w, n]) => `${w} ×${n}`).join(", ")}.` : "No close repeats.",
      ].join("\n");
    },
  });
  editor.on("post:open", update);
  editor.on("post:change", update);
  editor.on("post:close", () => status.set(""));
  if (editor.document.post) update(editor.document.post);
}
