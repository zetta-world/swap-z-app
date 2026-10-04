import { describe, it, expect } from "vitest";
import { quadrosDaPrevia } from "./previa";
import { ESTADOS_UI } from "./visao";

describe("prévia local: quadros gerados pelo serviço, todos os estados de UI", () => {
  it("cobre os 21 estados de UI, sem sucesso sem referência e com preço PROVISÓRIO", async () => {
    const qs = await quadrosDaPrevia();
    expect([...new Set(qs.map((q) => q.estadoUI))].sort()).toEqual([...ESTADOS_UI].sort());
    for (const q of qs) {
      if (q.estadoUI === "TRANSACTION_CONFIRMED") expect(q.txRef).toMatch(/^fakesig-/);
      expect(q.preco.status).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
      expect(q.simulacao).toBe(true);
    }
    const sold = qs.find((q) => q.id === "sold-out")!;
    expect(sold.estadoUI).toBe("SOLD_OUT");
    expect(sold.progressoTotal).toMatchObject({ tipo: "ok", disponiveis: 0, percentualMintado: 100 });
    expect(qs.find((q) => q.id === "coming-soon")!.supplyPago).toEqual({ PRO: 2000, TRADER: 750, PILOT: 100 });
    expect(JSON.parse(JSON.stringify(qs))).toEqual(qs); // JSON puro: nada de função/BigInt para o cliente
  });
  it("determinístico", async () => {
    expect(JSON.stringify(await quadrosDaPrevia())).toBe(JSON.stringify(await quadrosDaPrevia()));
  });
});
