/**
 * O TESTE DE ISOLAMENTO — a carteira A não recebe a linha da carteira B.
 *
 * ⚠️⚠️ POR QUE ELE TEM UM BANCO FALSO DE VERDADE, e não um espião de chamadas.
 *
 * A tentação era gravar as chamadas (`espionar(".eq")`) e afirmar que
 * `.eq("dono", ...)` foi chamado. Isso é transcrição de código com fantasia de
 * teste — a mesma armadilha que passou verde quatro vezes nesta base neste mês
 * (guardas textuais sobre o fonte de rota, 05/09). Ela prova que a LINHA existe,
 * não que o DADO não vaza.
 *
 * Então o banco falso guarda linhas de verdade e aplica os filtros de verdade.
 * A asserção é sobre O QUE VOLTOU. Se alguém apagar o `.eq("dono", ...)` de
 * `doDono`, a linha da outra carteira aparece no resultado e o teste quebra —
 * que é exatamente o defeito que ele existe para pegar.
 *
 * ⚠️ E TODO CASO É QUEBRADO NOS DOIS SENTIDOS. Um store que devolvesse `[]`
 * para sempre passaria em qualquer teste de "A não vê B". Por isso cada
 * asserção de negação tem a gêmea positiva: o dono CERTO recebe a linha.
 */

import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { donoDaSessao, donoDeLinhaDoBanco, type Dono } from "@/lib/bancada/dono";
import {
  salvarEstrategia, listarEstrategias, estrategia, arquivarEstrategia,
  contarEstrategiasVivas, abrirRodada, fecharRodada, listarRodadas, rodada,
  consumoDaJanela, gravarResultado, resultado,
  abrirPosicao, posicoesAbertas, posicoesAbertasParaOCron, fecharPosicao,
  JANELA_DA_COTA_MS,
} from "@/lib/bancada/store";

// ── O BANCO FALSO ───────────────────────────────────────────────────
// Linhas de verdade, filtros de verdade. Só o transporte é falso.

type Linha = Record<string, unknown>;

function comparavel(v: unknown): number | string {
  if (typeof v === "number") return v;
  return String(v);
}

function consulta(
  linhas: () => Linha[],
  opts: { head?: boolean; falha?: string | null } = {},
) {
  const filtros: Array<(r: Linha) => boolean> = [];
  let ordem: { col: string; asc: boolean } | null = null;
  let limite = Infinity;
  let um = false;

  function resolver() {
    if (opts.falha) return { data: null, error: { message: opts.falha }, count: null };
    let rs = linhas().filter((r) => filtros.every((f) => f(r)));
    if (ordem) {
      const { col, asc } = ordem;
      rs = [...rs].sort((a, b) => {
        const x = comparavel(a[col]), y = comparavel(b[col]);
        const d = x < y ? -1 : x > y ? 1 : 0;
        return asc ? d : -d;
      });
    }
    if (Number.isFinite(limite)) rs = rs.slice(0, limite);
    if (opts.head) return { data: null, error: null, count: rs.length };
    if (um) return { data: rs[0] ?? null, error: null, count: rs.length };
    return { data: rs, error: null, count: rs.length };
  }

  const api = {
    eq(col: string, val: unknown) { filtros.push((r) => r[col] === val); return api; },
    gte(col: string, val: unknown) { filtros.push((r) => comparavel(r[col]) >= comparavel(val)); return api; },
    lte(col: string, val: unknown) { filtros.push((r) => comparavel(r[col]) <= comparavel(val)); return api; },
    is(col: string, val: unknown) { filtros.push((r) => (r[col] ?? null) === val); return api; },
    order(col: string, o?: { ascending?: boolean }) { ordem = { col, asc: o?.ascending !== false }; return api; },
    limit(n: number) { limite = n; return api; },
    maybeSingle() { um = true; return api; },
    single() { um = true; return api; },
    then<R>(ok: (v: ReturnType<typeof resolver>) => R) { return Promise.resolve(resolver()).then(ok); },
  };
  return api;
}

function bancoFalso(inicial: Record<string, Linha[]> = {}, falhas: Record<string, string> = {}) {
  const tabelas: Record<string, Linha[]> = {};
  for (const [t, rs] of Object.entries(inicial)) tabelas[t] = rs.map((r) => ({ ...r }));
  let seq = 0;

  function alvo(t: string): Linha[] { return (tabelas[t] ??= []); }

  const db = {
    from(t: string) {
      return {
        select(_cols: string, o?: { head?: boolean }) {
          return consulta(() => alvo(t), { head: o?.head, falha: falhas[t] ?? null });
        },
        insert(v: Linha | Linha[]) {
          const novas = (Array.isArray(v) ? v : [v]).map((x) => ({
            id: `${t}-${++seq}`,
            criada_em: new Date(Date.now() - seq).toISOString(),
            aberta_em: new Date(Date.now() - seq).toISOString(),
            arquivada_em: null,
            ...x,
          }));
          if (falhas[t]) return { select: () => consulta(() => [], { falha: falhas[t] }) };
          alvo(t).push(...novas);
          return { select: () => consulta(() => novas) };
        },
        update(patch: Linha) {
          const filtros: Array<(r: Linha) => boolean> = [];
          const api = {
            eq(col: string, val: unknown) { filtros.push((r) => r[col] === val); return api; },
            then<R>(ok: (v: { error: { message: string } | null }) => R) {
              if (falhas[t]) return Promise.resolve(ok({ error: { message: falhas[t] } }));
              for (const r of alvo(t)) if (filtros.every((f) => f(r))) Object.assign(r, patch);
              return Promise.resolve(ok({ error: null }));
            },
          };
          return api;
        },
        upsert(v: Linha, o?: { onConflict?: string }) {
          if (falhas[t]) return Promise.resolve({ error: { message: falhas[t] } });
          const chave = (o?.onConflict ?? "id").split(",").map((c) => c.trim());
          const rs = alvo(t);
          const igual = rs.find((r) => chave.every((c) => r[c] === v[c]));
          if (igual) Object.assign(igual, v);
          else rs.push({ criado_em: new Date().toISOString(), ...v });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, tabelas };
}

// ── DUAS CARTEIRAS ──────────────────────────────────────────────────

// ⚠️ O DONO SAI DA SESSÃO, sempre — inclusive no teste. Escrever
// `const A = "0xAAAA1111" as Dono` aqui seria contornar no teste exatamente a
// trava que o teste existe para provar.
const A: Dono = donoDaSessao({ sub: "0xAAAA1111", chain: "evm" })!.dono;
const B: Dono = donoDaSessao({ sub: "0xBBBB2222", chain: "evm" })!.dono;

const ESTRATEGIA = { nome: "média 20", params: { mediaN: 20 }, praca: "spot_gate" as const, papel: "taker" as const };
const RODADA = {
  estrategiaId: null, origem: "casa" as const, capitalUsd: 1000,
  simbolos: ["BTC"], intervalo: "1d", janelaDe: 1, janelaAte: 2,
  praca: "spot_gate" as const, papel: "taker" as const, params: {}, custoVelas: 365,
};

describe("o dono só se constrói a partir de uma procedência verificada", () => {
  it("sessão ausente, vazia ou sem cadeia não vira dono", () => {
    expect(donoDaSessao(null)).toBeNull();
    expect(donoDaSessao(undefined)).toBeNull();
    expect(donoDaSessao({ sub: "   ", chain: "evm" })).toBeNull();
    // ⚠️ Cadeia inválida é sessão inválida: `chain` decide praça e taxa depois.
    expect(donoDaSessao({ sub: "0xok", chain: "bitcoin" } as never)).toBeNull();
  });

  it("⚠️ a carteira vai VERBATIM, sem baixar a caixa", () => {
    // Endereço Solana é base58: 'A' e 'a' são caracteres DIFERENTES. Baixar a
    // caixa devolveria algo que não é mais um endereço — e podia colidir com
    // outra carteira. `quotaBucket` pode fazer isso porque é chave de
    // contagem; uma coluna de DONO não pode.
    const solana = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
    expect(donoDaSessao({ sub: solana, chain: "solana" })!.dono).toBe(solana);
    expect(donoDaSessao({ sub: "0xAbCd", chain: "evm" })!.dono).toBe("0xAbCd");
  });

  it("uma string crua NÃO é um Dono — a checagem é de tipo, e ela é o teste", () => {
    const { db } = bancoFalso();
    // ⚠️⚠️ ESTE `@ts-expect-error` É A ASSERÇÃO. Ele documenta que o ataque real
    // — a rota aceitar `dono` do corpo da requisição — não compila. Se a marca
    // do tipo enfraquecer, o `@ts-expect-error` fica sem erro para suprimir e o
    // `type-check` do CI quebra. Não há como afrouxar a trava em silêncio.
    // @ts-expect-error — string não satisfaz Dono, e é essa a proteção
    void listarEstrategias("0xqualquer-carteira", db);
    expect(donoDeLinhaDoBanco("0xveio-do-banco")).toBe("0xveio-do-banco");
    expect(donoDeLinhaDoBanco("   ")).toBeNull();
  });
});

describe("estratégias: A nunca alcança a linha de B", () => {
  it("lista só as próprias — e A recebe as SUAS (a metade positiva)", async () => {
    const { db } = bancoFalso();
    await salvarEstrategia(A, "evm", db, { ...ESTRATEGIA, nome: "da A" });
    await salvarEstrategia(B, "evm", db, { ...ESTRATEGIA, nome: "da B" });

    const daA = await listarEstrategias(A, db);
    const daB = await listarEstrategias(B, db);

    expect(daA.map((e) => e.nome)).toEqual(["da A"]);
    expect(daB.map((e) => e.nome)).toEqual(["da B"]);
  });

  it("⚠️ o id de B não abre a linha de B para A — nem existência ela vaza", async () => {
    const { db } = bancoFalso();
    const criada = await salvarEstrategia(B, "evm", db, ESTRATEGIA);
    expect(criada.ok).toBe(true);
    const idDeB = criada.ok ? criada.valor : "";

    // O mesmo id, as duas carteiras: só uma vê.
    expect(await estrategia(A, db, idDeB)).toBeNull();
    expect((await estrategia(B, db, idDeB))?.id).toBe(idDeB);
  });

  it("⚠️ A não consegue ARQUIVAR a estratégia de B", async () => {
    const { db, tabelas } = bancoFalso();
    const criada = await salvarEstrategia(B, "evm", db, ESTRATEGIA);
    const idDeB = criada.ok ? criada.valor : "";

    await arquivarEstrategia(A, db, idDeB);
    expect(tabelas.bancada_estrategia[0].arquivada_em).toBeNull();

    // A metade positiva: o dono certo arquiva.
    await arquivarEstrategia(B, db, idDeB);
    expect(tabelas.bancada_estrategia[0].arquivada_em).not.toBeNull();
  });

  it("a contagem da cota conta as VIVAS deste dono, e só", async () => {
    const { db } = bancoFalso();
    await salvarEstrategia(A, "evm", db, ESTRATEGIA);
    const segunda = await salvarEstrategia(A, "evm", db, ESTRATEGIA);
    await salvarEstrategia(B, "evm", db, ESTRATEGIA);
    await salvarEstrategia(B, "evm", db, ESTRATEGIA);

    expect(await contarEstrategiasVivas(A, db)).toBe(2);
    await arquivarEstrategia(A, db, segunda.ok ? segunda.valor : "");
    expect(await contarEstrategiasVivas(A, db)).toBe(1);
    // As de B não entram na conta de A nem depois do arquivamento.
    expect(await contarEstrategiasVivas(B, db)).toBe(2);
  });

  it("⚠️ falha de leitura devolve `null`, NUNCA zero", async () => {
    const { db } = bancoFalso({}, { bancada_estrategia: "connection reset" });
    // Zero liberaria a cota inteira justamente quando o banco está ruim — falha
    // ABERTA num caminho que segura custo. `null` obriga quem chama a recusar.
    expect(await contarEstrategiasVivas(A, db)).toBeNull();
  });
});

describe("rodadas e resultados: o mesmo isolamento, e a cota que ele sustenta", () => {
  it("A não lista nem abre a rodada de B, e vê as próprias", async () => {
    const { db } = bancoFalso();
    const daA = await abrirRodada(A, "evm", db, RODADA);
    const daB = await abrirRodada(B, "evm", db, RODADA);
    const idA = daA.ok ? daA.valor : "";
    const idB = daB.ok ? daB.valor : "";

    expect((await listarRodadas(A, db)).map((r) => r.id)).toEqual([idA]);
    expect(await rodada(A, db, idB)).toBeNull();
    expect((await rodada(A, db, idA))?.custoVelas).toBe(365);
  });

  it("⚠️ A não fecha a rodada de B", async () => {
    const { db, tabelas } = bancoFalso();
    const daB = await abrirRodada(B, "evm", db, RODADA);
    const idB = daB.ok ? daB.valor : "";

    await fecharRodada(A, db, idB, "falhou", "invadido");
    expect(tabelas.bancada_rodada[0].status).toBe("rodando");

    await fecharRodada(B, db, idB, "concluida");
    expect(tabelas.bancada_rodada[0].status).toBe("concluida");
  });

  it("o resultado de B não volta para A, e o de A volta inteiro", async () => {
    const { db } = bancoFalso();
    const daB = await abrirRodada(B, "evm", db, RODADA);
    const idB = daB.ok ? daB.valor : "";
    await gravarResultado(B, db, idB, {
      brutoPct: 4.1, taxaPct: -3.8, derrapagemPct: -0.2, liquidoPct: 0.1,
      n: 24, acertos: 15, equilibrioExigidoPct: 58, veredito: "ganhou", naoMedido: [],
    });

    expect(await resultado(A, db, idB)).toBeNull();
    expect((await resultado(B, db, idB))?.liquidoPct).toBe(0.1);
  });

  it("⚠️ equilíbrio ausente continua ausente — `Number(null)` é 0 e passa em isFinite", async () => {
    const { db } = bancoFalso();
    const r = await abrirRodada(A, "evm", db, RODADA);
    const id = r.ok ? r.valor : "";
    await gravarResultado(A, db, id, {
      brutoPct: 1, taxaPct: -1, derrapagemPct: 0, liquidoPct: 0,
      n: 3, acertos: 1, equilibrioExigidoPct: null, veredito: "ruido", naoMedido: ["derrapagem"],
    });
    const lido = await resultado(A, db, id);
    expect(lido?.equilibrioExigidoPct).toBeNull();
    expect(lido?.naoMedido).toEqual(["derrapagem"]);
  });
});

describe("a cota — janela móvel, custo em trabalho, e o portão que não cobra", () => {
  const AGORA = Date.parse("2026-09-05T12:00:00Z");

  function comRodadas(linhas: Array<Partial<Linha>>) {
    return bancoFalso({
      bancada_rodada: linhas.map((l, i) => ({
        id: `r${i}`, dono: A as string, custo_velas: 100, status: "concluida",
        criada_em: new Date(AGORA - 1000).toISOString(), ...l,
      })),
    });
  }

  it("soma o TRABALHO, não só a contagem", async () => {
    const { db } = comRodadas([{ custo_velas: 365 }, { custo_velas: 1095 }]);
    expect(await consumoDaJanela(A, db, AGORA)).toEqual({ rodadas: 2, velas: 1460 });
  });

  it("⚠️ o que é de B não entra na cota de A", async () => {
    const { db } = comRodadas([{ custo_velas: 100 }, { dono: B as string, custo_velas: 9999 }]);
    expect(await consumoDaJanela(A, db, AGORA)).toEqual({ rodadas: 1, velas: 100 });
  });

  it("⚠️ rodada RECUSADA não consome cota", async () => {
    // Ela é recusada pelo portão do pedágio antes de ler vela nenhuma. Cobrar
    // por ela puniria o cliente pela mensagem que o impediu de perder dinheiro.
    const { db } = comRodadas([{ status: "recusada", custo_velas: 500 }, { custo_velas: 100 }]);
    expect(await consumoDaJanela(A, db, AGORA)).toEqual({ rodadas: 1, velas: 100 });
  });

  it("⚠️ a janela é MÓVEL de 24h — não há virada de meia-noite para explorar", async () => {
    const { db } = comRodadas([
      { custo_velas: 100, criada_em: new Date(AGORA - JANELA_DA_COTA_MS + 60_000).toISOString() },
      { custo_velas: 700, criada_em: new Date(AGORA - JANELA_DA_COTA_MS - 60_000).toISOString() },
    ]);
    // Com reset por dia de calendário, gastar tudo às 23h59 e tudo de novo às
    // 00h01 dobraria a cota. Contra a janela móvel isso não existe.
    expect(await consumoDaJanela(A, db, AGORA)).toEqual({ rodadas: 1, velas: 100 });
  });

  it("⚠️ falha de leitura devolve `null`, não consumo zero", async () => {
    const { db } = bancoFalso({}, { bancada_rodada: "timeout" });
    expect(await consumoDaJanela(A, db, AGORA)).toBeNull();
  });
});

describe("papel adiante: isolado por dono, menos onde o cron precisa de todos", () => {
  const POSICAO = {
    estrategiaId: "e1", simbolo: "BTC", lado: "long" as const,
    entrada: 100, tamanhoUsd: 500, alvoPct: 2, stopPct: 1.2, expiraEm: null, velaEm: null,
  };

  it("A vê as suas posições abertas e nenhuma de B", async () => {
    const { db } = bancoFalso();
    await abrirPosicao(A, db, POSICAO);
    await abrirPosicao(B, db, { ...POSICAO, simbolo: "ETH" });

    expect((await posicoesAbertas(A, db)).map((p) => p.simbolo)).toEqual(["BTC"]);
    expect((await posicoesAbertas(B, db)).map((p) => p.simbolo)).toEqual(["ETH"]);
  });

  it("⚠️ A não fecha a posição de B", async () => {
    const { db, tabelas } = bancoFalso();
    const daB = await abrirPosicao(B, db, POSICAO);
    const idB = daB.ok ? daB.valor : "";

    await fecharPosicao(A, db, idB, "perdeu", 90, -10);
    expect(tabelas.bancada_posicao[0].status).toBe("aberta");

    await fecharPosicao(B, db, idB, "expirada", null, null);
    expect(tabelas.bancada_posicao[0].status).toBe("expirada");
  });

  it("⚠️ o cron vê TODAS as abertas — é o ponto dela — e cada linha carrega o dono certo", async () => {
    const { db } = bancoFalso();
    await abrirPosicao(A, db, POSICAO);
    await abrirPosicao(B, db, { ...POSICAO, simbolo: "ETH" });

    const todas = await posicoesAbertasParaOCron(db);
    expect(todas).toHaveLength(2);
    // ⚠️ O dono de cada posição é reconstruído da PRÓPRIA LINHA
    // (`donoDeLinhaDoBanco`), nunca de requisição. É o que permite o cron
    // fechar cada posição como o dono dela sem nunca aceitar um dono de fora.
    expect(todas.find((p) => p.simbolo === "BTC")!.dono).toBe(A);
    expect(todas.find((p) => p.simbolo === "ETH")!.dono).toBe(B);
  });

  it("a posição fechada sai da varredura do cron", async () => {
    const { db } = bancoFalso();
    const daA = await abrirPosicao(A, db, POSICAO);
    await fecharPosicao(A, db, daA.ok ? daA.valor : "", "ganhou", 102, 2);
    expect(await posicoesAbertasParaOCron(db)).toHaveLength(0);
  });
});
