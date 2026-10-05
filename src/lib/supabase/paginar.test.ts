import { describe, it, expect } from "vitest";
import { lerTodasAsPaginas } from "@/lib/supabase/paginar";

/** Um "servidor" que corta em `maxRows` e devolve a fatia [de, ate] de `n` linhas. */
function servidor(n: number, maxRows: number, falhaNaPagina?: number) {
  const chamadas: Array<[number, number]> = [];
  const montar = async (de: number, ate: number) => {
    chamadas.push([de, ate]);
    if (falhaNaPagina != null && chamadas.length === falhaNaPagina) return { data: null, error: { message: "timeout" } };
    const fim = Math.min(n - 1, ate, de + maxRows - 1);
    return { data: de > fim ? [] : Array.from({ length: fim - de + 1 }, (_, i) => ({ id: de + i })), error: null };
  };
  return { montar, chamadas };
}

describe("lerTodasAsPaginas", () => {
  it("2.500 linhas atrás de max_rows 1000 voltam todas, em ordem, sem repetir", async () => {
    const { montar } = servidor(2500, 1000);
    const r = await lerTodasAsPaginas(montar);
    expect(r.linhas.map((x) => x.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i));
    expect(r.truncado).toBe(false);
  });

  it("⚠️ max_rows MENOR que a página (300): o offset anda pelo que voltou — nada é pulado", async () => {
    const { montar } = servidor(1234, 300);
    const r = await lerTodasAsPaginas(montar);
    expect(r.linhas).toHaveLength(1234);
    expect(new Set(r.linhas.map((x) => x.id)).size).toBe(1234);
  });

  it("erro em qualquer página devolve o erro e NENHUMA linha (meia soma é pior que nenhuma)", async () => {
    const { montar } = servidor(5000, 1000, 3);
    const r = await lerTodasAsPaginas(montar);
    expect(r.erro).toBe("timeout");
    expect(r.linhas).toEqual([]);
  });

  it("o teto corta e DECLARA o corte", async () => {
    const { montar } = servidor(5000, 1000);
    const r = await lerTodasAsPaginas(montar, { teto: 2000 });
    expect(r.linhas).toHaveLength(2000);
    expect(r.truncado).toBe(true);
  });
});
