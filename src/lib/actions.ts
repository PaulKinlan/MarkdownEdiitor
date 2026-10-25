// "Edits" are saved prompts the assistant runs against the open post, or,
// for site edits, across the whole site. The built-in ones cover common
// passes; authors add their own in the Assistant panel, and those are stored
// in this browser. Bigger, multi-step tasks (fact checking, demos, SEO) are
// skills: see shared/builtin-skills.ts.

export type ActionScope = "post" | "site";

export interface EditAction {
  id: string;
  name: string;
  prompt: string;
  builtin?: boolean;
  /** Which assistant runs it. Missing means "post", as edits saved before site edits existed were. */
  scope?: ActionScope;
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

export const SITE_ACTIONS: EditAction[] = [
  {
    id: "site-research",
    name: "Research",
    scope: "site",
    prompt:
      "Research the topic below for a future post. Search the web for primary sources and recent developments, check the important ones with fetch_url, and search my past posts for what I've already said about it. Save it as a new note (or add to the matching note if one exists), then tell me in chat the 3 most interesting angles for a post. If no topic is given below, ask me for one.",
  },
  {
    id: "site-ideas",
    name: "Ideas from notes",
    scope: "site",
    prompt:
      "Read my notes (list_posts notes=true) and say which are closest to being a post, what each still needs, and which notes belong together. Suggest status changes as edits where a note has clearly moved on.",
  },
  {
    id: "site-draft",
    name: "Draft from note",
    scope: "site",
    prompt:
      "Turn the note below (or the note I have open) into a draft post: create it as a draft in the right section with front matter shaped like my recent posts there, a working title, an outline in my voice, and the note's sources as links. Then mark the note as drafted. If it's unclear which note, ask me.",
  },
  {
    id: "site-tags",
    name: "Tidy tags",
    scope: "site",
    prompt:
      "Use list_terms on tags and on categories. Find duplicates and near-duplicates (case, plurals, spelling, synonyms) and one-off terms. Show me a short table of the merges you suggest and wait for my OK before proposing any changes.",
  },
  {
    id: "site-related",
    name: "Cross-link posts",
    scope: "site",
    prompt:
      "Find groups of posts on the same topic that don't link to each other yet (search_posts, grep_posts for existing links). Propose inline links where a post mentions something another post covers in depth, turning existing words into markdown links with site-relative URLs. At most 10 files.",
  },
  {
    id: "site-links",
    name: "Check internal links",
    scope: "site",
    prompt:
      "Find internal links (markdown links to site-relative URLs, and ref/relref shortcodes) with grep_posts. Check each target against the URLs and paths from list_posts. Report broken links grouped by post, and propose fixes where the right target is clear.",
  },
  {
    id: "site-metadata",
    name: "Missing metadata",
    scope: "site",
    prompt:
      "Find which front matter fields most posts on this site use (summary, description, tags, images…), then list the posts missing them. Propose values in my voice for the 10 most recent published posts missing a summary or description; report the rest.",
  },
  {
    id: "site-series",
    name: "Plan a series",
    scope: "site",
    prompt:
      "Look at what I've written over the last year (list_posts with since). Suggest 3 series I could write next that build on those posts: for each, a title, 4 to 6 post ideas with one line each, and the existing posts each would link back to. Do not propose changes.",
  },
  {
    id: "site-rules",
    name: "Check site rules",
    scope: "site",
    prompt:
      "Check the 10 most recent posts against this site's writing rules. Report which rules are broken most often, with examples, and propose edits for clear breaks. Quote the rule in each reason.",
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
