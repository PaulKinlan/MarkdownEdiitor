import { defineConfig } from "vite";

export default defineConfig({
  build: { outDir: "dist", target: "es2022" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
