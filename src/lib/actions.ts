// "Edits" are saved prompts the assistant runs against the open post. The
// built-in ones cover common editing passes; authors add their own in the
// Assistant panel, and those are stored in this browser. Bigger, multi-step
// tasks (fact checking, demos, SEO) are skills: see shared/builtin-skills.ts.

export interface EditAction {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
}

export const BUILTIN_ACTIONS: EditAction[] = [
  {
    id: "proofread",
    name: "Proofread",
    prompt: "Proofread the post for spelling, grammar, punctuation and typos. Propose only clear corrections, not style changes. Leave code, URLs and shortcodes alone.",
  },
  {
    id: "tighten",
    name: "Tighten",
    prompt: "Tighten the prose: cut filler, hedging, repetition and intensifiers, and split sentences that run on. Keep my voice and every claim. Propose the edits that matter most, at most 15.",
  },
  {
    id: "rules",
    name: "Check site rules",
    prompt: "Check the post against this site's writing rules and propose edits for every place that breaks them. Quote the rule in each reason.",
  },
  {
    id: "title",
    name: "Title ideas",
    prompt: "Review the title against the post's actual argument. In chat, give 5 alternative titles that are specific and make someone want to click, and say which you'd pick. If a front matter seotitle exists, compare it too. Propose the best one as an edit to the title in the front matter.",
  },
  {
    id: "links",
    name: "Suggest links",
    prompt: "Find places that should link to a primary source (spec, docs, paper, repo, announcement) or to one of my past posts (use search_posts). Verify sources with web search where you can. Propose the links as edits that turn existing words into markdown links.",
  },
  {
    id: "summary",
    name: "Write summary",
    prompt: "Write a 1 to 3 sentence summary of the post in my voice. If the front matter has a summary or description field, propose it as an edit there; otherwise give it in chat.",
  },
];

const KEY = "md-editor:custom-actions";

export function loadCustomActions(): EditAction[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveCustomActions(actions: EditAction[]) {
  localStorage.setItem(KEY, JSON.stringify(actions.filter((a) => !a.builtin)));
}
