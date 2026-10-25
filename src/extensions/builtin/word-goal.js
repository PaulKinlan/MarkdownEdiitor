// Word goal: a target for the post, from its front matter (wordGoal) or set
// with a command, with progress in the status bar.
import { bodyWords, frontMatter } from "./text.js";

export const manifest = {
  id: "word-goal",
  name: "Word goal",
  order: 20,
  description: "Shows progress towards a word count goal, set per post with a command or a wordGoal front matter field.",
  version: "1.0.0",
  permissions: ["post:read", "ui"],
};

export default function (editor) {
  const status = editor.ui.status("goal", "");
  let goals = {};

  const goalFor = (post) => {
    const fm = frontMatter(post);
    const fromFrontMatter = Number(fm.wordgoal ?? fm.word_goal ?? fm.wordcount_goal);
    return fromFrontMatter > 0 ? fromFrontMatter : goals[post.path];
  };

  const update = (post) => {
    const goal = post && goalFor(post);
    if (!goal) return status.set("");
    const words = bodyWords(post).length;
    const percent = Math.round((words / goal) * 100);
    const left = goal - words;
    status.set(
      `${percent >= 100 ? "✓ " : ""}${words.toLocaleString()} / ${goal.toLocaleString()} words`,
      left > 0 ? `${left.toLocaleString()} words to go (${percent}%)` : `Goal reached (${percent}%)`,
    );
  };

  editor.registerCommand({
    id: "set",
    title: "Set word goal…",
    run: async () => {
      const post = await editor.document.read();
      if (!post) return editor.ui.notify("Open a post first.");
      const answer = await editor.ui.input("Word goal for this post (blank to clear)", String(goals[post.path] ?? ""));
      if (answer === null) return;
      const goal = Math.round(Number(answer.replace(/[,\s]/g, "")));
      if (goal > 0) goals[post.path] = goal;
      else delete goals[post.path];
      await editor.storage.set("goals", goals);
      update(post);
    },
  });

  editor.on("post:open", update);
  editor.on("post:change", update);
  editor.on("post:close", () => status.set(""));
  return editor.storage.get("goals").then((saved) => {
    goals = saved ?? {};
    if (editor.document.post) update(editor.document.post);
  });
}
