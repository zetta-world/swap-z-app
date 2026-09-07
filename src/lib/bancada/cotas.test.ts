/**
 * ⚠️ A COTA É O FREIO DE CUSTO DO PRODUTO. Cada teste aqui é dinheiro: um
 * limite que falha ABERTO entrega a plataforma, e um que falha FECHADO por
 * engano manda embora quem estava pagando.
 */
import { describe, it, expect } from "vitest";
import { decidir, custoDoPedido, tetoDeVelasPorRodada, type PedidoDeRodada } from "@/lib/bancada/cotas";
import { BANCADA_COTAS, TIER_DAILY_ANALYSES, FEATURE_TIER, ALL_TIERS } from "@/lib/tier/types";

const DIA = 86_400_000;
const FIM = Date.parse("2026-09-05T00:00:00Z");

function pedido(p: Partial<PedidoDeRodada> = {}): PedidoDeRodada {
  return {
    simbolos: ["BTC"], intervalo: "1d",
    janelaDe: FIM - 90 * DIA, janelaAte: FIM, capitalUsd: 500,
    ...p,
  };
}
const zerado = { rodadas: 0, velas: 0 };

describe("⚠️ o buraco que o plano deixou: 'símbolos × dias' não limita trabalho", () => {
  it("um ano em velas de 1 minuto é 1.400× um ano em velas diárias", () => {
    const janela = { janelaDe: FIM - 365 * DIA, janelaAte: FIM };
    const diario = custoDoPedido(pedido({ ...janela, intervalo: "1d" }))!;
    const minuto = custoDoPedido(pedido({ ...janela, intervalo: "1m" }))!;
    expect(diario).toBe(365);
    expect(minuto / diario).toBeGreaterThan(1_000);
  });

  it("⚠️ e por isso o teto de TRABALHO recusa o 1m sobre um ano", () => {
    // Os dois pedidos cabem em "3 símbolos × 365 dias" do plano free. Só um
    // deles é uma rajada contra o limite por IP da fonte.
    const janela = { janelaDe: FIM - 365 * DIA, janelaAte: FIM };
    expect(decidir("free", pedido({ ...janela, intervalo: "1d" }), zerado).ok).toBe(true);

    const d = decidir("free", pedido({ ...janela, intervalo: "1m" }), zerado);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.motivo).toBe("trabalho_demais");
      // ⚠️ A recusa ensina a saída: intervalo maior, mesma leitura, sai na hora.
      expect(d.porque).toMatch(/1h, 4h, 1d/);
    }
  });

  it("o uso normal passa folgado — o teto barra a patologia, não o produto", () => {
    const teto = tetoDeVelasPorRodada(BANCADA_COTAS.free);
    // 3 símbolos, 1 ano, velas de 1 hora: o pior caso razoável.
    const c = custoDoPedido(pedido({
      simbolos: ["BTC", "ETH", "SOL"], intervalo: "1h",
      janelaDe: FIM - 365 * DIA, janelaAte: FIM,
    }))!;
    expect(c).toBeLessThanOrEqual(teto);
  });
});

describe("os tetos do plano, cada um com o seu motivo", () => {
  it("cota esgotada conta a JANELA MÓVEL, e a mensagem diz isso", () => {
    const d = decidir("free", pedido(), { rodadas: 10, velas: 900 });
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.motivo).toBe("cota_esgotada");
      expect(d.porque).toMatch(/24 horas/);
      expect(d.porque).toMatch(/reabre aos poucos/);
    }
    // Uma a menos e passa — a fronteira é onde ela diz que é.
    expect(decidir("free", pedido(), { rodadas: 9, velas: 900 }).ok).toBe(true);
  });

  it("capital, símbolos e janela recusam cada um com o SEU motivo", () => {
    const capital = decidir("free", pedido({ capitalUsd: 5_000 }), zerado);
    expect(capital.ok).toBe(false);
    if (!capital.ok) expect(capital.motivo).toBe("capital_acima_do_teto");

    const simbolos = decidir("free", pedido({ simbolos: ["BTC", "ETH", "SOL", "AVAX"] }), zerado);
    expect(simbolos.ok).toBe(false);
    if (!simbolos.ok) expect(simbolos.motivo).toBe("simbolos_demais");

    const janela = decidir("free", pedido({ janelaDe: FIM - 700 * DIA }), zerado);
    expect(janela.ok).toBe(false);
    if (!janela.ok) expect(janela.motivo).toBe("janela_longa_demais");
  });

  it("o mesmo pedido que o free recusa, o pro aceita", () => {
    const p = pedido({ capitalUsd: 5_000, simbolos: ["BTC", "ETH", "SOL", "AVAX"] });
    expect(decidir("free", p, zerado).ok).toBe(false);
    expect(decidir("pro", p, zerado).ok).toBe(true);
  });

  it("pedido incoerente é recusado antes de qualquer conta de plano", () => {
    expect(decidir("pilot", pedido({ simbolos: [] }), zerado).ok).toBe(false);
    expect(decidir("pilot", pedido({ capitalUsd: 0 }), zerado).ok).toBe(false);
    expect(decidir("pilot", pedido({ intervalo: "3d" }), zerado).ok).toBe(false);
    expect(decidir("pilot", pedido({ janelaDe: FIM }), zerado).ok).toBe(false);
  });
});

describe("⚠️⚠️ falha de leitura NÃO é cota zerada — e nem é 'cota esgotada'", () => {
  it("recusa, mas dizendo a verdade sobre o motivo", () => {
    const d = decidir("free", pedido(), null);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      // ⚠️ Se isto virasse `cota_esgotada`, o cliente veria "acabou seu limite"
      // num dia em que ele não rodou nada — e reclamaria de um limite que não
      // era o problema.
      expect(d.motivo).toBe("consumo_desconhecido");
      expect(d.porque).toMatch(/não consegui ler/);
    }
  });

  it("e o `pilot` também é recusado — não há plano que compre um banco fora", () => {
    expect(decidir("pilot", pedido(), null).ok).toBe(false);
  });
});

describe("⚠️ a vitrine e a porta dizem a mesma coisa", () => {
  it("todo tier tem cota de bancada, e nenhuma é infinita", () => {
    for (const t of ALL_TIERS) {
      const c = BANCADA_COTAS[t];
      expect(Number.isFinite(c.backtestsPorDia), t).toBe(true);
      expect(Number.isFinite(c.capitalMaxUsd), t).toBe(true);
      // ⚠️ `Infinity` numa tela vira "Infinity" e em JSON vira `null`. Um teto
      // grande e escrito é auditável; o infinito não é.
      expect(c.backtestsPorDia).toBeGreaterThan(0);
    }
  });

  it("as cotas SOBEM com o plano, sem degrau invertido", () => {
    // Um plano mais caro que dá menos é o tipo de erro que ninguém revisa e
    // todo cliente encontra.
    const ordem = ALL_TIERS.map((t) => BANCADA_COTAS[t]);
    for (let i = 1; i < ordem.length; i++) {
      expect(ordem[i].backtestsPorDia).toBeGreaterThanOrEqual(ordem[i - 1].backtestsPorDia);
      expect(ordem[i].capitalMaxUsd).toBeGreaterThanOrEqual(ordem[i - 1].capitalMaxUsd);
      expect(ordem[i].estrategiasSalvas).toBeGreaterThanOrEqual(ordem[i - 1].estrategiasSalvas);
      expect(ordem[i].mesasDePapel).toBeGreaterThanOrEqual(ordem[i - 1].mesasDePapel);
    }
  });

  it("⚠️ o portão da bancada é `free`, como o do ZION — quem separa é a COTA", () => {
    // A cicatriz literal: o card prometia 5/dia e o `FEATURE_TIER` exigia
    // `pro`, então o Free recebia 402 — zero, não cinco.
    expect(FEATURE_TIER.bancadaBacktest).toBe("free");
    expect(FEATURE_TIER.zionAdvisory).toBe("free");
    expect(BANCADA_COTAS.free.backtestsPorDia).toBeGreaterThan(0);
    expect(TIER_DAILY_ANALYSES.free).toBeGreaterThan(0);
  });

  it("⚠️ o papel adiante começa em `trader`, e o portão concorda com a cota", () => {
    // É o único custo que RECORRE: pô-lo no plano pago mais barato inverte a
    // margem. E as duas fontes têm de dizer o mesmo — senão é o Free/ZION.
    expect(FEATURE_TIER.bancadaPapelAdiante).toBe("trader");
    expect(BANCADA_COTAS.free.mesasDePapel).toBe(0);
    expect(BANCADA_COTAS.pro.mesasDePapel).toBe(0);
    expect(BANCADA_COTAS.trader.mesasDePapel).toBeGreaterThan(0);
  });
});

describe("⚠️⚠️ o modo mesa lê QUATRO prazos, e a cota tem de cobrar pelos quatro", () => {
  it("uma rodada de mesa custa muito mais que a mesma janela em 1d", () => {
    // O defeito medido em 06/09: a rodada gravada como `custo_velas: 365` leu
    // 3.566 velas (1h + 4h + 1d do mesmo símbolo). A cota subcontava ~10×.
    const janela = { janelaDe: FIM - 365 * DIA, janelaAte: FIM };
    const comoDiario = custoDoPedido(pedido({ ...janela, intervalo: "1d" }))!;
    const comoMesa = custoDoPedido(pedido({ ...janela, intervalo: "1d", mesa: true }))!;

    expect(comoDiario).toBe(365);
    // 8.760 (1h) + 2.190 (4h) + 365 (1d) ≈ 11.315
    expect(comoMesa).toBeGreaterThan(comoDiario * 8);
  });

  it("⚠️ a base do modo mesa é 1h, não o intervalo marcado na tela", () => {
    // O seletor caminha sobre 1h; cobrar pelo `1d` que o cliente marcou
    // cobraria pelo prazo errado — e o custo real não muda com essa marcação.
    const janela = { janelaDe: FIM - 30 * DIA, janelaAte: FIM };
    const comMarcacao1d = custoDoPedido(pedido({ ...janela, intervalo: "1d", mesa: true }))!;
    const comMarcacao1h = custoDoPedido(pedido({ ...janela, intervalo: "1h", mesa: true }))!;
    expect(comMarcacao1d).toBe(comMarcacao1h);
  });

  it("⚠️ a semanal NÃO custa leitura — ela é agregada das diárias", () => {
    const janela = { janelaDe: FIM - 70 * DIA, janelaAte: FIM };
    const c = custoDoPedido(pedido({ ...janela, mesa: true }))!;
    const h1 = 70 * 24, h4 = 70 * 6, d1 = 70;
    expect(c).toBe(h1 + h4 + d1);
  });

  it("o teto de trabalho continua valendo, e agora sobre o custo REAL da mesa", () => {
    // Uma janela de 365 dias em modo mesa estoura o teto do free (3 × 365 × 24).
    const d = decidir("free", pedido({
      janelaDe: FIM - 365 * DIA, janelaAte: FIM, mesa: true,
      simbolos: ["BTC", "ETH", "SOL"],
    }), zerado);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("trabalho_demais");
  });
});
