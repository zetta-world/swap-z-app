import { describe, it, expect } from "vitest";
import { resolveOne, STATUS_SEM_PRECO, CARENCIA_SEM_PRECO_MS } from "@/lib/zion/backtest";
import type { ZionSuggestionRow } from "@/lib/supabase/types";

/**
 * ⚠️⚠️ O DEFEITO QUE ESTES TESTES SEGURAM (29/08).
 *
 * `resolveOne` começava o caminho sem velas assim:
 *
 *     if (spot == null || spot <= 0) return null;
 *     ...
 *     if (nowMs >= horizonMs) return { status: "expired", ... };
 *
 * A guarda do preço vinha ANTES da do horizonte. Uma linha sem vela e sem
 * cotação voltava `null` em toda passada, para sempre, com o prazo vencido
 * havia semanas.
 *
 * Não era hipótese. Quatro `launch_shot` on-chain ficaram `open` por 200 a 608
 * HORAS com horizonte de 12h: VEK (eth), XSGD (avax), USDC (eth) e HEGIC
 * (arbitrum). Nenhuma tem par na Binance, e o pool delas parou de devolver vela
 * no GeckoTerminal — os dois caminhos de preço secavam e a função saía pela
 * primeira linha.
 *
 * ⚠️ E O CONSERTO NÃO PODE SER INVENTAR PREÇO. Sem cotação não dá para dizer se
 * bateu alvo, stop ou nada. `unresolvable` com `outcome_pct` NULO é a única
 * coisa verdadeira que se pode escrever — e é por isso que os testes abaixo
 * checam o nulo com tanta insistência.
 */

const base: ZionSuggestionRow = {
  id: "x", symbol: "VEK", side: "buy", kind: "launch_shot", status: "open",
  ref_price: 0.0181115, target_price: 0.0213716, stop_price: 0.0164815,
  horizon_hours: 12, created_at: "2026-08-04T02:30:15.557Z",
} as unknown as ZionSuggestionRow;

const CRIADA = Date.parse(base.created_at);
const HORIZONTE = CRIADA + 12 * 3_600_000;

describe("⚠️ a linha sem vela E sem preço não fica presa para sempre", () => {
  it("o caso real: VEK, 608h aberta, horizonte de 12h", () => {
    const agora = CRIADA + 608 * 3_600_000;
    const v = resolveOne(base, [], undefined, agora);
    expect(v).not.toBeNull();
    expect(v?.status).toBe(STATUS_SEM_PRECO);
  });

  it("⚠️⚠️ e o desfecho é NULO, nunca 0 — 0% seria uma afirmação", () => {
    const v = resolveOne(base, [], undefined, CRIADA + 608 * 3_600_000);
    expect(v?.outcomePct).toBeNull();
    expect(v?.price).toBeNull();
  });

  it("spot igual a 0 ou negativo conta como SEM preço, não como preço zero", () => {
    const agora = CRIADA + 608 * 3_600_000;
    for (const ruim of [0, -1, Number.NaN]) {
      const v = resolveOne(base, [], ruim, agora);
      expect(v?.status, String(ruim)).toBe(STATUS_SEM_PRECO);
      expect(v?.outcomePct, String(ruim)).toBeNull();
    }
  });
});

describe("a carência protege quem só teve uma queda de provedor", () => {
  it("logo depois do horizonte ainda NÃO condena — espera o dia inteiro", () => {
    expect(resolveOne(base, [], undefined, HORIZONTE + 60_000)).toBeNull();
    expect(resolveOne(base, [], undefined, HORIZONTE + CARENCIA_SEM_PRECO_MS - 60_000)).toBeNull();
  });

  it("passada a carência, vira terminal", () => {
    const v = resolveOne(base, [], undefined, HORIZONTE + CARENCIA_SEM_PRECO_MS + 60_000);
    expect(v?.status).toBe(STATUS_SEM_PRECO);
  });

  it("antes do horizonte, sem preço, continua em voo", () => {
    expect(resolveOne(base, [], undefined, CRIADA + 3_600_000)).toBeNull();
  });
});

describe("⚠️ o caminho COM preço não mudou de comportamento", () => {
  it("alvo tocado continua alvo", () => {
    const v = resolveOne(base, [], 0.022, CRIADA + 3_600_000);
    expect(v?.status).toBe("hit_target");
    expect(v?.outcomePct).toBeGreaterThan(0);
  });

  it("stop tocado continua stop, e tem precedência sobre o horizonte", () => {
    const v = resolveOne(base, [], 0.016, HORIZONTE + 3_600_000);
    expect(v?.status).toBe("hit_stop");
    expect(v?.outcomePct).toBeLessThan(0);
  });

  it("horizonte vencido COM preço no meio continua `expired` — com número", () => {
    const v = resolveOne(base, [], 0.019, HORIZONTE + 60_000);
    expect(v?.status).toBe("expired");
    expect(typeof v?.outcomePct).toBe("number");
    expect(v?.price).toBe(0.019);
  });

  it("em voo, com preço no meio da faixa, segue nulo", () => {
    expect(resolveOne(base, [], 0.019, CRIADA + 3_600_000)).toBeNull();
  });

  it("uma venda tem os lados invertidos", () => {
    const venda = { ...base, side: "sell", target_price: 0.016, stop_price: 0.020 } as ZionSuggestionRow;
    expect(resolveOne(venda, [], 0.0155, CRIADA + 60_000)?.status).toBe("hit_target");
    expect(resolveOne(venda, [], 0.0205, CRIADA + 60_000)?.status).toBe("hit_stop");
  });
});

describe("⚠️ preço de hoje não precifica horizonte que fechou há semanas", () => {
  /**
   * O segundo defeito, que só apareceria DEPOIS de consertar o primeiro: o
   * GeckoTerminal devolve as 300 velas mais recentes, então para uma linha de
   * 608h com horizonte de 12h todas caem fora do replay e o chamador passa o
   * último close do pool como `spot`. Resolver com ele trocaria quatro linhas
   * travadas por quatro números inventados.
   */
  it("com spot atual mas muito além da carência, é insolúvel — não `expired`", () => {
    const agora = CRIADA + 608 * 3_600_000;
    const v = resolveOne(base, [], 0.019, agora);
    expect(v?.status).toBe(STATUS_SEM_PRECO);
    expect(v?.outcomePct).toBeNull();
  });

  it("nem inventa um alvo que o preço de hoje por acaso satisfaz", () => {
    const agora = CRIADA + 608 * 3_600_000;
    // 0,022 está acima do alvo — mas HOJE, não dentro das 12h do horizonte.
    const v = resolveOne(base, [], 0.022, agora);
    expect(v?.status).toBe(STATUS_SEM_PRECO);
  });

  it("dentro da carência o preço corrente ainda vale", () => {
    const v = resolveOne(base, [], 0.022, HORIZONTE + 3_600_000);
    expect(v?.status).toBe("hit_target");
  });
});

describe("com velas, o replay manda — e ele não passa pela carência", () => {
  const velas = (closes: number[]) =>
    closes.map((c, i) => ({ t: CRIADA + i * 3_600_000, high: c, low: c, close: c }));

  it("toque no alvo dentro da janela resolve na hora", () => {
    const v = resolveOne(base, velas([0.0185, 0.0215]), undefined, CRIADA + 2 * 3_600_000);
    expect(v?.status).toBe("hit_target");
  });

  it("horizonte vencido sem toque vira `expired` COM número", () => {
    const v = resolveOne(base, velas([0.0185, 0.0190]), undefined, HORIZONTE + 60_000);
    expect(v?.status).toBe("expired");
    expect(typeof v?.outcomePct).toBe("number");
  });
});
