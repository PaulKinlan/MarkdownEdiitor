import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  drawSelection,
  highlightActiveLine,
  keymap,
  placeholder,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const markdownHighlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.4em", fontWeight: "700" },
  { tag: t.heading2, fontSize: "1.25em", fontWeight: "700" },
  { tag: t.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--fg-2)" },
  { tag: t.monospace, fontFamily: "var(--mono)" },
  { tag: [t.processingInstruction, t.meta], color: "var(--fg-2)" },
  { tag: t.quote, color: "var(--fg-2)", fontStyle: "italic" },
]);

/** Marks Hugo shortcodes (`{{< name ... >}}` and `{{% name %}}`) so they stand out from prose. */
const shortcodeMatcher = new MatchDecorator({
  regexp: /\{\{[<%][\s\S]*?[%>]\}\}/g,
  decoration: Decoration.mark({ class: "cm-shortcode" }),
});
const shortcodes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = shortcodeMatcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = shortcodeMatcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

const editorTheme = EditorView.baseTheme({
  "&": { height: "100%", fontSize: "15px" },
  ".cm-scroller": { fontFamily: "var(--font)", lineHeight: "1.65", padding: "8px 0" },
  ".cm-content": { maxWidth: "46em", margin: "0 auto", padding: "0 24px", caretColor: "var(--fg)" },
  ".cm-gutters": { display: "none" },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 6%, transparent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent) !important",
  },
  ".cm-shortcode": {
    fontFamily: "var(--mono)",
    fontSize: "0.9em",
    color: "var(--warn)",
    backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)",
    borderRadius: "3px",
  },
});

export interface EditorChangeDetail {
  value: string;
}

/**
 * CodeMirror 6 wrapped as an element. `value` sets the document (resetting
 * history); edits are reported with a `change` event. Image files dropped or
 * pasted are reported with an `image-files` event so the app can save them.
 */
@customElement("md-editor")
export class MdEditor extends LitElement {
  static styles = css`
    :host { display: block; height: 100%; min-height: 0; overflow: hidden; background: var(--bg); }
    .host { height: 100%; }
  `;

  @property() value = "";
  @property() placeholderText = "Start writing…";

  private view?: EditorView;
  private applying = false;

  firstUpdated() {
    this.view = new EditorView({
      parent: this.renderRoot.querySelector(".host")!,
      root: this.shadowRoot!,
      state: this.createState(this.value),
    });
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("value") && this.view && this.view.state.doc.toString() !== this.value) {
      this.applying = true;
      this.view.setState(this.createState(this.value));
      this.applying = false;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.view?.destroy();
    this.view = undefined;
  }

  /** Inserts text at the cursor (replacing the selection) and focuses the editor. */
  insert(text: string) {
    if (!this.view) return;
    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    this.view.focus();
  }

  focus() {
    this.view?.focus();
  }

  private createState(doc: string): EditorState {
    const extensions: Extension[] = [
      history(),
      drawSelection(),
      highlightActiveLine(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      syntaxHighlighting(markdownHighlight),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      placeholder(this.placeholderText),
      shortcodes,
      editorTheme,
      keymap.of([
        { key: "Mod-b", run: (v) => wrap(v, "**") },
        { key: "Mod-i", run: (v) => wrap(v, "_") },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !this.applying) {
          this.value = u.state.doc.toString();
          this.emit("change", { value: this.value });
        }
      }),
      EditorView.domEventHandlers({
        drop: (e, view) => this.handleFiles(e.dataTransfer?.files, e, view.posAtCoords({ x: e.clientX, y: e.clientY })),
        paste: (e) => this.handleFiles(e.clipboardData?.files, e, null),
      }),
    ];
    return EditorState.create({ doc, extensions });
  }

  private handleFiles(files: FileList | undefined, e: Event, pos: number | null): boolean {
    const images = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!images.length) return false;
    e.preventDefault();
    if (pos !== null && this.view) this.view.dispatch({ selection: { anchor: pos } });
    this.emit("image-files", { files: images });
    return true;
  }

  private emit(type: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  render() {
    return html`<div class="host"></div>`;
  }
}

function wrap(view: EditorView, mark: string): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${mark}${text}${mark}` },
    selection: { anchor: from + mark.length, head: to + mark.length },
  });
  return true;
}

declare global {
  interface HTMLElementTagNameMap {
    "md-editor": MdEditor;
  }
}
