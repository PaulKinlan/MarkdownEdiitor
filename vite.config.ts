import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", target: "es2022" },
  // `npm run dev:worker` serves the agent API on 8787.
  server: { proxy: { "/api": { target: "http://localhost:8787", ws: true } } },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
