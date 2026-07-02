import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests target the pure money-math (parsePrice / extractSuggestion /
// resolveOne / estimateCost) — no DOM, no network, no Supabase. Node env only.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
