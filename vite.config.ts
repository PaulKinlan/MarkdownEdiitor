import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { defineConfig, transformWithOxc, type Plugin } from "vite";

/** Adds an origin-trial meta tag for each token in ORIGIN_TRIAL_TOKENS (comma-separated), e.g. for WebMCP. */
function originTrials() {
  const tokens = (process.env.ORIGIN_TRIAL_TOKENS ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return {
    name: "origin-trials",
    transformIndexHtml: () => tokens.map((content) => ({ tag: "meta", attrs: { "http-equiv": "origin-trial", content }, injectTo: "head-prepend" as const })),
  };
}

export default defineConfig({
  build: { outDir: "dist", target: "es2022" },
  plugins: [originTrials(), extensionWorkers(), serviceWorker()],
  // `npm run dev:worker` serves the agent API on 8787.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});

/**
 * Copies the extension worker to two fixed paths, so public/_headers can give
 * each its own Content-Security-Policy: extension-worker/sandboxed.js can't
 * reach the network, and extension-worker/network.js (for extensions with the
 * "network" permission) can. See src/extensions/host.ts.
 */
function extensionWorkers(): Plugin {
  return {
    name: "extension-workers",
    apply: "build",
    generateBundle(_options, bundle) {
      const worker = Object.values(bundle).find((f) => /^assets\/worker-[\w-]+\.js$/.test(f.fileName));
      if (!worker) this.error("The extension worker (src/extensions/worker.ts) wasn't in the bundle.");
      const source = worker.type === "chunk" ? worker.code : worker.source;
      for (const name of ["sandboxed", "network"]) this.emitFile({ type: "asset", fileName: `extension-worker/${name}.js`, source });
    },
  };
}

/**
 * Emits dist/sw.js from src/sw/service-worker.ts with the build's file list
 * inlined as its precache, and a version that changes whenever any file does.
 * The page only registers it in production builds (see src/lib/pwa.ts).
 */
function serviceWorker(): Plugin {
  return {
    name: "service-worker",
    apply: "build",
    // After Vite's HTML plugin, so index.html is in the bundle.
    enforce: "post",
    async generateBundle(_options, bundle) {
      // Files from public/ aren't in the bundle yet, and _headers is Cloudflare config, not a page asset.
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
      const publicFiles = ["manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];
      const precache = [...files, ...publicFiles].map((f) => (f === "index.html" ? "/" : `/${f}`)).sort();
      const hash = createHash("sha256");
      for (const f of Object.keys(bundle).sort()) {
        const out = bundle[f];
        hash.update(f).update(out.type === "chunk" ? out.code : out.source);
      }
      for (const f of publicFiles) hash.update(await readFile(`public/${f}`));
      const source = await readFile("src/sw/service-worker.ts", "utf8");
      const { code } = await transformWithOxc(source, "service-worker.ts");
      const header = `const PRECACHE = ${JSON.stringify(precache)};\nconst VERSION = ${JSON.stringify(hash.digest("hex").slice(0, 12))};\n`;
      this.emitFile({ type: "asset", fileName: "sw.js", source: header + code });
    },
  };
}
