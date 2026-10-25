export type DiffPart = { type: "same" | "del" | "add"; text: string };

/** Word-level diff (LCS over words and whitespace), small enough for edit proposals. */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = a.match(/\s+|[^\s]+/g) ?? [];
  const y = b.match(/\s+|[^\s]+/g) ?? [];
  if (x.length * y.length > 250_000) return [{ type: "del", text: a }, { type: "add", text: b }];
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (type: DiffPart["type"], text: string) => {
    const last = out[out.length - 1];
    if (last?.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) (push("same", x[i]), i++, j++);
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("del", x[i++]);
    else push("add", y[j++]);
  }
  while (i < x.length) push("del", x[i++]);
  while (j < y.length) push("add", y[j++]);
  return out;
}

/** Applies a find/replace edit if `find` occurs exactly once. */
export function applyEdit(text: string, find: string, replace: string): string | undefined {
  const at = text.indexOf(find);
  if (at === -1 || text.indexOf(find, at + 1) !== -1) return undefined;
  return text.slice(0, at) + replace + text.slice(at + find.length);
}
