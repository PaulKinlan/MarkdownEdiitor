// Keeps docs/ in line with the code. Reads the extension API, hooks, module
// context, backends, profiles, routes, message types and built-in tools from
// the source, and fails when one of them isn't named in the page that
// documents it. Also checks that every relative link in the docs (and its
// #anchor) goes somewhere. Runs in `npm run gate` and CI.
//
// When it fails, describe the new thing in the page it names; don't add it to
// an allowlist here unless it really isn't for people extending the editor.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const problems = [];

// ---- Reading the source ---------------------------------------------------------

/** String members of a union type: `export type Name = | "a" | "b";`. */
function unionMembers(file, name) {
  const text = read(file);
  const start = text.indexOf(`type ${name} =`);
  if (start === -1) throw new Error(`${file}: no type ${name}`);
  const body = text.slice(start, text.indexOf(";", start));
  return [...body.matchAll(/^\s*\|\s*"([^"]+)"/gm)].map((m) => m[1]);
}

/** Top-level member names of an interface (indented two more than its declaration, as the formatter writes them). */
function membersIn(text, name) {
  const lines = text.split("\n");
  const members = [];
  lines.forEach((line, i) => {
    const decl = line.match(new RegExp(`^(\\s*)(?:export )?interface ${name}\\b[^{]*\\{\\s*$`));
    if (!decl) return;
    const indent = decl[1];
    const member = new RegExp(`^${indent}  (?:readonly )?(?:"([^"]+)"|([\\w$]+))\\??\\s*[:(<]`);
    for (const next of lines.slice(i + 1)) {
      if (new RegExp(`^${indent}}`).test(next)) break;
      const m = next.match(member);
      if (m) members.push(m[1] ?? m[2]);
    }
  });
  return members;
}

function interfaceMembers(file, name) {
  const members = membersIn(read(file), name);
  if (!members.length) throw new Error(`${file}: no interface ${name}`);
  return members;
}

/** TypeScript files under the folders, without tests or generated files. */
function sourceFiles(...dirs) {
  const walk = (dir) =>
    readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.(test|gen|d)\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
    );
  return dirs.flatMap(walk);
}

/**
 * An interface that features extend by declaration merging: its own members,
 * plus those every `declare module` block in src/ and worker/ adds.
 */
function mergedMembers(file, name) {
  const own = interfaceMembers(file, name);
  const added = sourceFiles("src", "worker")
    .filter((f) => f !== file)
    .flatMap((f) => {
      const text = read(f);
      return text.includes("declare module") ? membersIn(text, name) : [];
    });
  return [...new Set([...own, ...added])];
}

/** The `editor` object an extension gets, as paths: "on", "document.read", "ui.status", ... */
function editorApi() {
  const lines = read("src/extensions/runtime.ts").split("\n");
  const start = lines.findIndex((l) => /^\s*const editor = \{\s*$/.test(l));
  const paths = [];
  let parent;
  for (const line of lines.slice(start + 1)) {
    if (/^  \};?\s*$/.test(line)) break;
    const top = line.match(/^    (?:async |get )?(\w+)(\(|: \{\s*$|: )/);
    if (top) {
      parent = top[2].startsWith(": {") ? top[1] : undefined;
      if (!parent) paths.push(top[1]);
      continue;
    }
    const nested = parent && line.match(/^      (?:async |get )?(\w+)(\(|: )/);
    if (nested) paths.push(`${parent}.${nested[1]}`);
  }
  return paths;
}

/** Methods on `editor` that register a hook (their body registers `{ kind: "hook" }`). */
function hookMethods() {
  const out = [];
  let last;
  for (const line of read("src/extensions/runtime.ts").split("\n")) {
    const m = line.match(/^\s+(\w+)\(/);
    if (m && m[1] !== "register") last = m[1];
    if (line.includes('register({ kind: "hook"') && last) out.push(last);
  }
  return out;
}

/** Files in a folder, without their extension. */
function filesIn(dir, ext, skip = []) {
  return readdirSync(join(root, dir))
    .filter((n) => n.endsWith(ext) && !n.endsWith(`.test${ext}`) && !skip.includes(n))
    .map((n) => n.slice(0, -ext.length));
}

function foldersIn(dir) {
  return readdirSync(join(root, dir)).filter((n) => statSync(join(root, dir, n)).isDirectory());
}

/** Names of tools the Worker defines with a literal name: `defineTool({ name: "x" ...`. */
function builtinTools() {
  const files = [...filesIn("worker/agent", ".ts").map((n) => `worker/agent/${n}.ts`), "worker/routes/mcp.ts"];
  const names = new Set();
  for (const file of files) {
    for (const m of read(file).matchAll(/defineTool\(\{\s*name:\s*"([\w-]+)"/g)) names.add(m[1]);
  }
  return [...names];
}

// ---- Reading the docs ------------------------------------------------------------

/** Everything in code spans and code blocks of a markdown file, which is where docs name code. */
function codeIn(path) {
  const text = read(path);
  const blocks = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1]);
  const spans = [...text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "").matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...blocks, ...spans].join("\n");
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every name must appear in a code span or block of `doc`, as a whole token. */
function documented(doc, what, names) {
  // Finding nothing means the source moved or changed shape, and this script needs updating.
  if (!names.length) return problems.push(`scripts/check-docs.mjs: found no ${what} names in the source; update the script.`);
  const code = codeIn(doc);
  const missing = names.filter((n) => !new RegExp(`(?<![\\w$-])${escape(n)}(?![\\w$-])`).test(code));
  for (const name of missing) problems.push(`${doc}: ${what} \`${name}\` isn't documented.`);
}

// ---- The checks -------------------------------------------------------------------

// Extensions: the API an extension's code sees.
documented("docs/extensions.md", "permission", unionMembers("src/extensions/types.ts", "Permission"));
documented("docs/extensions.md", "event", unionMembers("src/extensions/types.ts", "EditorEvent"));
documented("docs/extensions.md", "manifest field", interfaceMembers("src/extensions/types.ts", "ExtensionManifest"));
documented("docs/extensions.md", "editor API", editorApi());
documented(
  "docs/extensions.md",
  "host method",
  interfaceMembers("src/extensions/messages.ts", "Methods")
    .filter((m) => m !== "register" && m !== "unregister")
    .map((m) => m.split(".").slice(-2).join(".")),
);

// Hooks: every way the editor calls back into code.
documented("docs/hooks.md", "hook", hookMethods());
documented("docs/hooks.md", "invocation", interfaceMembers("src/extensions/messages.ts", "Invocations"));
documented(
  "docs/hooks.md",
  "registration kind",
  [...read("src/extensions/messages.ts").matchAll(/\| \{ kind: "(\w+)"; spec/g)].map((m) => m[1]),
);
documented(
  "docs/hooks.md",
  "extension call",
  [...read("src/shared/extensions.ts").matchAll(/\| \{ kind: "(\w+)"; extension/g)].map((m) => m[1]),
);
documented("docs/hooks.md", "core message type", [...interfaceMembers("src/shared/protocol.ts", "ClientMessages"), ...interfaceMembers("src/shared/protocol.ts", "ServerMessages")]);

// Modules: what a first-party module sees and adds.
documented("docs/modules.md", "Shell member", interfaceMembers("src/core/modules.ts", "Shell"));
documented("docs/modules.md", "ModuleContext member", interfaceMembers("src/core/modules.ts", "ModuleContext"));
documented("docs/modules.md", "service", mergedMembers("src/core/modules.ts", "Services"));
documented("docs/modules.md", "module", foldersIn("src/modules"));

// The agent server and backends.
documented("docs/agents.md", "AgentBackend member", interfaceMembers("src/modules/assistant/backend.ts", "AgentBackend"));
documented("docs/agents.md", "backend", filesIn("src/modules/assistant/backends", ".ts").map((n) => `backends/${n}.ts`));
documented("docs/agents.md", "Profile member", interfaceMembers("worker/agent/conversation.ts", "Profile"));
documented("docs/agents.md", "profile", filesIn("worker/agent/profiles", ".ts").map((n) => `profiles/${n}.ts`));
documented("docs/agents.md", "built-in tool", builtinTools());
documented("docs/agents.md", "editor → session message", mergedMembers("src/shared/protocol.ts", "ClientMessages"));
documented("docs/agents.md", "session → editor message", mergedMembers("src/shared/protocol.ts", "ServerMessages"));
documented("docs/agents.md", "AgentLink member", interfaceMembers("src/lib/agent-client.ts", "AgentLink"));

// The Worker.
documented("docs/worker.md", "route file", filesIn("worker/routes", ".ts").map((n) => `${n}.ts`));
documented("docs/worker.md", "Route field", interfaceMembers("worker/route.ts", "Route"));
documented("docs/worker.md", "Durable Object", [...read("wrangler.jsonc").matchAll(/"class_name":\s*"(\w+)"/g)].map((m) => m[1]));

// Built-in extensions, by the name people see.
{
  const page = read("docs/features/extensions.md").toLowerCase();
  for (const id of filesIn("src/extensions/builtin", ".js", ["text.js"])) {
    const name = read(`src/extensions/builtin/${id}.js`).match(/name:\s*"([^"]+)"/)?.[1] ?? id;
    if (!page.includes(name.toLowerCase())) problems.push(`docs/features/extensions.md: built-in extension "${name}" (src/extensions/builtin/${id}.js) isn't listed.`);
  }
}

// ---- Links -----------------------------------------------------------------------

/** GitHub's heading anchors. */
function anchors(path) {
  const text = read(path).replace(/^```[\s\S]*?^```/gm, "");
  return new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
      m[1]
        .trim()
        .toLowerCase()
        .replace(/[`*_]/g, "")
        .replace(/[^\p{L}\p{N}\s-]/gu, "")
        .replace(/\s/g, "-"),
    ),
  );
}

function markdownFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  );
}

for (const file of ["README.md", "AGENTS.md", ...markdownFiles("docs")]) {
  const text = read(file).replace(/^```[\s\S]*?^```/gm, "");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const [path, anchor] = target.split("#");
    const full = path ? resolve(root, dirname(file), path) : join(root, file);
    const rel = relative(root, full);
    if (!existsSync(full)) {
      problems.push(`${file}: the link to ${target} goes nowhere.`);
      continue;
    }
    if (anchor && rel.endsWith(".md") && !anchors(rel).has(anchor)) problems.push(`${file}: ${rel} has no heading for #${anchor}.`);
  }
}

if (problems.length) {
  console.error(`The docs are out of date with the code (${problems.length}):\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nUpdate the page in the same change. See docs/README.md#keeping-the-docs-current.");
  process.exit(1);
}
console.log("Docs: every hook, API, module, backend, profile, route and tool is documented, and every link works.");
