import { html } from "lit";
import { defineModule, type ShellChange } from "../../core/modules";
import { applyDictionary, canUseDictionary, parseWordList, siteWords } from "./spelling";

const KEY = "md-editor:spellcheck";

// Spell checking in the editor, and the site's words (plus its tags and
// categories) in Chrome's custom dictionary so they aren't marked.
export default defineModule({
  id: "spelling",
  name: "Spell check",
  order: 30,
  activate({ shell, addSettingsSection, setEditorOption }) {
    let on = localStorage.getItem(KEY) !== "false";
    setEditorOption("spellcheck", on);
    const setOn = (value: boolean) => {
      on = value;
      localStorage.setItem(KEY, String(value));
      setEditorOption("spellcheck", value);
    };
    const onChange = (e: Event) => {
      const changed = (e as ShellChange).detail;
      if (!(changed.has("posts") || changed.has("site")) || !canUseDictionary()) return;
      applyDictionary(shell.site ? siteWords(shell.posts, parseWordList(shell.site.words ?? "")) : []);
    };
    shell.addEventListener("change", onChange);

    addSettingsSection({
      id: "spelling",
      order: 30,
      render: () => html`<label>Spell check words
          <textarea
            rows="3"
            placeholder="Hugo, WebMCP, aifoc.us"
            .value=${shell.site?.words ?? ""}
            @change=${(e: Event) => void shell.updateSite({ words: (e.target as HTMLTextAreaElement).value })}
          ></textarea>
        </label>
        <p class="muted">
          <label class="inline"><input type="checkbox" .checked=${on} @change=${(e: Event) => setOn((e.target as HTMLInputElement).checked)} /> Check spelling in the editor</label>.
          ${canUseDictionary()
            ? "These words, and the site's tags and categories, aren't marked as misspelled."
            : "Chrome 159 and later stop marking these words, and the site's tags and categories, as misspelled."}
        </p>`,
    });
    return () => shell.removeEventListener("change", onChange);
  },
});
