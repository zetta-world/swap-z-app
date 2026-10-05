/**
 * AUDIT REMEDIATION do cost engineering round — os contratos de escrita do store.
 *
 * ⚠️ O BANCO FALSO AQUI É ROTEIRIZADO, de propósito. A semântica SQL (trava,
 * chave canônica, lease) é provada contra o Postgres real em
 * `supabase/tests/23*` e na integração com PostgREST. O que se prova aqui é o
 * que a APLICAÇÃO faz com cada resposta possível do banco — e o defeito que a
 * auditoria achou foi exatamente esse: `{ error }` resolvido, nunca lançado,
 * lido como sucesso.
 *
 * Cada caso tem o par: a resposta boa vira sucesso, a ruim NUNCA vira.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { donoDaSessao, type Dono } from "@/lib/bancada/dono";
import {
  fecharPosicao, abrirPosicao, gravarUltimoTique, gravarUltimosTiques, marcarTiqueAdiado,
  posicoesAbertasParaOCron, mesasLigadasParaOCron, mesasDasPosicoesParaOCron, arrendarTique, liberarTique,
} from "@/lib/bancada/store";
import { tiqueDoPapelAdiante } from "@/lib/bancada/tique";

type Resposta = { data: unknown; error: { message: string; code?: string } | null } | "lanca";

interface Chamada { tipo: "update" | "select" | "rpc" | "upsert"; tabela?: string; nome?: string; patch?: unknown; args?: unknown; filtros: Array<[string, unknown]> }

/**
 * Um cliente que responde em ORDEM o que o teste roteirizou, por tipo de chamada,
 * e registra tudo o que recebeu (filtros, patch, argumentos).
 */
function roteiro(r: { update?: Resposta[]; select?: Resposta[]; rpc?: Record<string, Resposta[]>; upsert?: Resposta[] }) {
  const chamadas: Chamada[] = [];
  const proxima = (fila: Resposta[] | undefined): Promise<{ data: unknown; error: unknown }> => {
    const x = fila?.shift() ?? { data: null, error: { message: "roteiro esgotado" } };
    return x === "lanca" ? Promise.reject(new Error("fetch failed: timeout")) : Promise.resolve(x);
  };
  const corrente = (c: Chamada, resolver: () => Promise<{ data: unknown; error: unknown }>) => {
    const api: Record<string, unknown> = {};
    for (const m of ["eq", "is", "gt", "in", "order", "limit", "neq", "gte", "lte"]) {
      api[m] = (col: string, val: unknown) => { c.filtros.push([`${m}:${col}`, val]); return api; };
    }
    api.select = () => api;
    api.maybeSingle = () => api;
    api.single = () => api;
    api.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => resolver().then(ok, ko);
    return api;
  };
  const db = {
    from(tabela: string) {
      return {
        update(patch: unknown) { const c: Chamada = { tipo: "update", tabela, patch, filtros: [] }; chamadas.push(c); return corrente(c, () => proxima(r.update)); },
        select() { const c: Chamada = { tipo: "select", tabela, filtros: [] }; chamadas.push(c); return corrente(c, () => proxima(r.select)); },
        upsert(patch: unknown) { const c: Chamada = { tipo: "upsert", tabela, patch, filtros: [] }; chamadas.push(c); return proxima(r.upsert); },
      };
    },
    rpc(nome: string, args: unknown) {
      chamadas.push({ tipo: "rpc", nome, args, filtros: [] });
      return proxima(r.rpc?.[nome]);
    },
  } as unknown as SupabaseClient;
  return { db, chamadas };
}

const A: Dono = donoDaSessao({ sub: "0xAAAA1111", chain: "evm" })!.dono;
const ok = (data: unknown): Resposta => ({ data, error: null });
const erro = (message: string, code?: string): Resposta => ({ data: null, error: { message, code } });
const METRICAS = { duracaoMs: 1234.4, velasDaFonte: 10, velasDoCache: 90 };

// ── RM-02: fechar posição é idempotente ─────────────────────────────────
describe("RM-02 · fecharPosicao só move 'aberta → desfecho'", () => {
  it("fecha uma vez; o segundo (replay/concorrente) não reescreve e não é erro", async () => {
    const { db, chamadas } = roteiro({ update: [ok([{ id: "p1" }]), ok([])], select: [ok({ status: "ganhou" })] });
    expect(await fecharPosicao(A, db, "p1", "ganhou", 103, 2.6)).toEqual({ ok: true, valor: { fechou: true } });
    expect(chamadas[0].filtros).toContainEqual(["eq:status", "aberta"]);
    expect(await fecharPosicao(A, db, "p1", "perdeu", 97, -3)).toEqual({ ok: true, valor: { fechou: false } });
  });
  it("`{ error }` e exceção → ok:false; posição inexistente → ok:false", async () => {
    expect((await fecharPosicao(A, roteiro({ update: [erro("x")] }).db, "p1", "ganhou", 1, 1)).ok).toBe(false);
    expect((await fecharPosicao(A, roteiro({ update: ["lanca"] }).db, "p1", "ganhou", 1, 1)).ok).toBe(false);
    expect((await fecharPosicao(A, roteiro({ update: [ok([])], select: [ok(null)] }).db, "p1", "ganhou", 1, 1)).ok).toBe(false);
  });
});

// ── RM-02/RM-03: abertura pela RPC ──────────────────────────────────────
describe("RM-02 · abrirPosicao vai pela RPC idempotente e mapeia cada desfecho", () => {
  const NOVA = {
    estrategiaId: "e1", simbolo: "BTC", lado: "long" as const, entrada: 100, tamanhoUsd: 1000,
    alvoPct: 3, stopPct: 2, expiraEm: null, velaEm: 1_700_000_000_000, intervalo: "4h", playbook: null, horasLimite: 72,
  };
  it("passa a identidade inteira (vela + intervalo) e nunca faz INSERT cru", async () => {
    const { db, chamadas } = roteiro({ rpc: { bancada_abrir_posicao_papel: [ok({ ok: true, criada: true, id: "p1" })] } });
    expect(await abrirPosicao(A, db, NOVA)).toEqual({ ok: true, id: "p1", criada: true });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].nome).toBe("bancada_abrir_posicao_papel");
    expect(chamadas[0].args).toMatchObject({ p_dono: A, p_estrategia_id: "e1", p_vela_em: 1_700_000_000_000, p_intervalo: "4h" });
  });
  it("replay → ok sem criar (o id é o da posição que já existe)", async () => {
    const { db } = roteiro({ rpc: { bancada_abrir_posicao_papel: [ok({ ok: true, criada: false, motivo: "ja_registrada", id: "p1" })] } });
    expect(await abrirPosicao(A, db, NOVA)).toEqual({ ok: true, id: "p1", criada: false });
  });
  it("recusas do banco viram motivo, não erro", async () => {
    for (const motivo of ["vela_ja_avaliada", "ja_tem_posicao", "sem_estrategia", "dono_divergente"]) {
      const { db } = roteiro({ rpc: { bancada_abrir_posicao_papel: [ok({ ok: false, motivo })] } });
      expect(await abrirPosicao(A, db, NOVA)).toEqual({ ok: false, motivo });
    }
  });
  it("⚠️ RPC ausente (0076 não aplicada), erro, exceção ou resposta torta → erro, SEM fallback de INSERT", async () => {
    for (const resp of [erro("function public.bancada_abrir_posicao_papel does not exist", "PGRST202"), "lanca" as const,
                        ok(null), ok({ ok: true, criada: true }), ok({ ok: false, motivo: "outra" })]) {
      const { db, chamadas } = roteiro({ rpc: { bancada_abrir_posicao_papel: [resp] } });
      const r = await abrirPosicao(A, db, NOVA);
      expect(r.ok, JSON.stringify(resp)).toBe(false);
      expect(r).toMatchObject({ motivo: "erro" });
      expect(chamadas.every((c) => c.tipo === "rpc")).toBe(true);   // nenhum from().insert de socorro
    }
  });
});

// ── RM-06: escritas do tique ────────────────────────────────────────────
describe("RM-06 · as escritas do tique não transformam erro em sucesso", () => {
  const ITENS = [{ id: "m1", dono: A, visto: {} }, { id: "m2", dono: A, visto: {} }, { id: "m3", dono: A, visto: {} }];

  it("lote OK → gravados = o que o banco contou; lote parcial é declarado", async () => {
    expect(await gravarUltimosTiques(roteiro({ rpc: { bancada_gravar_ultimos_tiques: [ok(3)] } }).db, ITENS, 1))
      .toEqual({ viaLote: true, gravados: 3, falhas: [] });
    const parcial = await gravarUltimosTiques(roteiro({ rpc: { bancada_gravar_ultimos_tiques: [ok(2)] } }).db, ITENS, 1);
    expect(parcial.gravados).toBe(2);
    expect(parcial.falhas).toHaveLength(1);
  });

  it("⚠️⚠️ lote indisponível → fallback por mesa conta SÓ o que o banco confirmou", async () => {
    // m1 grava; m2 volta `{ error }` (antes: gravados++ assim mesmo); m3 atualiza ZERO linhas.
    const { db } = roteiro({
      rpc: { bancada_gravar_ultimos_tiques: [erro("function does not exist", "PGRST202")] },
      update: [ok([{ id: "m1" }]), erro("permission denied"), ok([])],
    });
    const r = await gravarUltimosTiques(db, ITENS, 1);
    expect(r.viaLote).toBe(false);
    expect(r.gravados).toBe(1);
    expect(r.falhas).toHaveLength(2);
    expect(r.falhas.join(" ")).toMatch(/permission denied/);
    expect(r.falhas.join(" ")).toMatch(/nenhuma linha/);
  });

  it("lote que LANÇA (timeout) também cai para o fallback, e exceção no fallback é falha", async () => {
    const { db } = roteiro({ rpc: { bancada_gravar_ultimos_tiques: ["lanca"] }, update: ["lanca", ok([{ id: "m2" }]), ok([{ id: "m3" }])] });
    const r = await gravarUltimosTiques(db, ITENS, 1);
    expect(r).toMatchObject({ viaLote: false, gravados: 2 });
    expect(r.falhas).toHaveLength(1);
  });

  it("gravarUltimoTique: erro e zero linhas são ok:false; uma linha é ok:true", async () => {
    expect((await gravarUltimoTique(A, roteiro({ update: [erro("x")] }).db, "m1", {}, 1)).ok).toBe(false);
    expect((await gravarUltimoTique(A, roteiro({ update: [ok([])] }).db, "m1", {}, 1)).ok).toBe(false);
    expect((await gravarUltimoTique(A, roteiro({ update: [ok([{ id: "m1" }])] }).db, "m1", {}, 1)).ok).toBe(true);
  });

  it("marcarTiqueAdiado: `{ error }` e exceção → ok:false; sucesso → ok:true", async () => {
    expect((await marcarTiqueAdiado(roteiro({ rpc: { bancada_marcar_adiado: [erro("x")] } }).db, ["m1"], 1)).ok).toBe(false);
    expect((await marcarTiqueAdiado(roteiro({ rpc: { bancada_marcar_adiado: ["lanca"] } }).db, ["m1"], 1)).ok).toBe(false);
    expect((await marcarTiqueAdiado(roteiro({ rpc: { bancada_marcar_adiado: [ok(null)] } }).db, ["m1"], 1)).ok).toBe(true);
  });

  it("leituras do cron: erro → null (não sei), nunca [] (nada)", async () => {
    expect(await posicoesAbertasParaOCron(roteiro({ select: [erro("timeout")] }).db)).toBeNull();
    expect(await mesasLigadasParaOCron(roteiro({ select: [erro("timeout")] }).db)).toBeNull();
    expect(await posicoesAbertasParaOCron(roteiro({ select: [ok([])] }).db)).toEqual([]);
    const ms = await mesasDasPosicoesParaOCron(roteiro({ select: [erro("x")] }).db, ["e1"]);
    expect(ms.lotesComFalha).toBe(1);
  });
});

// ── RM-01: lease ───────────────────────────────────────────────────────
describe("RM-01 · o lease do tique e a falha fechada", () => {
  it("mapeia tomado / ocupado / indisponível", async () => {
    expect(await arrendarTique(roteiro({ rpc: { bancada_tique_arrendar: [ok({ ok: true, ate: 99 })] } }).db, "bancada_tique", "tique-x-123", 60_000))
      .toEqual({ ok: true, ate: 99 });
    expect(await arrendarTique(roteiro({ rpc: { bancada_tique_arrendar: [ok({ ok: false, motivo: "ocupado", ate: 99 })] } }).db, "bancada_tique", "tique-x-123", 60_000))
      .toEqual({ ok: false, motivo: "ocupado", ate: 99 });
    for (const resp of [erro("function does not exist", "PGRST202"), "lanca" as const, ok(null), ok({ ok: true })]) {
      const r = await arrendarTique(roteiro({ rpc: { bancada_tique_arrendar: [resp] } }).db, "bancada_tique", "tique-x-123", 60_000);
      expect(r.ok, JSON.stringify(resp)).toBe(false);
      expect(r).toMatchObject({ motivo: "indisponivel" });
    }
    expect((await liberarTique(roteiro({ rpc: { bancada_tique_liberar: [erro("x")] } }).db, "bancada_tique", "t")).ok).toBe(false);
  });

  it("⚠️⚠️ sem lease (0076 ausente) o tique NÃO lê nem escreve nada — falha fechada", async () => {
    const { db, chamadas } = roteiro({ rpc: { bancada_tique_arrendar: [erro("function does not exist", "PGRST202")] } });
    const r = await tiqueDoPapelAdiante(db, 1_700_000_000_000);
    expect(r.exclusividade).toBe("indisponivel");
    expect(r.problemas.join(" ")).toMatch(/NÃO rodou/);
    expect(chamadas.map((c) => c.nome ?? c.tabela)).toEqual(["bancada_tique_arrendar"]);
  });

  it("lease ocupado → não roda, sem problema (é o retry/cron duplo normal)", async () => {
    const { db, chamadas } = roteiro({ rpc: { bancada_tique_arrendar: [ok({ ok: false, motivo: "ocupado", ate: 1 })] } });
    const r = await tiqueDoPapelAdiante(db, 1_700_000_000_000);
    expect(r).toMatchObject({ exclusividade: "ocupado", mesas: 0, abertas: 0, problemas: [] });
    expect(chamadas).toHaveLength(1);
  });

  it("⚠️ leitura das posições falha → o tique PARA (nada abre) e o lease é liberado", async () => {
    const { db, chamadas } = roteiro({
      rpc: { bancada_tique_arrendar: [ok({ ok: true, ate: 2 })], bancada_tique_liberar: [ok(true)] },
      select: [ok([{ id: "m1", dono: "0xd1", params: {}, simbolos: ["BTC"], intervalo: "1h", criada_em: "x", mesa: null,
                     papel_desde: null, praca: "spot_gate", papel: "taker", ultima_vela_aberta: null }]), ok([]),
               erro("statement timeout")],
    });
    const r = await tiqueDoPapelAdiante(db, 1_700_000_000_000);
    expect(r.exclusividade).toBe("tomada");
    expect(r.problemas.join(" ")).toMatch(/tique parado — leitura falhou: posições abertas/);
    expect(chamadas.some((c) => c.nome === "bancada_abrir_posicao_papel")).toBe(false);
    expect(chamadas[chamadas.length - 1].nome).toBe("bancada_tique_liberar");
  });

  it("o lease é liberado mesmo se a passagem LANÇAR", async () => {
    const { db, chamadas } = roteiro({
      rpc: { bancada_tique_arrendar: [ok({ ok: true, ate: 2 })], bancada_tique_liberar: [ok(true)] },
      select: ["lanca"],
    });
    await expect(tiqueDoPapelAdiante(db, 1_700_000_000_000)).rejects.toThrow();
    expect(chamadas[chamadas.length - 1].nome).toBe("bancada_tique_liberar");
  });
});
