/**
 * RM-12 (audit remediation) — paginação por CHAVE vs por OFFSET com a tabela mudando no meio.
 *
 * A auditoria: "a paginação genérica resolveu 1.000 linhas, mas não é snapshot-safe". Aqui a
 * tabela recebe linhas DURANTE a leitura, em posições anteriores ao cursor (UUID é aleatório: a
 * maioria das inserções cai "antes" de onde a leitura está). O offset lê uma linha duas vezes; a
 * chave lê cada linha pré-existente exatamente uma vez.
 */
import { describe, it, expect } from "vitest";
import { lerTodasAsPaginas, lerTodasPorChave } from "@/lib/supabase/paginar";

const id = (n: number) => `k${String(n).padStart(6, "0")}`;

/** Tabela ordenada por `id`, com max_rows; `aoLer` roda depois de cada página (para mutar a tabela). */
function tabela(n: number, maxRows = 1000) {
  const linhas = Array.from({ length: n }, (_, i) => ({ id: id(i * 10), valor: 1 }));
  const ordenadas = () => [...linhas].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let paginas = 0;
  const hooks = { aoLer: (_p: number) => {} };
  const porOffset = async (de: number, ate: number) => {
    const r = ordenadas().slice(de, Math.min(ate + 1, de + maxRows));
    hooks.aoLer(++paginas);
    return { data: r, error: null };
  };
  const porChave = async (depois: string | null, limite: number) => {
    const r = ordenadas().filter((x) => depois == null || x.id > depois).slice(0, Math.min(limite, maxRows));
    hooks.aoLer(++paginas);
    return { data: r, error: null };
  };
  return { linhas, porOffset, porChave, hooks };
}

describe("RM-12 · leitura por chave", () => {
  it("2.500 linhas atrás de max_rows 1000: todas, em ordem, sem repetir", async () => {
    const t = tabela(2500);
    const r = await lerTodasPorChave(t.porChave, "id");
    expect(r.erro).toBeNull();
    expect(r.linhas).toHaveLength(2500);
    expect(new Set(r.linhas.map((x) => x.id)).size).toBe(2500);
  });

  it("⚠️⚠️ inserção CONCORRENTE antes do cursor: offset REPETE linha; chave lê cada pré-existente uma vez", async () => {
    // Offset: depois da 1ª página, entra uma linha no começo da ordem → a 2ª página começa uma linha "atrás".
    const a = tabela(2500);
    a.hooks.aoLer = (p) => { if (p === 1) a.linhas.push({ id: id(5), valor: 1 }); };
    const off = await lerTodasAsPaginas(a.porOffset);
    const ids = off.linhas.map((x) => x.id);
    expect(ids.length - new Set(ids).size).toBe(1);                 // ← o defeito: uma linha somada duas vezes

    const b = tabela(2500);
    b.hooks.aoLer = (p) => { if (p === 1) b.linhas.push({ id: id(5), valor: 1 }); };
    const ch = await lerTodasPorChave(b.porChave, "id");
    const idsCh = ch.linhas.map((x) => x.id);
    expect(idsCh.length).toBe(new Set(idsCh).size);                 // nenhuma repetida
    for (let i = 0; i < 2500; i++) expect(idsCh).toContain(id(i * 10));   // nenhuma pré-existente pulada
  });

  it("⚠️ remoção CONCORRENTE antes do cursor: offset PULA linha; chave não pula nenhuma restante", async () => {
    const a = tabela(2500);
    a.hooks.aoLer = (p) => { if (p === 1) a.linhas.splice(0, 1); };
    const off = await lerTodasAsPaginas(a.porOffset);
    expect(off.linhas.map((x) => x.id)).not.toContain(id(1000 * 10));   // ← a linha 1000 sumiu da leitura
    const b = tabela(2500);
    b.hooks.aoLer = (p) => { if (p === 1) b.linhas.splice(0, 1); };
    const ch = await lerTodasPorChave(b.porChave, "id");
    for (let i = 1; i < 2500; i++) expect(ch.linhas.map((x) => x.id)).toContain(id(i * 10));
  });

  it("erro, exceção, chave ausente e chave que não anda → erro declarado, linhas vazias (nunca soma parcial)", async () => {
    expect((await lerTodasPorChave(async () => ({ data: null, error: { message: "timeout" } }), "id")).erro).toBe("timeout");
    expect((await lerTodasPorChave(async () => { throw new Error("fetch failed"); }, "id")).erro).toMatch(/fetch failed/);
    const semChave = await lerTodasPorChave(async () => ({ data: [{ id: null as unknown as string }], error: null }), "id");
    expect(semChave.erro).toMatch(/ausente/);
    const parado = await lerTodasPorChave(async () => ({ data: [{ id: "k1" }], error: null }), "id");
    expect(parado.erro).toMatch(/não avançou/);
    expect(parado.linhas).toEqual([]);
  });

  it("teto: para e DECLARA truncado", async () => {
    const r = await lerTodasPorChave(tabela(2500).porChave, "id", { teto: 1500 });
    expect(r.truncado).toBe(true);
    expect(r.linhas).toHaveLength(1500);
  });
});
