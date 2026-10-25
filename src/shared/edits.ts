import type { Edit } from "./protocol";

/** Keeps edits whose `find` occurs exactly once; explains the rest so the model can retry. */
export function checkEdits(text: string, edits: readonly Edit[]): { valid: Edit[]; problems: string[] } {
  const valid: Edit[] = [];
  const problems: string[] = [];
  for (const [i, edit] of edits.entries()) {
    if (!edit.find) {
      problems.push(`Edit ${i + 1}: empty find.`);
      continue;
    }
    if (edit.find === edit.replace) {
      problems.push(`Edit ${i + 1}: find and replace are the same.`);
      continue;
    }
    const first = text.indexOf(edit.find);
    if (first === -1) {
      problems.push(`Edit ${i + 1}: text not found (copy it exactly, without line numbers): ${JSON.stringify(edit.find.slice(0, 80))}`);
    } else if (text.indexOf(edit.find, first + 1) !== -1) {
      problems.push(`Edit ${i + 1}: text occurs more than once; include more surrounding words: ${JSON.stringify(edit.find.slice(0, 80))}`);
    } else {
      valid.push({ find: edit.find, replace: edit.replace, ...(edit.reason ? { reason: edit.reason } : {}) });
    }
  }
  return { valid, problems };
}
