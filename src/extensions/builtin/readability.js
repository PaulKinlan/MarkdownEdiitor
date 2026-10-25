// Readability: a grade level in the status bar, long sentences underlined,
// and a tool and quick edit so the assistant can work on them.
import { lineOf, prose, sentences, syllables, words } from "./text.js";

export const manifest = {
  id: "readability",
  name: "Readability",
  order: 50,
  description: "Shows the post's reading grade, underlines long sentences, and gives the assistant a readability report.",
  version: "1.0.0",
  permissions: ["post:read", "ui", "agent"],
};

const LONG = 30;

function analyse(post) {
  const text = prose(post);
  const list = sentences(text).map((s) => ({ ...s, words: words(s.text).length }));
  const allWords = list.flatMap((s) => words(s.text));
  const syllableCount = allWords.reduce((n, w) => n + syllables(w), 0);
  const grade = allWords.length && list.length ? 0.39 * (allWords.length / list.length) + 11.8 * (syllableCount / allWords.length) - 15.59 : 0;
  return { grade: Math.max(0, grade), sentences: list, words: allWords.length, long: list.filter((s) => s.words > LONG) };
}

export default function (editor) {
  let show = true;
  const status = editor.ui.status("grade", "Grade –");

  const update = (post) => {
    if (!post) return status.set("");
    const result = analyse(post);
    status.set(`Grade ${result.grade.toFixed(1)}`, `Flesch-Kincaid grade level over ${result.words} words. ${result.long.length} sentences over ${LONG} words.`);
    editor.document.annotate(
      "long-sentences",
      show ? result.long.map((s) => ({ from: s.from, to: s.to, severity: "info", message: `Long sentence: ${s.words} words` })) : [],
    );
  };
  editor.on("post:open", update);
  editor.on("post:change", update);
  editor.on("post:close", () => status.set(""));
  if (editor.document.post) update(editor.document.post);

  editor.registerCommand({
    id: "toggle",
    title: "Show or hide long sentences",
    key: "Mod-Shift-l",
    run: () => {
      show = !show;
      update(editor.document.post);
      editor.ui.notify(show ? "Underlining long sentences" : "Long sentences hidden");
    },
  });

  editor.agent.registerTool({
    name: "readability_report",
    description: `Reading grade of the post and every sentence over ${LONG} words, with line numbers. Use it before shortening or simplifying prose.`,
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: async () => {
      const post = await editor.document.read();
      if (!post) return { text: "No post is open.", isError: true };
      const result = analyse(post);
      const lines = [
        `Flesch-Kincaid grade ${result.grade.toFixed(1)} over ${result.words} words in ${result.sentences.length} sentences.`,
        result.long.length ? `Sentences over ${LONG} words:` : `No sentences over ${LONG} words.`,
        ...result.long.map((s) => `- line ${lineOf(post.text, s.from)} (${s.words} words): ${s.text}`),
      ];
      return lines.join("\n");
    },
  });

  editor.agent.registerEdit({
    id: "shorten",
    name: "Shorten long sentences",
    prompt: `Call readability_report, then propose edits that split or shorten each sentence over ${LONG} words. Keep my voice and every claim.`,
  });
}
