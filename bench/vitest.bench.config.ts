import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Benchmarks do COST ENGINEERING ROUND — fora da suíte normal de propósito.
 *
 * Wall-clock depende da máquina; por isso NADA aqui é gate de CI. Os gates de
 * regressão de desempenho vivem na suíte normal e usam CONTAGEM de operações
 * (ver `src/lib/bancada/motor.complexidade.test.ts`), não milissegundos.
 *
 * Rodar (container capado): npx vitest run --config bench/vitest.bench.config.ts
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["bench/**/*.bench.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    // Um processo só, sem paralelismo: medição limpa e memória previsível no Acer.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "..", "src") },
  },
});
