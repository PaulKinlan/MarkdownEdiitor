import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { defineConfig, transformWithOxc, type Plugin } from "vite";

export default defineConfig({
  build: { outDir: "dist", target: "es2022" },
  plugins: [serviceWorker()],
  // `npm run dev:worker` serves the agent API on 8787.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});

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
