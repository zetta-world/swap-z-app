/**
 * RM-09 / RM-09b (audit remediation) — os fatos oficiais chegam ao ZION, e vêm do produto.
 *
 * Três camadas, todas determinísticas (nenhuma chamada a modelo):
 *   1. CADA FATO É A CONSTANTE: o bloco é conferido contra `CHAINS`, `TIER_FEE_BPS`, `BANCADA_COTAS`,
 *      `TIER_DAILY_ANALYSES`, `CONFIG_APROVADA`, `BENEFICIOS`, `precoPublicoUsd` — não contra texto copiado.
 *   2. MONTAGEM DO CONTEXTO: o modo `ask` recebe o bloco; os outros modos não mudam.
 *   3. O GABARITO DE QUALIDADE É ATENDÍVEL A PARTIR DO CONTEXTO: todo fato obrigatório de cada caso de
 *      `regressao-qualidade.ts` está no que o modelo lê, e nenhuma afirmação proibida está.
 * O que isto NÃO prova: que o modelo real USA os fatos. Isso é o arnês ao vivo — NOT EXERCISED.
 */
import { describe, it, expect } from "vitest";
import { fatosDaPlataforma, blocoDeFatos, blocosDoSistema } from "@/lib/zion/fatos-da-plataforma";
import { casosDeQualidade } from "@/lib/zion/regressao-qualidade";
import { ZION_FOUNDATION } from "@/lib/zion/foundation";
import { getModeInstructions, type ZionOp } from "@/lib/zion/mode-prompts";
import { CHAINS } from "@/lib/chains";
import { TIER_FEE_BPS } from "@/lib/tier/fees";
import { BANCADA_COTAS, TIER_DAILY_ANALYSES, ALL_TIERS } from "@/lib/tier/types";
import { PLAN_TIERS, precoPublicoUsd, FOUNDERS_PRICE_STATUS } from "@/lib/pricing/plans";
import { CONFIG_APROVADA } from "@/lib/founders-sale/config";
import { OFERTA_PADRAO_PILOT, POLITICA_STATUS_FOUNDER, POLITICA_SUPORTE_PRIORITARIO, premiumAtivo, janelaPremium } from "@/lib/founders-sale/beneficios";
import { orcamentoDiarioDeUnidades } from "@/lib/bancada/cotas";

const BLOCO = blocoDeFatos();
const contexto = (op: ZionOp) => blocosDoSistema(op, ZION_FOUNDATION, getModeInstructions(op), "Answer in Portuguese.").join("\n\n");

describe("RM-09 · 1. cada fato do bloco É a constante do produto", () => {
  it("redes: toda rede ativa aparece como disponível; toda 'coming soon' aparece como NÃO disponível", () => {
    for (const c of CHAINS.filter((x) => !x.comingSoon)) expect(BLOCO).toContain(`${c.name} (${c.short})`);
    const emBreve = BLOCO.split("\n").find((l) => l.startsWith("COMING SOON"))!;
    for (const c of CHAINS.filter((x) => x.comingSoon)) expect(emBreve).toContain(c.name);
    const agora = BLOCO.split("\n").find((l) => l.startsWith("NETWORKS AVAILABLE NOW"))!;
    for (const c of CHAINS.filter((x) => x.comingSoon)) expect(agora).not.toContain(c.name);
    // a lista do mandato
    for (const n of ["Solana", "Ethereum", "Polygon", "Arbitrum", "Optimism", "BNB Chain", "Base", "Avalanche"]) expect(agora).toContain(n);
    expect(emBreve).toContain("ZETTA Chain");
  });

  it("taxas: EVM pelo TIER_FEE_BPS de cada plano; Solana sem taxa (decisão registrada)", () => {
    const linha = BLOCO.split("\n").find((l) => l.startsWith("PLATFORM SWAP FEE"))!;
    for (const [t, bps] of Object.entries(TIER_FEE_BPS)) expect(linha).toMatch(new RegExp(`${t}\\s${(bps / 100).toString().replace(".", "\\.")}%`, "i"));
    expect(BLOCO).toMatch(/Solana: NO platform fee/);
    expect(fatosDaPlataforma().taxas.solanaCobra).toBe(false);
  });

  it("planos: análises/dia, backtests/24h, ativos, histórico, mesas e orçamento são os de tier/types e cotas", () => {
    const f = fatosDaPlataforma();
    for (const t of ALL_TIERS) {
      const p = f.planos.find((x) => x.tier === t)!;
      expect(p.analisesZionPorDia).toBe(TIER_DAILY_ANALYSES[t]);
      expect(p.backtestsPor24h).toBe(BANCADA_COTAS[t].backtestsPorDia);
      expect(p.historicoMaxDias).toBe(BANCADA_COTAS[t].janelaMaxDias);
      expect(p.mesasDePapel).toBe(BANCADA_COTAS[t].mesasDePapel);
      expect(p.orcamentoDiarioUnidades).toBe(orcamentoDiarioDeUnidades(t));
    }
    expect(BLOCO).toMatch(/Pilot: 30 ZION analyses\/day · 5,000 backtests\/24h/);
    expect(BLOCO).toMatch(/Pilot 54,750,000/);
    expect(BLOCO).toMatch(/PILOT STANDARD OFFER: up to 5,000 standard own-strategy backtests per rolling 24-hour window/);
    expect(BLOCO).toMatch(/up to 3 assets × 365 days × 4h candles/);
    expect(BLOCO).toMatch(/Desk mode is NOT covered by this same 5,000 definition/);
    expect(OFERTA_PADRAO_PILOT).toMatchObject({ backtestsPorJanela: 5000, janelaHoras: 24, ativosMax: 3, historicoDiasMax: 365, candle: "4h", budgetFraction: "1/16", modoMesaIncluidoNaMesmaDefinicao: false });
    // ⚠️ os DOIS limites da bancada, ditos — nunca "ilimitado" nem "até X" sem condição
    expect(BLOCO).toMatch(/WORKBENCH LIMITS ARE TWO, BOTH REAL/);
    expect(BLOCO).not.toMatch(/unlimited|ilimitad/i);
  });

  it("⚠️ Founders: preço PROVISÓRIO não é citado (a vitrine também não cita) — e com preço FINAL seria", () => {
    expect(FOUNDERS_PRICE_STATUS).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    for (const p of PLAN_TIERS) expect(precoPublicoUsd(p)).toBeNull();
    expect(BLOCO).toMatch(/Price: NOT FINAL — still being defined\. Do NOT quote any price number/);
    for (const p of PLAN_TIERS) expect(BLOCO).not.toContain(`$${p.usdTarget.toLocaleString("en-US")}`);
    // mesmo bloco com preço final: os números aparecem
    const f = fatosDaPlataforma();
    const final = blocoDeFatos({ ...f, founders: { ...f.founders, precosPublicosUsd: { pro: 149, trader: 399, pilot: 1990 } } });
    expect(final).toMatch(/Price: Pro \$149 · Trader \$399 · Pilot \$1,990/);
  });

  it("Founders: 36 meses do ENCERRAMENTO OFICIAL; premium segue o holder; transferir não reinicia — provado nas funções", () => {
    expect(CONFIG_APROVADA.premium).toEqual({ meses: 36, inicio: "ENCERRAMENTO_OFICIAL_DA_VENDA" });
    expect(BLOCO).toMatch(/36 months, counted from the OFFICIAL END OF THE SALE/);
    // segue o holder: quem detém tem, quem vendeu não tem — no mesmo instante
    const enc = Date.UTC(2027, 0, 1), agora = Date.UTC(2027, 5, 1);
    expect(premiumAtivo(CONFIG_APROVADA, enc, agora, true)).toBe(true);
    expect(premiumAtivo(CONFIG_APROVADA, enc, agora, false)).toBe(false);
    // a janela só depende do encerramento (a assinatura nem recebe o holder) → transferir não a reinicia
    const j = janelaPremium(CONFIG_APROVADA, enc);
    expect(j).toEqual({ estado: "DEFINIDA", inicio: enc, fim: Date.UTC(2030, 0, 1) });
    expect(janelaPremium.length).toBe(2);
    expect(BLOCO).toMatch(/follow the CURRENT holder; transferring does NOT restart or extend/);
    expect(fatosDaPlataforma().founders.politicaStatusFounder).toEqual(POLITICA_STATUS_FOUNDER);
    expect(BLOCO).toMatch(/durable property of the pass/);
    expect(BLOCO).toMatch(/Premium ends after exactly 36 months; the status does NOT guarantee future products or future ecosystem benefits/);
  });

  it("Founders: venda usa allowlist 48h, limites cumulativos 2\/2\/1, Pilot público e 14 dias totais", () => {
    const venda = fatosDaPlataforma().founders.venda;
    expect(venda).toEqual({
      allowlistHoras: 48,
      limiteAllowlist: { pro: 1, trader: 1, pilot: 1 },
      limiteTotalEvento: { pro: 2, trader: 2, pilot: 1 },
      pilotNaVendaPublica: true,
      duracaoMaximaDias: 14,
      naoVendido: "UNMINTED",
    });
    expect(BLOCO).toMatch(/allowlist lasts 48 hours and gives priority, not extra supply/);
    expect(BLOCO).toMatch(/Purchases in the allowlist count toward those totals/);
    expect(BLOCO).toMatch(/Unsold Pilot remains available in the public sale/);
    expect(BLOCO).toMatch(/real sold-out or 14 days/);
  });

  it("Founders: disponível × desabilitado × a confirmar × roadmap × excluído", () => {
    const f = fatosDaPlataforma().founders;
    expect(f.disponiveis.pro).toContain("zion_advisory");
    expect(f.disponiveis.pro).not.toContain("priority_support");
    expect(f.disponiveis.trader).toContain("priority_support");
    expect(f.disponiveis.pro).not.toContain("cex_autopilot");
    expect(f.implementadosDesabilitados.pro).toContain("cex_autopilot");
    expect(f.aConfirmar.trader).toContain("arb_scanner");
    expect(f.disponiveis.trader).not.toContain("arb_scanner");
    expect(f.roadmap).toContain("beta_access");
    expect(f.roadmap).toContain("pilot_advanced_automation");
    expect(f.excluidos).toEqual(expect.arrayContaining(["royalty_distribution_to_holders", "future_token_allocation"]));
    expect(f.suportePrioritario).toEqual(POLITICA_SUPORTE_PRIORITARIO);
    expect(f.suportePrioritario).toMatchObject({ comecaNoTier: "TRADER", slaRigido: false, humano24x7: false, concierge: false, obrigacaoPessoalDoCeo: false });
    expect(BLOCO).toMatch(/Implemented but DISABLED \(never present as available\).*cex_autopilot/);
    expect(BLOCO).toMatch(/TO BE CONFIRMED \(not a launch promise\).*arb_scanner/);
    expect(BLOCO).toMatch(/Priority support starts at Trader: an asynchronous priority queue/);
    expect(BLOCO).toMatch(/Pilot advanced automation is only planned, subject to safety gates and certification/);
    expect(BLOCO).toMatch(/Roadmap \(planned, NO date — never present as available\)/);
    expect(BLOCO).toMatch(/NOT distributed to holders/);
    expect(BLOCO).toMatch(/Sale date: not announced yet/);
  });

  it("não confunde autorização DEX/on-chain com autorização CEX", () => {
    expect(BLOCO).toMatch(/AUTHORIZATION MODELS ARE DIFFERENT/);
    expect(BLOCO).toMatch(/DEX\/on-chain actions require the user's wallet signature/);
    expect(BLOCO).toMatch(/CEX automation uses a separate, explicitly authorized exchange-credential model/);
    expect(BLOCO).toMatch(/CEX autopilot is currently disabled/);
  });
});

describe("RM-09 · 2. montagem do contexto", () => {
  it("o modo ask recebe fundação → FATOS → modo → idioma; os outros modos ficam como eram", () => {
    const ask = blocosDoSistema("ask", "F", "M", "L");
    expect(ask).toEqual(["F", BLOCO, "M", "L"]);
    for (const op of ["trading", "arbitrage", "sniper", "pair", "futures", "accumulation", "research", "autopilot_cex"] as ZionOp[]) {
      expect(blocosDoSistema(op, "F", "M", "L")).toEqual(["F", "M", "L"]);
    }
  });

  it("o bloco é determinístico (prefixo estável = cacheável) e tem tamanho conhecido", () => {
    expect(blocoDeFatos()).toBe(blocoDeFatos());
    expect(BLOCO).not.toMatch(/\d{4}-\d{2}-\d{2}T/);   // nenhum relógio dentro
    // ~4 caracteres por token: o custo extra por pergunta livre é declarado no relatório
    console.log(`[RM-09] bloco de fatos: ${BLOCO.length} caracteres ≈ ${Math.round(BLOCO.length / 4)} tokens`);
    expect(BLOCO.length).toBeLessThan(6000);
  });
});

describe("RM-09 · 3. o gabarito de qualidade é atendível A PARTIR do contexto do ask", () => {
  const ctx = contexto("ask").toLowerCase();
  for (const caso of casosDeQualidade()) {
    it(`${caso.id}: todo fato obrigatório está no contexto; nenhuma afirmação proibida está`, () => {
      for (const alternativas of caso.obrigatorios) {
        expect(alternativas.some((a) => ctx.includes(a.toLowerCase())), `${caso.id}: falta ${JSON.stringify(alternativas)}`).toBe(true);
      }
      for (const re of caso.proibidos) expect(re.test(contexto("ask")), `${caso.id}: o contexto afirma ${re}`).toBe(false);
    });
  }

  it("⚠️ sem os fatos (o ask de antes), o gabarito NÃO era atendível — a prova de que o bloco é o que faltava", () => {
    const antes = [ZION_FOUNDATION, getModeInstructions("ask")].join("\n\n").toLowerCase();
    const faltavam = casosDeQualidade().filter((c) => c.obrigatorios.some((alts) => !alts.some((a) => antes.includes(a.toLowerCase()))));
    console.log(`[RM-09] casos NÃO atendíveis sem o bloco: ${faltavam.map((c) => c.id).join(", ")}`);
    expect(faltavam.map((c) => c.id)).toEqual(expect.arrayContaining(["zetta", "solana", "taxas", "founders", "workbench"]));
  });
});
