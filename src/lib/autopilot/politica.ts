/**
 * ⚠️⚠️⚠️ O MOTOR DE POLÍTICA ÚNICO — achado A113.
 *
 * O navegador e o worker aplicavam REGRAS DIFERENTES à mesma estratégia, e a
 * diferença era medível no código:
 *
 *     autopilot/cron/route.ts:867   if (!trendGate("buy", regime)) { recusa }
 *     AutopilotPilot.tsx → /api/cex/order      nada equivalente
 *
 * O portão de tendência — construído sobre 1.870 decisões, com o dado de que
 * operar A FAVOR da tendência ganhou 70–92% em janelas de alta E de baixa —
 * barrava a entrada no canal do cron e deixava passar no canal do navegador. O
 * MESMO cartão, do MESMO modelo, com dois vereditos.
 *
 * ⚠️ E O DEFEITO É PIOR QUE A ASSIMETRIA. Quem lê "o autopilot só entra a favor
 * da tendência" acredita nisso para o produto inteiro. Uma trava que vale em
 * metade dos canais não é uma trava frouxa: é uma trava que mente.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ POR QUE A DECISÃO É VERSIONADA. `VERSAO_DA_POLITICA` viaja junto do
 * veredito e entra no registro do intent. Sem ela, "por que este trade passou
 * em agosto e não passa hoje?" não tem resposta — e a resposta é justamente o
 * que uma auditoria precisa reconstruir.
 *
 * ⚠️ A UI NÃO DECIDE. Ela EXIBE a decisão do servidor. Qualquer conferência no
 * cliente é conveniência de tela; a que vale roda aqui, chamada pelos dois
 * canais.
 */

import { trendGate } from "@/lib/zion/sniper";
import { avaliarCertificado, type CertificadoRow, type VereditoDoCertificado }
  from "@/lib/autopilot/certificado";

/**
 * ⚠️ SOBE QUANDO A REGRA MUDA, nunca quando o código é refatorado. Ela é o que
 * permite explicar, meses depois, por que um trade passou.
 */
export const VERSAO_DA_POLITICA = 1;

export type CanalDaDecisao = "browser" | "worker";

export interface ContextoDaDecisao {
  canal: CanalDaDecisao;
  side: "buy" | "sell";
  symbol: string;
  /** A moeda base, já normalizada — o regime é medido por ela. */
  base: string;
  /** ⚠️ `null` = NÃO MEDIDO. Nunca tratar como "sem tendência". */
  regime: string | null | undefined;
  /** ⚠️ `null` = nocional desconhecido. Não medimos ≠ cabe no teto. */
  notionalUsd: number | null;
  maxTradeUsd: number;
  /** Símbolos que a SESSÃO autoriza. `null` = a sessão não restringe. */
  allowedSymbols: string[] | null;
  /** Autônomo exige certificado; manual não (há um humano decidindo). */
  autonomous: boolean;
  certificado: CertificadoRow | null | undefined;
  venue: string;
  strategyHash?: string | null;
}

export type MotivoDaRecusa =
  | "simbolo_fora_da_sessao"
  | "regime_nao_medido"
  | "contra_a_tendencia"
  | "nocional_nao_medido"
  | "acima_do_teto_da_sessao"
  | "certificado";

export type DecisaoDeEstrategia =
  | { permite: true; versao: number; tetoEfetivoUsd: number; certificadoId: string | null }
  | { permite: false; versao: number; motivo: MotivoDaRecusa; porque: string;
      detalheDoCertificado?: VereditoDoCertificado };

/**
 * A ÚNICA função que decide se um intent de estratégia pode virar ordem.
 *
 * ⚠️ PURA DE PROPÓSITO. Os dois canais a chamam com o mesmo contrato, e ela não
 * fala com banco nem com rede — senão "os dois canais usam a mesma política"
 * viraria "os dois canais chamam a mesma função com dados diferentes".
 */
export function avaliarDecisaoDeEstrategia(ctx: ContextoDaDecisao): DecisaoDeEstrategia {
  const nao = (motivo: MotivoDaRecusa, porque: string,
               detalheDoCertificado?: VereditoDoCertificado): DecisaoDeEstrategia =>
    ({ permite: false, versao: VERSAO_DA_POLITICA, motivo, porque, detalheDoCertificado });

  // ── 1. o símbolo está na lista da sessão ──────────────────────────────
  if (ctx.allowedSymbols && ctx.allowedSymbols.length > 0
      && !ctx.allowedSymbols.includes(ctx.symbol)) {
    return nao("simbolo_fora_da_sessao",
      `${ctx.symbol} nao esta entre os simbolos autorizados na sessao`);
  }

  // ── 2. o portão de tendência — SÓ PARA ENTRADAS ───────────────────────
  /**
   * ⚠️⚠️ AQUI ESTAVA A ASSIMETRIA DO A113. Compras precisam de tendência
   * confirmada; SAÍDAS nunca são barradas — travar uma saída por falta de dado
   * de regime prenderia o usuário numa posição, que é o pior desfecho possível
   * de um portão de segurança.
   */
  if (ctx.side === "buy") {
    if (ctx.regime == null) {
      // ⚠️ Falha FECHADA: sem dado de regime não se entra. "Não medimos" não
      // pode virar "não há tendência contrária".
      return nao("regime_nao_medido",
        `regime de ${ctx.base} indisponivel — entrada exige tendencia confirmada`);
    }
    if (!trendGate("buy", ctx.regime)) {
      return nao("contra_a_tendencia",
        `regime ${ctx.regime} — entradas exigem TRENDING_UP`);
    }
  }

  // ── 3. o teto da sessão ───────────────────────────────────────────────
  if (ctx.notionalUsd == null || !Number.isFinite(ctx.notionalUsd)) {
    return nao("nocional_nao_medido",
      "nocional desconhecido — sem medida nao ha como conferir teto");
  }
  if (ctx.notionalUsd > ctx.maxTradeUsd) {
    return nao("acima_do_teto_da_sessao",
      `nocional ${ctx.notionalUsd} acima do teto da sessao ${ctx.maxTradeUsd}`);
  }

  // ── 4. o certificado — SÓ PARA ENTRADAS ───────────────────────────────
  /**
   * ⚠️⚠️ A SAÍDA NÃO PRECISA DE CERTIFICADO, e isto é escolha, não esquecimento.
   *
   * Certificado porteia tomar risco. Exigi-lo para VENDER seria exigir licença
   * para REDUZIR exposição: uma sessão com certificado expirado ou revogado
   * ficaria presa na posição, sem poder sair sozinha. Um mecanismo de segurança
   * que cria o perigo que existe para evitar não é conservador — é perigoso
   * com cara de rigor.
   *
   * O risco aceito em troca: uma estratégia revogada ainda emite ordens de
   * venda. É o comportamento desejado — queremos que ela saia.
   */
  let certificadoId: string | null = null;
  let tetoDoCertificado: number | null = null;
  if (ctx.autonomous && ctx.side === "buy") {
    const v = avaliarCertificado(ctx.certificado, {
      venue: ctx.venue, symbol: ctx.symbol,
      notionalUsd: ctx.notionalUsd, strategyHash: ctx.strategyHash,
    });
    if (!v.vale) {
      return nao("certificado", `certificado: ${v.porque}`, v);
    }
    certificadoId = v.certificadoId;
    const t = v.limites?.maxTradeUsd;
    if (t != null && Number.isFinite(t)) tetoDoCertificado = Number(t);
  }

  /**
   * ⚠️ VALE O MENOR DOS DOIS TETOS. A sessão diz quanto o usuário aceita
   * arriscar; o certificado diz dentro de que envelope a evidência foi colhida.
   * Escolher o maior usaria a evidência para um tamanho em que ela não foi
   * medida — e escolher o do certificado sozinho ignoraria o dono.
   */
  const tetoEfetivoUsd = tetoDoCertificado == null
    ? ctx.maxTradeUsd
    : Math.min(ctx.maxTradeUsd, tetoDoCertificado);

  return { permite: true, versao: VERSAO_DA_POLITICA, tetoEfetivoUsd, certificadoId };
}
