import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
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
  { tag: t.heading1, fontSize: "1.6em", fontWeight: "700", letterSpacing: "-0.015em" },
  { tag: t.heading2, fontSize: "1.3em", fontWeight: "700", letterSpacing: "-0.01em" },
  { tag: t.heading3, fontSize: "1.12em", fontWeight: "650" },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "650" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--accent)", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--accent) 40%, transparent)", textUnderlineOffset: "3px" },
  { tag: t.url, color: "var(--fg-2)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.9em" },
  // Markdown syntax (#, *, >, backticks) recedes so the words stand out.
  { tag: [t.processingInstruction, t.meta], color: "var(--fg-2)" },
  { tag: t.quote, color: "var(--fg-2)", fontStyle: "italic" },
  { tag: t.contentSeparator, color: "var(--fg-2)" },
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

/** A range of the body underlined by an extension, with a note on hover. Offsets are into the body. */
export interface BodyAnnotation {
  from: number;
  to: number;
  severity?: "info" | "warning" | "error";
  message: string;
}

const setAnnotations = StateEffect.define<BodyAnnotation[]>();

/** Extension annotations. They move with edits until the next set replaces them. */
const annotationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setAnnotations)) continue;
      const length = tr.state.doc.length;
      const ranges = effect.value
        .filter((a) => a.from < a.to && a.to <= length)
        .sort((a, b) => a.from - b.from)
        .map((a) => Decoration.mark({ class: `cm-ext-${a.severity ?? "info"}`, attributes: { title: a.message } }).range(a.from, a.to));
      deco = Decoration.set(ranges, true);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const editorTheme = EditorView.baseTheme({
  "&": { height: "100%", fontSize: "17px", color: "var(--fg)" },
  ".cm-scroller": { fontFamily: "var(--font-editor)", lineHeight: "1.7", padding: "32px 0 40vh" },
  ".cm-content": { maxWidth: "42em", margin: "0 auto", padding: "0 32px", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-gutters": { display: "none" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-placeholder": { color: "var(--fg-2)", fontStyle: "italic" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent) !important",
  },
  ".cm-shortcode": {
    fontFamily: "var(--mono)",
    fontSize: "0.82em",
    color: "var(--warn)",
    backgroundColor: "color-mix(in srgb, var(--warn) 10%, transparent)",
    borderRadius: "4px",
    padding: "1px 3px",
  },
  ".cm-ext-info, .cm-ext-warning, .cm-ext-error": { textDecorationLine: "underline", textDecorationStyle: "wavy", textDecorationThickness: "1px", textUnderlineOffset: "3px" },
  ".cm-ext-info": { textDecorationColor: "color-mix(in srgb, var(--accent) 70%, transparent)" },
  ".cm-ext-warning": { textDecorationColor: "var(--warn)" },
  ".cm-ext-error": { textDecorationColor: "var(--danger)" },
  "@media (max-width: 900px)": {
    ".cm-scroller": { paddingTop: "16px" },
    ".cm-content": { padding: "0 16px" },
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
  /** Turns on the browser's spell checker for the document. */
  @property({ type: Boolean }) checkSpelling = true;
  /** Ranges extensions underline, as body offsets. */
  @property({ attribute: false }) annotations: BodyAnnotation[] = [];

  private view?: EditorView;
  private applying = false;
  private spelling = new Compartment();

  firstUpdated() {
    this.view = new EditorView({
      parent: this.renderRoot.querySelector(".host")!,
      root: this.shadowRoot!,
      state: this.createState(this.value),
    });
    if (this.annotations.length) this.view.dispatch({ effects: setAnnotations.of(this.annotations) });
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("value") && this.view && this.view.state.doc.toString() !== this.value) {
      this.applying = true;
      this.view.setState(this.createState(this.value));
      this.view.dispatch({ effects: setAnnotations.of(this.annotations) });
      this.applying = false;
    }
    if (changed.has("annotations") && this.view) this.view.dispatch({ effects: setAnnotations.of(this.annotations) });
    if (changed.has("checkSpelling") && this.view) {
      this.view.dispatch({ effects: this.spelling.reconfigure(spellingAttributes(this.checkSpelling)) });
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

  /** Replaces `find` with `replace` as an undoable edit, if `find` occurs exactly once. */
  replaceUnique(find: string, replace: string): boolean {
    if (!this.view) return false;
    const doc = this.view.state.doc.toString();
    const at = doc.indexOf(find);
    if (at === -1 || doc.indexOf(find, at + 1) !== -1) return false;
    this.view.dispatch({
      changes: { from: at, to: at + find.length, insert: replace },
      effects: EditorView.scrollIntoView(at, { y: "center" }),
    });
    // Focus so Ctrl/⌘+Z reaches the editor's history straight after accepting.
    this.view.focus();
    return true;
  }

  focus() {
    this.view?.focus();
  }

  /** Selects a range (body offsets), scrolls it into view and focuses the editor. */
  select(from: number, to = from) {
    if (!this.view) return;
    const max = this.view.state.doc.length;
    const anchor = Math.min(from, max);
    this.view.dispatch({ selection: { anchor, head: Math.min(to, max) }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    this.view.focus();
  }

  /** The main selection, as body offsets. */
  get selection(): { from: number; to: number } {
    const range = this.view?.state.selection.main;
    return range ? { from: range.from, to: range.to } : { from: 0, to: 0 };
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
      annotationField,
      editorTheme,
      this.spelling.of(spellingAttributes(this.checkSpelling)),
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
        if (u.selectionSet) this.emit("selection-change");
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

/** CodeMirror turns spell checking off by default. Autocorrect stays off: it would rewrite code and shortcodes. */
function spellingAttributes(on: boolean): Extension {
  return EditorView.contentAttributes.of({ spellcheck: on ? "true" : "false", autocorrect: "off" });
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
