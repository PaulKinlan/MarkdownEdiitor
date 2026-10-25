// SEO check: title and description length, a missing summary, heading
// order, image alt text and vague link text.
import { frontMatter, headings, lineOf } from "./text.js";

export const manifest = {
  id: "seo-check",
  name: "SEO check",
  description: "Checks title and description length, heading order, image alt text and link text, and gives the assistant an SEO report.",
  version: "1.0.0",
  permissions: ["post:read", "ui", "agent"],
};

const TITLE = [20, 60];
const DESCRIPTION = [50, 160];
const VAGUE = /^(here|click here|this|link|this link|read more|more)$/i;

export function check(post) {
  const fm = frontMatter(post);
  const issues = [];
  const title = String(fm.seotitle ?? fm.title ?? "");
  const titleField = fm.seotitle ? "seotitle" : "title";
  if (!title) issues.push({ level: "warning", message: "No title." });
  else if (title.length > TITLE[1]) issues.push({ level: "warning", message: `The ${titleField} is ${title.length} characters; search results cut it off after about ${TITLE[1]}.` });
  else if (title.length < TITLE[0]) issues.push({ level: "info", message: `The ${titleField} is only ${title.length} characters; ${TITLE[0]}–${TITLE[1]} gives search results more to show.` });
  const descriptionField = ["description", "summary", "seodescription"].find((k) => fm[k]);
  const description = descriptionField ? String(fm[descriptionField]) : "";
  if (!description) issues.push({ level: "warning", message: "No description or summary in the front matter, so search engines pick their own snippet." });
  else if (description.length > DESCRIPTION[1]) issues.push({ level: "info", message: `The ${descriptionField} is ${description.length} characters; search results show about ${DESCRIPTION[1]}.` });
  else if (description.length < DESCRIPTION[0]) issues.push({ level: "info", message: `The ${descriptionField} is only ${description.length} characters.` });

  let previous = 1;
  for (const h of headings(post)) {
    if (h.level === 1) issues.push({ level: "info", message: "A level 1 heading in the body; most themes already show the title as the page's h1.", from: h.from, to: h.to });
    else if (h.level > previous + 1) issues.push({ level: "warning", message: `Heading jumps from level ${previous} to ${h.level}.`, from: h.from, to: h.to });
    previous = h.level;
  }
  const body = post.text.slice(post.bodyStart);
  for (const m of body.matchAll(/!\[([^\]]*)\]\([^)]*\)/g)) {
    if (!m[1].trim()) issues.push({ level: "warning", message: "Image without alt text.", from: post.bodyStart + m.index, to: post.bodyStart + m.index + m[0].length });
  }
  for (const m of body.matchAll(/\{\{<\s*figure\b[^>]*>\}\}/g)) {
    if (!/\balt\s*=\s*"[^"]+"/.test(m[0])) issues.push({ level: "warning", message: "Figure without alt text.", from: post.bodyStart + m.index, to: post.bodyStart + m.index + m[0].length });
  }
  for (const m of body.matchAll(/(?<!!)\[([^\]]+)\]\([^)]*\)/g)) {
    if (VAGUE.test(m[1].trim())) issues.push({ level: "info", message: `Link text “${m[1]}” doesn't say where it goes.`, from: post.bodyStart + m.index, to: post.bodyStart + m.index + m[0].length });
  }
  return issues;
}

export default function (editor) {
  const status = editor.ui.status("seo", "");
  const update = (post) => {
    if (!post) return status.set("");
    const issues = check(post);
    const warnings = issues.filter((i) => i.level === "warning").length;
    status.set(issues.length ? `SEO: ${issues.length} to check` : "SEO ✓", issues.map((i) => `• ${i.message}`).join("\n") || "No SEO issues found.");
    editor.document.annotate(
      "seo",
      issues.filter((i) => i.from !== undefined).map((i) => ({ from: i.from, to: i.to, severity: i.level, message: `SEO: ${i.message}` })),
    );
    return warnings;
  };
  editor.agent.registerTool({
    name: "seo_report",
    description: "SEO problems in the open post: title and description length, missing summary, heading order, images without alt text, vague link text. Use before improving a post's SEO.",
    parameters: { type: "object", properties: {} },
    replay: "safe",
    execute: async () => {
      const post = await editor.document.read();
      if (!post) return { text: "No post is open.", isError: true };
      const issues = check(post);
      return issues.length
        ? issues.map((i) => `- [${i.level}]${i.from !== undefined ? ` line ${lineOf(post.text, i.from)}:` : ""} ${i.message}`).join("\n")
        : "No SEO issues found.";
    },
  });
  editor.agent.registerEdit({
    id: "fix",
    name: "Fix SEO issues",
    prompt: "Call seo_report, then propose edits that fix each issue: a title and description of the right length in my voice, alt text that describes each image, clearer link text and heading levels. Explain any you'd leave alone.",
  });
  editor.on("post:open", update);
  editor.on("post:change", update);
  editor.on("post:close", () => status.set(""));
  if (editor.document.post) update(editor.document.post);
}
