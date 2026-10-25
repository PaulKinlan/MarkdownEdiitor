import { defineConfig } from "vite";

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
  plugins: [originTrials()],
  // `npm run dev:worker` serves the agent API on 8787.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
