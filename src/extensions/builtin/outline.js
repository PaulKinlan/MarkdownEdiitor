// Outline: the post's headings in a side panel; click one to jump to it.
import { bodyWords, escapeHtml, headings } from "./text.js";

export const manifest = {
  id: "outline",
  name: "Outline",
  description: "Shows the post's headings, with words per section, in an Outline panel. Click a heading to jump to it.",
  version: "1.0.0",
  permissions: ["post:read", "ui"],
};

function sections(post) {
  const list = headings(post);
  return list.map((h, i) => {
    const end = i + 1 < list.length ? list[i + 1].from : post.text.length;
    const words = bodyWords({ text: post.text.slice(0, end), bodyStart: h.to }).length;
    return { ...h, words };
  });
}

export default function (editor) {
  const panel = editor.ui.panel({ id: "outline", title: "Outline" });
  let last = "";

  const render = (post) => {
    const list = post ? sections(post) : [];
    const html = `<!doctype html><meta name="color-scheme" content="light dark">
<style>
  body { font: 13px/1.5 system-ui, sans-serif; margin: 12px; }
  ol { list-style: none; padding: 0; margin: 0; }
  button { all: unset; cursor: pointer; display: flex; gap: 8px; justify-content: space-between; width: 100%; box-sizing: border-box; padding: 3px 6px; border-radius: 6px; }
  button:hover, button:focus-visible { background: color-mix(in srgb, currentColor 10%, transparent); }
  .words { opacity: .55; font-variant-numeric: tabular-nums; white-space: nowrap; }
  p { opacity: .7; }
</style>
${
  !post
    ? "<p>Open a post to see its outline.</p>"
    : list.length
      ? `<ol>${list
          .map(
            (h) =>
              `<li><button style="padding-left:${(h.level - 1) * 14 + 6}px" data-from="${h.from}" data-to="${h.to}"><span>${escapeHtml(h.text)}</span><span class="words">${h.words}</span></button></li>`,
          )
          .join("")}</ol>`
      : "<p>No headings yet. Lines starting with ## become sections here.</p>"
}
<script>
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-from]");
    if (b) parent.postMessage({ from: Number(b.dataset.from), to: Number(b.dataset.to) }, "*");
  });
</script>`;
    if (html !== last) void panel.render((last = html));
  };

  panel.onMessage(({ from, to }) => editor.document.select(from, to));
  editor.on("post:open", render);
  editor.on("post:change", render);
  editor.on("post:close", () => render(null));
  render(editor.document.post);
}
