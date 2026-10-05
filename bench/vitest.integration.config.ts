import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integração contra PostgREST + Postgres DESCARTÁVEIS da campanha (nunca lab,
 * nunca hospedado). Fora da suíte normal: exige os containers de pé.
 * Ver `bench/integracao/postgrest.integration.ts`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["bench/integracao/**/*.integration.ts"],
    testTimeout: 120_000,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "..", "src") },
  },
});
