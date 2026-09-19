/**
 * ⚠️⚠️⚠️ A133 — "ZERO POSIÇÕES" NÃO É "NÃO CONSEGUI LER".
 *
 * O livro `autopilot_positions` é a resposta à pergunta que autoriza dinheiro
 * autônomo: "o que o bot possui?". Ele respondia `[]` para as duas coisas —
 * leitura vazia legítima e erro de banco — e quem chama opera sobre `[]`:
 * exposição zero, nenhuma base possuída, teto de exposição liberado inteiro.
 *
 * Um Postgres intermitente virava licença para comprar mais.
 *
 * ⚠️ E O CONSERTO JÁ ESTAVA ESCRITO UMA CAMADA ACIMA: `reconciliar-conta.ts`
 * documenta que falha de leitura é `leitura_falhou` e bloqueia entradas. Quem
 * engolia o erro era a função abaixo dela. Família do A113.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/** Banco falso mínimo: só `autopilot_positions`, com erro ligável por teste. */
const estado = vi.hoisted(() => ({
  erroNaLeitura: null as { message: string } | null,
  linhas: [] as Record<string, unknown>[],
  escritas: [] as { tipo: string; payload: unknown }[],
  temBanco: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    if (!estado.temBanco) return null;
    const resultado = () => estado.erroNaLeitura
      ? { data: null, error: estado.erroNaLeitura }
      : { data: estado.linhas, error: null };
    const um = () => estado.erroNaLeitura
      ? { data: null, error: estado.erroNaLeitura }
      : { data: estado.linhas[0] ?? null, error: null };
    const cadeia = (final: () => unknown) => {
      const o: Record<string, unknown> = {};
      for (const m of ["eq", "neq", "select", "order", "limit"]) {
        o[m] = () => cadeia(final);
      }
      o.maybeSingle = () => Promise.resolve(um());
      o.then = (res: (v: unknown) => unknown) => Promise.resolve(final()).then(res);
      return o;
    };
    return {
      from: (t: string) => {
        if (t !== "autopilot_positions") throw new Error(`tabela inesperada: ${t}`);
        return {
          select: () => cadeia(resultado),
          update: (payload: unknown) => {
            estado.escritas.push({ tipo: "update", payload });
            return cadeia(() => ({ error: null }));
          },
          upsert: (payload: unknown) => {
            estado.escritas.push({ tipo: "upsert", payload });
            return Promise.resolve({ error: null });
          },
          delete: () => {
            estado.escritas.push({ tipo: "delete", payload: null });
            return cadeia(() => ({ error: null }));
          },
        };
      },
    };
  },
}));

import {
  getOpenServerPositions, lerPosicaoDoBot, recordServerEntry,
} from "@/lib/autopilot/positions-server";

beforeEach(() => {
  estado.erroNaLeitura = null;
  estado.linhas = [];
  estado.escritas = [];
  estado.temBanco = true;
});

describe("A133.1 — erro de banco NÃO vira lista vazia", () => {
  it("⚠️⚠️ erro na leitura: `ok: false`, e nunca `[]` como sucesso", async () => {
    estado.erroNaLeitura = { message: "connection reset by peer" };
    const r = await getOpenServerPositions("S1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toContain("connection reset");
    // ⚠️ O ponto do achado: o tipo não permite mais confundir os dois.
    expect(r).not.toHaveProperty("length");
  });

  it("⚠️⚠️ sem banco configurado também é falha, não 'não há posições'", async () => {
    estado.temBanco = false;
    const r = await getOpenServerPositions("S1");
    expect(r.ok).toBe(false);
  });

  it("⚠️⚠️ a posição de UMA base tem as TRÊS respostas", async () => {
    estado.erroNaLeitura = { message: "db fora" };
    const falhou = await lerPosicaoDoBot("S1", "btc");
    expect(falhou.ok).toBe(false);

    estado.erroNaLeitura = null;
    const ausente = await lerPosicaoDoBot("S1", "btc");
    expect(ausente).toEqual({ ok: true, posicao: null });

    estado.linhas = [{ id: "P1", base: "BTC", base_amount: 0.01 }];
    const existe = await lerPosicaoDoBot("S1", "btc");
    expect(existe.ok).toBe(true);
    if (existe.ok) expect(existe.posicao).toMatchObject({ id: "P1" });
  });
});

describe("A133.2 — sucesso com data vazio CONTINUA sendo zero posições", () => {
  it("⚠️ leitura boa e vazia não bloqueia nada", async () => {
    const r = await getOpenServerPositions("S1");
    expect(r).toEqual({ ok: true, posicoes: [] });
  });

  it("⚠️ e leitura boa com linhas devolve as linhas", async () => {
    estado.linhas = [{ id: "P1", base: "BTC" }, { id: "P2", base: "ETH" }];
    const r = await getOpenServerPositions("S1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.posicoes).toHaveLength(2);
  });
});

describe("A133.5 — `recordServerEntry` não conclui nada de leitura que falhou", () => {
  it("⚠️⚠️ select anterior falha: ZERO escrita, e devolve erro", async () => {
    /**
     * O perigo concreto: o ramo de baixo faz UPSERT por `(session_id, base)`.
     * Concluir "não existe posição" de uma leitura falha SOBRESCREVERIA o
     * acumulado do dia pelo tamanho da última compra — o livro passaria a
     * dizer que o bot tem menos do que tem, e o resto vira órfão.
     */
    estado.erroNaLeitura = { message: "timeout na leitura" };
    const r = await recordServerEntry({
      sessionId: "S1", walletAddress: "0xA", exchangeId: "binance",
      pair: "BTC/USDT", entryPrice: 60_000, baseAmount: 0.01, costUsd: 600,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("leitura da posicao anterior falhou");
    expect(estado.escritas).toHaveLength(0);
  });

  it("⚠️ o gêmeo positivo: leitura boa e vazia GRAVA a posição nova", async () => {
    const r = await recordServerEntry({
      sessionId: "S1", walletAddress: "0xA", exchangeId: "binance",
      pair: "BTC/USDT", entryPrice: 60_000, baseAmount: 0.01, costUsd: 600,
    });
    expect(r).toEqual({ ok: true });
    expect(estado.escritas).toHaveLength(1);
    expect(estado.escritas[0].tipo).toBe("upsert");
  });

  it("⚠️ e leitura boa com posição existente SOMA, em vez de sobrescrever", async () => {
    estado.linhas = [{ id: "P1", base: "BTC", base_amount: 0.01, cost_usd: 600, status: "open" }];
    const r = await recordServerEntry({
      sessionId: "S1", walletAddress: "0xA", exchangeId: "binance",
      pair: "BTC/USDT", entryPrice: 62_000, baseAmount: 0.01, costUsd: 620,
    });
    expect(r).toEqual({ ok: true });
    expect(estado.escritas[0].tipo).toBe("update");
    const patch = estado.escritas[0].payload as { base_amount: number; cost_usd: number };
    expect(patch.base_amount).toBeCloseTo(0.02, 12);
    expect(patch.cost_usd).toBeCloseTo(1_220, 12);
  });
});

describe("A133.3/A133.4 — os callers distinguem os dois estados", () => {
  const CRON = readFileSync("src/app/api/autopilot/cron/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const CONTA = readFileSync("src/lib/cex/execucao/reconciliar-conta.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("⚠️⚠️ nenhum caller usa mais o retorno como array direto", () => {
    // `(await getOpenServerPositions(x)).filter(...)` era o padrão perigoso.
    expect(CRON).not.toMatch(/\(await getOpenServerPositions\([^)]*\)\)\s*\./);
    expect(CONTA).not.toMatch(/\(await getOpenServerPositions\([^)]*\)\)\s*\./);
  });

  it("⚠️⚠️ o cron PARA a passada quando o livro não pode ser lido", () => {
    expect(CRON).toMatch(/if \(!leituraDoLivro\.ok \|\| !livroLegivelNoSettle\)/);
    expect(CRON).toMatch(/position book unreadable — zero new entries/);
    expect(CRON).toMatch(/autopilot_livro_ilegivel/);
    // A parada vem ANTES do scan e de qualquer ordem.
    const iParada = CRON.indexOf("position book unreadable");
    expect(iParada).toBeLessThan(CRON.indexOf("runAutopilotCexScan("));
    expect(iParada).toBeLessThan(CRON.indexOf("executarOrdemCex("));
  });

  it("⚠️⚠️ e `reconciliarConta` devolve `undefined` — que ela já trata como leitura_falhou", () => {
    expect(CONTA).toMatch(/if \(!leitura\.ok\) return undefined;/);
    expect(CONTA).toMatch(/resultado: "leitura_falhou", etapa: "posicoes"/);
  });
});
