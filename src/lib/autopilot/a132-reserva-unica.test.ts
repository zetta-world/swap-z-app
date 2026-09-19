/**
 * ⚠️⚠️⚠️ A132 — UMA ÚNICA FORMA DE GASTAR A VAGA DO DIA.
 *
 * O Round 8 consertou metade: o navegador passou a RESERVAR antes do envio, por
 * compare-and-swap. O cron continuou somando DEPOIS, com `bumpSessionTrades` —
 * `trades_today = trades_today + n`, atômico e **sem conferir teto**.
 *
 *     trades_today = 4, max = 5
 *     navegador lê 4 → CAS → 5
 *     cron já tinha lido 4 → envia → soma → 6
 *
 * O Round 8 DECLAROU essa corrida como limitação conhecida. Este arquivo é o
 * fim dela: os dois canais chamam a mesma primitiva, e ninguém conta depois.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Banco falso com a semântica do CAS que importa: o `update` só grava se o
 * `trades_today` do WHERE ainda casar com o valor da linha.
 *
 * ⚠️ NÃO É UMA FUNÇÃO PURA SENDO TESTADA. O §13 pede a primitiva real, e é
 * ela que roda aqui — `reservarTradeDaSessao`, com o `.eq("trades_today",
 * atual).select("id")` de verdade. O que este falso reproduz é o que o
 * Postgres faz em READ COMMITTED: a segunda transação reavalia o WHERE contra
 * a linha já atualizada e grava ZERO linhas.
 */
const estado = vi.hoisted(() => ({
  linha: { trades_today: 4, max_trades_per_day: 5, is_active: true, last_reset_day: "2026-09-19" },
  updates: 0,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      if (t !== "autopilot_sessions") throw new Error(`tabela inesperada: ${t}`);
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: { ...estado.linha }, error: null }) }),
        }),
        update: (patch: { trades_today: number }) => {
          const condicoes: Record<string, unknown> = {};
          const alvo = {
            eq(coluna: string, valor: unknown) { condicoes[coluna] = valor; return alvo; },
            select() {
              estado.updates++;
              const casa =
                (condicoes.is_active === undefined || condicoes.is_active === estado.linha.is_active)
                && (condicoes.last_reset_day === undefined || condicoes.last_reset_day === estado.linha.last_reset_day)
                && (condicoes.trades_today === undefined || condicoes.trades_today === estado.linha.trades_today);
              if (!casa) return Promise.resolve({ data: [], error: null });
              estado.linha.trades_today = patch.trades_today;
              return Promise.resolve({ data: [{ id: "S1" }], error: null });
            },
          };
          return alvo;
        },
      };
    },
  }),
}));

import { reservarTradeDaSessao, liberarTradeDaSessao } from "@/lib/autopilot/sessions";
import { reservaDaVagaDiaria } from "@/lib/autopilot/reserva-de-vaga";

const HOJE = "2026-09-19";

beforeEach(() => {
  estado.linha = { trades_today: 4, max_trades_per_day: 5, is_active: true, last_reset_day: HOJE };
  estado.updates = 0;
});

describe("A132.1 — cron e navegador concorrentes com 4/5", () => {
  it("⚠️⚠️ NO MÁXIMO UMA das duas reservas passa, e o contador fecha em 5", async () => {
    /**
     * As duas leem 4 (a leitura acontece antes de qualquer update), as duas
     * tentam o CAS. A primeira casa; a segunda não casa, relê 5, vê 5/5 e
     * devolve `limite_diario`. O contador NÃO pode chegar a 6.
     */
    const navegador = reservaDaVagaDiaria("S1", HOJE);
    const cron      = reservaDaVagaDiaria("S1", HOJE);
    const [a, b] = await Promise.all([navegador.reservar(), cron.reservar()]);

    const passaram = [a, b].filter((r) => r.ok).length;
    expect(passaram, "duas ordens não podem caber na última vaga").toBe(1);
    expect(estado.linha.trades_today).toBe(5);
    const negada = [a, b].find((r) => !r.ok);
    expect(negada && !negada.ok && negada.porque).toMatch(/limite_diario/);
  });

  it("⚠️ com folga (3/5) as DUAS passam — o CAS não trava o caminho legítimo", async () => {
    estado.linha.trades_today = 3;
    const um   = reservaDaVagaDiaria("S1", HOJE);
    const dois = reservaDaVagaDiaria("S1", HOJE);
    const [a, b] = await Promise.all([um.reservar(), dois.reservar()]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(estado.linha.trades_today).toBe(5);
  });
});

describe("A132.2 — reserva negada: ZERO efeito externo", () => {
  it("⚠️⚠️ no teto, a reserva recusa e diz por quê", async () => {
    estado.linha.trades_today = 5;
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    const r = await vaga.reservar();
    expect(r.ok).toBe(false);
    expect(vaga.ultimoMotivo()).toBe("limite_diario");
    expect(vaga.vagaViva()).toBeNull();
    // Nenhuma escrita: o contador não pode se mexer numa recusa.
    expect(estado.updates).toBe(0);
    expect(estado.linha.trades_today).toBe(5);
  });

  it("⚠️ sessão parada também recusa — e o motivo NÃO é o teto", async () => {
    estado.linha.is_active = false;
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    expect((await vaga.reservar()).ok).toBe(false);
    expect(vaga.ultimoMotivo()).toBe("sessao_inativa");
  });

  it("⚠️ contador de ONTEM não é vaga de hoje", async () => {
    estado.linha.last_reset_day = "2026-09-18";
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    expect((await vaga.reservar()).ok).toBe(false);
    expect(vaga.ultimoMotivo()).toBe("virou_o_dia");
  });
});

describe("A132.3/A132.4 — quando a vaga volta, e quando NÃO volta", () => {
  it("⚠️⚠️ recusa PROVADA devolve a vaga: 4 → 5 → 4", async () => {
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    expect((await vaga.reservar()).ok).toBe(true);
    expect(estado.linha.trades_today).toBe(5);
    await vaga.liberar!();
    expect(estado.linha.trades_today).toBe(4);
  });

  it("⚠️⚠️ UNKNOWN não devolve — o executor simplesmente não chama `liberar`", async () => {
    /**
     * A INVARIANTE 4 mora no executor: `liberar` é chamada em três pontos,
     * todos com prova de que nada saiu. Aqui o teste mede a consequência: se
     * ninguém libera, a vaga fica gasta. Devolvê-la sobre dúvida autorizaria um
     * segundo envio para um dinheiro que talvez já tenha saído.
     */
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    await vaga.reservar();
    expect(estado.linha.trades_today).toBe(5);
    // (nenhuma chamada a liberar — é isso que o desfecho incerto faz)
    expect(estado.linha.trades_today).toBe(5);
    expect(vaga.vagaViva()).toBe(5);
  });

  it("⚠️⚠️ `liberar` sem reserva viva não devolve NADA", async () => {
    // Senão uma ordem recusada devolveria a vaga de OUTRA que reservou depois.
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    await vaga.liberar!();
    expect(estado.linha.trades_today).toBe(4);
    expect(estado.updates).toBe(0);
  });

  it("⚠️ e a devolução também é CAS: contador que andou NÃO é desfeito", async () => {
    const vaga = reservaDaVagaDiaria("S1", HOJE);
    await vaga.reservar();                      // 4 → 5
    estado.linha.trades_today = 6;              // outra ordem reservou depois
    await vaga.liberar!();
    // Sobra uma vaga gasta — que é o lado seguro. Inventar vaga, não.
    expect(estado.linha.trades_today).toBe(6);
  });

  it("⚠️ a primitiva crua concorda com o invólucro", async () => {
    const r = await reservarTradeDaSessao("S1", HOJE);
    expect(r).toEqual({ ok: true, tradesDepois: 5 });
    expect(await liberarTradeDaSessao("S1", HOJE, 5)).toBe(true);
    expect(estado.linha.trades_today).toBe(4);
  });
});

describe("A132.5/A132.6 — ninguém conta duas vezes", () => {
  const semComentarios = (c: string) =>
    c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));
  const ORDEM = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
  const FIRE = semComentarios(readFileSync("src/app/api/autopilot/session/record-fire/route.ts", "utf8"));

  it("⚠️⚠️ o cron RESERVA, e não soma depois", () => {
    expect(CRON).toMatch(/reservaDaVagaDiaria\(/);
    expect(CRON).not.toMatch(/bumpSessionTrades/);
    expect(CRON).not.toMatch(/bump_session_trades/);
  });

  it("⚠️⚠️ a reserva do cron entra na costura do executor, ANTES do envio", () => {
    // O quinto argumento de `executarOrdemCex` é a `ReservaDeRisco`; ela roda
    // entre AUTHORIZED e SUBMITTING. Reservar depois do envio não existe.
    const compras = [...CRON.matchAll(/vagaDaCompra,/g)].length;
    const vendas  = [...CRON.matchAll(/vagaDaVenda,/g)].length;
    expect(compras).toBeGreaterThan(0);
    expect(vendas).toBeGreaterThan(0);
    const iNova = CRON.indexOf("const vagaDaCompra = novaVaga();");
    const iExec = CRON.indexOf("executarOrdemCex(", iNova);
    expect(iNova).toBeGreaterThan(-1);
    expect(iNova).toBeLessThan(iExec);
  });

  it("⚠️⚠️ os DOIS canais usam a MESMA primitiva", () => {
    expect(ORDEM).toMatch(/reservaDaVagaDiaria\(/);
    expect(CRON).toMatch(/reservaDaVagaDiaria\(/);
  });

  it("⚠️⚠️ `record-fire` continua 409 e sem escrever (Round 8 preservado)", () => {
    expect(FIRE).toMatch(/contagem_no_servidor/);
    expect(FIRE).toMatch(/status: 409/);
    expect(FIRE).not.toMatch(/bumpSessionTrades/);
    expect(FIRE).not.toMatch(/ok: true/);
  });

  it("⚠️ uma vaga por ORDEM, não por cartão — multi-perna (§12)", () => {
    // `novaVaga()` cria uma reserva nova a cada execução; reservar 3 de
    // antemão contaria pernas que podem nunca sair.
    // ⚠️ A134/A135: `novaVaga` passou a compor a devolução das reservas de
    // inventário — continua sendo UMA vaga por ordem, criada na hora.
    expect(CRON).toMatch(/const novaVaga = \(\): VagaDiaria => \{/);
    expect(CRON).toMatch(/const vaga = reservaDaVagaDiaria\(s\.id, today\);/);
    expect(CRON).toMatch(/await vaga\.liberar\?\.\(\); await devolverReservasDaOrdem\(\);/);
  });
});
