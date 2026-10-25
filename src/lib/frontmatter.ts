import { Document, isMap, isScalar, parseDocument, type Pair, type Scalar } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export type FrontMatterFormat = "yaml" | "toml" | "json" | "none";
export type FrontMatterData = Record<string, unknown>;

// Groups: opening delimiter, front matter, the newline before the closing delimiter, closing delimiter.
// The middle two are absent for an empty block (`---\n---`).
const YAML_RE = /^(---[ \t]*\r?\n)(?:([\s\S]*?)(\r?\n))?(---[ \t]*(?:\r?\n|$))/;
const TOML_RE = /^(\+\+\+[ \t]*\r?\n)(?:([\s\S]*?)(\r?\n))?(\+\+\+[ \t]*(?:\r?\n|$))/;
// JSON front matter is an object; `{{< shortcode >}}` at the top of a body-only file is not.
const JSON_START = /^\{\s*["}]/;

/**
 * A content file split into front matter and body.
 *
 * YAML front matter is edited in place: changing one field rewrites only that
 * key's lines in the original text, so comments, ordering, quoting and line
 * folding of everything else stay as written and git diffs stay small.
 */
export class Post {
  format: FrontMatterFormat;
  body: string;
  private source: string;
  private open: string;
  private newline: string;
  private close: string;
  private data: FrontMatterData;

  private constructor(format: FrontMatterFormat, source: string, open: string, newline: string, close: string, body: string) {
    this.format = format;
    this.source = source;
    this.open = open;
    this.newline = newline;
    this.close = close;
    this.body = body;
    this.data = parseSource(format, source);
  }

  static parse(text: string): Post {
    let m = text.match(YAML_RE);
    if (m) return new Post("yaml", m[2] ?? "", m[1], m[3] ?? "", m[4], text.slice(m[0].length));
    m = text.match(TOML_RE);
    if (m) return new Post("toml", m[2] ?? "", m[1], m[3] ?? "", m[4], text.slice(m[0].length));
    if (JSON_START.test(text)) {
      const end = findJsonEnd(text);
      if (end > 0) {
        const separator = text.slice(end).match(/^\r?\n/)?.[0] ?? "";
        try {
          return new Post("json", text.slice(0, end), "", "", separator, text.slice(end + separator.length));
        } catch {
          // Not JSON after all: treat the file as body only.
        }
      }
    }
    return new Post("none", "", "", "", "", text);
  }

  static create(format: Exclude<FrontMatterFormat, "none">, data: FrontMatterData, body = ""): Post {
    const delim = format === "yaml" ? "---" : format === "toml" ? "+++" : "";
    const post = new Post(format, format === "json" ? "{}" : "", delim ? `${delim}\n` : "", "", delim ? `${delim}\n` : "\n", body);
    for (const [k, v] of Object.entries(data)) post.set(k, v);
    return post;
  }

  get frontMatter(): FrontMatterData {
    return this.data;
  }

  get(key: string): unknown {
    return this.data[key];
  }

  /** Sets a field. `undefined` removes it. */
  set(key: string, value: unknown): void {
    if (key in this.data ? sameValue(this.data[key], value) : value === undefined) return;
    const format = this.format === "none" ? "yaml" : this.format;
    let source: string;
    if (format === "yaml") {
      source = setYamlField(this.source, key, value);
    } else {
      const next = { ...this.data };
      if (value === undefined) delete next[key];
      else next[key] = value;
      source = format === "toml" ? stringifyToml(next).replace(/\n$/, "") : JSON.stringify(next, null, 2);
    }
    // Parse before committing, so a change that produces invalid front matter leaves the post as it was.
    this.commit(format, source, parseSource(format, source));
  }

  /** The front matter text without delimiters, for the raw editor. */
  get rawFrontMatter(): string {
    return this.source;
  }

  /** Replaces all front matter from raw text in the current format. Throws on invalid input. */
  setRawFrontMatter(raw: string): void {
    const format = this.format === "none" ? "yaml" : this.format;
    const source = raw.replace(/\n$/, "");
    this.commit(format, source, parseSource(format, source));
  }

  private commit(format: Exclude<FrontMatterFormat, "none">, source: string, data: FrontMatterData) {
    if (this.format === "none") {
      this.open = "---\n";
      this.close = "---\n";
    }
    if (format !== "json") this.newline = source ? this.newline || "\n" : "";
    this.format = format;
    this.source = source;
    this.data = data;
  }

  toString(): string {
    return this.format === "none" ? this.body : this.open + this.source + this.newline + this.close + this.body;
  }
}

function parseSource(format: FrontMatterFormat, source: string): FrontMatterData {
  switch (format) {
    case "yaml": {
      const doc = parseDocument(source);
      if (doc.errors.length) throw new Error(`Front matter YAML: ${doc.errors[0].message}`);
      const data = doc.toJS();
      if (Array.isArray(data)) throw new Error("Front matter must be a map of keys, not a list");
      return data && typeof data === "object" ? (data as FrontMatterData) : {};
    }
    case "toml":
      return parseToml(source) as FrontMatterData;
    case "json": {
      const data = JSON.parse(source);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON front matter must be an object");
      return data;
    }
    default:
      return {};
  }
}

/** Rewrites (or adds, or removes) one top-level key in YAML source, leaving all other text untouched. */
export function setYamlField(source: string, key: string, value: unknown): string {
  const doc = parseDocument(source, { keepSourceTokens: true });
  const map = doc.contents;
  const pair = isMap(map) ? (map.items as Pair[]).find((p) => isScalar(p.key) && p.key.value === key) : undefined;

  if (!pair) {
    if (value === undefined) return source;
    const text = renderPair(key, value, undefined, usesIndentedSeq(source));
    return source.trim() === "" ? text : `${source.replace(/\s*$/, "")}\n${text}`;
  }

  const keyNode = pair.key as Scalar;
  const valueNode = pair.value as { range?: [number, number, number] } | null;
  const start = keyNode.range![0];
  let end = valueNode?.range ? valueNode.range[1] : keyNode.range![1];
  // Block scalars (`title: >`) count their trailing newline as part of the value.
  while (end > start && (source[end - 1] === "\n" || source[end - 1] === "\r")) end--;

  if (value === undefined) {
    // Drop the whole line(s), including the newline before the next key.
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const after = source.slice(end).match(/^[ \t]*\r?\n?/)?.[0].length ?? 0;
    return (source.slice(0, lineStart) + source.slice(end + after)).replace(/\n$/, "");
  }

  const quoteType = isScalar(pair.value) && typeof value === "string" ? (pair.value as Scalar).type : undefined;
  return source.slice(0, start) + renderPair(key, value, quoteType, usesIndentedSeq(source)) + source.slice(end).replace(/^[ \t]+(?=\r?\n|$)/, "");
}

function renderPair(key: string, value: unknown, quoteType?: Scalar.Type, indentSeq = true): string {
  const doc = new Document({});
  const node = doc.createNode(value);
  // Keep the author's quoting style for strings, unless the new text needs something else.
  if (quoteType && isScalar(node) && (quoteType === "QUOTE_DOUBLE" || quoteType === "QUOTE_SINGLE")) node.type = quoteType;
  doc.set(key, node);
  return doc.toString({ indentSeq }).replace(/\n$/, "");
}

/** paul.kinlan.me writes lists as `tags:\n- a`, aifoc.us as `authors:\n  - a`; match whichever the file uses. */
function usesIndentedSeq(source: string): boolean {
  return !/^[^\s#][^\n]*:[ \t]*\r?\n- /m.test(source);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return String(a) === String(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function findJsonEnd(text: string): number {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Normalises a front matter date (string, Date, or TOML date) to a Date, or undefined. */
export function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return isNaN(value.getTime()) ? undefined : value;
  if (value == null || value === "") return undefined;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? undefined : d;
}
