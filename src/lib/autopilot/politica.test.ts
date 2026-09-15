/**
 * ⚠️⚠️ O MOTOR DE POLÍTICA ÚNICO E O CERTIFICADO — achados A110, A111, A113.
 *
 * Cenários H e I do briefing.
 *
 * O que estes testes perguntam:
 *
 *   · o navegador e o worker recebem o MESMO veredito para a mesma entrada?
 *   · certificado revogado impede intent autônomo NOVO?
 *   · revogado impede também a SAÍDA? (tem de NÃO impedir)
 *   · regime não medido abre ou fecha a porta?
 *   · tier rebaixado no meio da sessão fecha entrada e deixa sair?
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  avaliarDecisaoDeEstrategia, VERSAO_DA_POLITICA, type ContextoDaDecisao,
} from "@/lib/autopilot/politica";
import { avaliarCertificado, type CertificadoRow } from "@/lib/autopilot/certificado";
import {
  decidirPelaAutorizacao, precisaRevalidar,
  VALIDADE_DO_CARIMBO_MS, PRAZO_DURO_DO_CARIMBO_MS,
} from "@/lib/autopilot/tier-da-sessao";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const CERT: CertificadoRow = {
  id: "cert-1", strategy_id: "sniper", strategy_version: 3, strategy_hash: "h-abc",
  certificate_version: 1, evidence: { oos: { win: 0.7, n: 1870 } }, sample_size: 1870,
  cost_assumptions: { taker_bps: 10 },
  risk_limits: { maxTradeUsd: 500 },
  allowed_venues: ["binance"], allowed_symbols: ["BTC/USDT"],
  valid_from: new Date(Date.now() - 86_400_000).toISOString(),
  valid_until: null, revoked_at: null, revoked_reason: null,
};

const BASE: ContextoDaDecisao = {
  canal: "worker", side: "buy", symbol: "BTC/USDT", base: "BTC",
  regime: "TRENDING_UP", notionalUsd: 100, maxTradeUsd: 1000,
  allowedSymbols: ["BTC/USDT"], autonomous: true, certificado: CERT,
  venue: "binance", strategyHash: "h-abc",
};

describe("① A113 — os dois canais recebem o MESMO veredito", () => {
  it("⚠️⚠️ a mesma entrada, no browser e no worker, decide igual", () => {
    const noWorker = avaliarDecisaoDeEstrategia({ ...BASE, canal: "worker" });
    const noBrowser = avaliarDecisaoDeEstrategia({ ...BASE, canal: "browser" });
    expect(noBrowser).toEqual(noWorker);
  });

  it("⚠️⚠️ e uma entrada CONTRA a tendência é recusada nos dois", () => {
    // Este era o defeito inteiro: o portão existia só no cron.
    for (const canal of ["worker", "browser"] as const) {
      const d = avaliarDecisaoDeEstrategia({ ...BASE, canal, regime: "TRENDING_DOWN" });
      expect(d.permite, canal).toBe(false);
      if (!d.permite) expect(d.motivo).toBe("contra_a_tendencia");
    }
  });

  it("⚠️ os DOIS arquivos chamam o motor — trava de ligação", () => {
    const CRON = semComentarios(
      readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));
    const ROTA = semComentarios(
      readFileSync("src/app/api/cex/order/route.ts", "utf8"));
    expect(CRON).toMatch(/avaliarDecisaoDeEstrategia\(\{/);
    expect(ROTA).toMatch(/avaliarDecisaoDeEstrategia\(\{/);
    // ⚠️ E o portão antigo não sobrou solto em lugar nenhum dos dois.
    expect(CRON).not.toMatch(/trendGate\(/);
    expect(ROTA).not.toMatch(/trendGate\(/);
  });

  it("a versão da política viaja no veredito", () => {
    const d = avaliarDecisaoDeEstrategia(BASE);
    expect(d.versao).toBe(VERSAO_DA_POLITICA);
  });
});

describe("② regime não medido ≠ sem tendência", () => {
  it("⚠️⚠️ regime null FECHA a entrada — falha fechada", () => {
    const d = avaliarDecisaoDeEstrategia({ ...BASE, regime: null });
    expect(d.permite).toBe(false);
    if (!d.permite) expect(d.motivo).toBe("regime_nao_medido");
  });

  it("⚠️ mas NUNCA fecha a saída — sair não depende de medir tendência", () => {
    // Travar uma venda por falta de dado prenderia o usuário na posição:
    // o pior desfecho possível de um portão de segurança.
    const d = avaliarDecisaoDeEstrategia({ ...BASE, side: "sell", regime: null });
    expect(d.permite).toBe(true);
  });
});

describe("③ Cenário H — certificado revogado", () => {
  it("⚠️⚠️ revogado: ZERO entrada autônoma nova", () => {
    const d = avaliarDecisaoDeEstrategia({ ...BASE,
      certificado: { ...CERT, revoked_at: new Date().toISOString(),
                     revoked_reason: "expectancy virou negativa" } });
    expect(d.permite).toBe(false);
    if (!d.permite) expect(d.motivo).toBe("certificado");
  });

  it("⚠️⚠️ mas a SAÍDA continua passando — revogar não pode prender capital", () => {
    // Certificado porteia tomar risco. Exigi-lo para vender seria exigir
    // licença para REDUZIR exposição.
    const d = avaliarDecisaoDeEstrategia({ ...BASE, side: "sell",
      certificado: { ...CERT, revoked_at: new Date().toISOString(),
                     revoked_reason: "revogado" } });
    expect(d.permite).toBe(true);
  });

  it("⚠️ sem certificado nenhum: ZERO entrada autônoma", () => {
    const d = avaliarDecisaoDeEstrategia({ ...BASE, certificado: null });
    expect(d.permite).toBe(false);
  });

  it("⚠️ falha de LEITURA do certificado conta como ausência — e ausência é recusa", () => {
    const d = avaliarDecisaoDeEstrategia({ ...BASE, certificado: undefined });
    expect(d.permite).toBe(false);
  });

  it("⚠️ o gêmeo positivo: certificado vivo e coerente DEIXA passar", () => {
    // Sem isto, uma função que recusasse sempre passaria em todo o bloco.
    expect(avaliarDecisaoDeEstrategia(BASE).permite).toBe(true);
  });
});

describe("④ o certificado é sobre a VERSÃO, e o envelope é dela", () => {
  it("⚠️⚠️ parâmetros mudaram: hash não confere, recusa", () => {
    const v = avaliarCertificado(CERT,
      { venue: "binance", symbol: "BTC/USDT", notionalUsd: 10, strategyHash: "h-OUTRO" });
    expect(v.vale).toBe(false);
    if (!v.vale) expect(v.motivo).toBe("hash_nao_confere");
  });

  it("venue fora da lista, símbolo fora da lista", () => {
    expect(avaliarCertificado(CERT,
      { venue: "kraken", symbol: "BTC/USDT", notionalUsd: 10 }).vale).toBe(false);
    expect(avaliarCertificado(CERT,
      { venue: "binance", symbol: "ETH/USDT", notionalUsd: 10 }).vale).toBe(false);
  });

  it("⚠️⚠️ nocional DESCONHECIDO não cabe em teto nenhum", () => {
    // `null` é "não medimos", e não medimos nunca vira "cabe".
    const v = avaliarCertificado(CERT,
      { venue: "binance", symbol: "BTC/USDT", notionalUsd: null });
    expect(v.vale).toBe(false);
    if (!v.vale) expect(v.motivo).toBe("acima_do_teto_do_certificado");
  });

  it("⚠️ vale o MENOR dos dois tetos — sessão e certificado", () => {
    // A sessão diz quanto o usuário aceita arriscar; o certificado diz dentro
    // de que envelope a evidência foi colhida.
    const d = avaliarDecisaoDeEstrategia({ ...BASE, maxTradeUsd: 1000, notionalUsd: 100 });
    expect(d.permite).toBe(true);
    if (d.permite) expect(d.tetoEfetivoUsd).toBe(500);   // o do certificado
  });

  it("⚠️ e quando a sessão é a mais apertada, ela ganha", () => {
    const d = avaliarDecisaoDeEstrategia({ ...BASE, maxTradeUsd: 200, notionalUsd: 100 });
    if (d.permite) expect(d.tetoEfetivoUsd).toBe(200);
  });

  it("janela de validade expirada recusa", () => {
    const v = avaliarCertificado(
      { ...CERT, valid_until: new Date(Date.now() - 1000).toISOString() },
      { venue: "binance", symbol: "BTC/USDT", notionalUsd: 10 });
    expect(v.vale).toBe(false);
  });
});

describe("⑤ Cenário I — tier rebaixado no meio da sessão (A111)", () => {
  const agora = 1_000_000_000_000;

  it("carimbo fresco não consulta nada", () => {
    expect(precisaRevalidar({ carimbadoEmMs: agora - 1000, agoraMs: agora })).toBe(false);
    const d = decidirPelaAutorizacao({ carimbo: "pro", carimbadoEmMs: agora - 1000, agoraMs: agora });
    expect(d.abreEntrada).toBe(true);
  });

  it("carimbo vencido pede revalidação", () => {
    expect(precisaRevalidar({
      carimbadoEmMs: agora - VALIDADE_DO_CARIMBO_MS - 1, agoraMs: agora })).toBe(true);
  });

  it("⚠️⚠️ revalidou e NÃO satisfaz: entradas fechadas", () => {
    const d = decidirPelaAutorizacao({
      carimbo: "pro", carimbadoEmMs: agora - VALIDADE_DO_CARIMBO_MS - 1, agoraMs: agora,
      revalidacao: { satisfaz: false, tier: "free" } });
    expect(d.abreEntrada).toBe(false);
    if (!d.abreEntrada) expect(d.motivo).toBe("rebaixado");
  });

  it("⚠️⚠️ revalidação NÃO respondeu: o carimbo antigo vale até o prazo duro", () => {
    // ⚠️ Uma instabilidade do provedor de assinatura não pode derrubar a
    // automação de todo mundo — o briefing nomeia isso.
    const d = decidirPelaAutorizacao({
      carimbo: "pro", carimbadoEmMs: agora - VALIDADE_DO_CARIMBO_MS - 1, agoraMs: agora,
      revalidacao: null });
    expect(d.abreEntrada).toBe(true);
  });

  it("⚠️⚠️ mas passado o PRAZO DURO, sem resposta, entradas fecham", () => {
    const d = decidirPelaAutorizacao({
      carimbo: "pro", carimbadoEmMs: agora - PRAZO_DURO_DO_CARIMBO_MS - 1, agoraMs: agora,
      revalidacao: null });
    expect(d.abreEntrada).toBe(false);
    if (!d.abreEntrada) expect(d.motivo).toBe("carimbo_vencido_sem_resposta");
  });

  it("sessão nunca carimbada não abre entrada até revalidar", () => {
    const d = decidirPelaAutorizacao({ carimbo: null, carimbadoEmMs: null, agoraMs: agora });
    expect(d.abreEntrada).toBe(false);
    if (!d.abreEntrada) expect(d.motivo).toBe("nunca_carimbado");
  });

  it("⚠️ NENHUM caminho deste módulo bloqueia SAÍDA", () => {
    // A política de tier decide sobre ABRIR. O tipo carrega isso no nome:
    // `abreEntrada`. Se alguém acrescentar um `bloqueiaSaida`, este teste
    // deixa de compilar — que é o objetivo.
    const FONTE = readFileSync("src/lib/autopilot/tier-da-sessao.ts", "utf8");
    expect(FONTE).not.toMatch(/bloqueiaSaida|impedeSaida|fechaSaida/);
    expect(FONTE).toMatch(/abreEntrada/);
  });
});
