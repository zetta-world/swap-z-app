import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { startRun, finishRun, failRun } from "@/lib/lab/store";
import { BY_SLUG } from "@/lib/lab/registry";
import { fetchLiFiQuote, LIFI_CHAIN_IDS, type LfQuote } from "@/lib/api/lifi";
import { fetchOrderbook } from "@/lib/api/cex-orderbook";
import type { CexSpotSource } from "@/lib/api/cex-spot";
import { findToken } from "@/lib/tokens";
import { median } from "@/lib/zion/stats";
import {
  precoCex, precoDex, sentidos, melhorSentido, vereditoDexCex,
  TAXA_CEX_PCT, PARES_EXCLUIDOS, type LinhaDexCex,
} from "@/lib/lab/dex-cex";
import type { ChainId } from "@/lib/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * DEX ↔ CEX — Fase 6.
 *
 * Ver a nota grande em `src/lib/lab/dex-cex.ts`. O resumo: a régua é a MESMA
 * que reprovou a arbitragem CEX↔CEX (`vwapBuy`/`vwapSell`, o andador de livro
 * das 4.085 medições), e os dois lados são medidos para o MESMO notional.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não altera mesa.
 *
 * ⚠️ TETO, NÃO CAPTURA. MEV compete no mesmo bloco e chega antes por
 * construção. Isto mede se a borda EXISTE, não quem fica com ela.
 */

/** Endereço de leitura — cotação não assina nada. Ver a nota no route do 🏦. */
const ENDERECO_LEITURA = "0x000000000000000000000000000000000000dEaD";

/** Notional das duas pontas. Grande o bastante para o gás não dominar. */
const NOTIONAL_USD = Number(process.env.DEXCEX_NOTIONAL_USD ?? 5000);

/**
 * Os pares, DECLARADOS.
 *
 * ⚠️ A lista é curta porque `tokens.ts` é curto — ele é o registro da interface,
 * não um universo de mercado. Isso é limite de dado e vai dito na tela, em vez
 * de virar "medimos o que dava".
 *
 * WBTC e MATIC/POL ficam de fora com motivo escrito em `PARES_EXCLUIDOS`.
 */
const PARES_DECLARADOS: Array<{ symbol: string; cadeia: ChainId; venue: CexSpotSource }> = [
  { symbol: "ETH", cadeia: "ethereum", venue: "binance" },
  { symbol: "ETH", cadeia: "arbitrum", venue: "binance" },
  { symbol: "ETH", cadeia: "optimism", venue: "binance" },
  { symbol: "LINK", cadeia: "ethereum", venue: "binance" },
  { symbol: "ARB", cadeia: "arbitrum", venue: "binance" },
  { symbol: "OP", cadeia: "optimism", venue: "binance" },
  { symbol: "BNB", cadeia: "bsc", venue: "binance" },
];
const PARES = PARES_DECLARADOS.filter(
  (p) => !(PARES_EXCLUIDOS as readonly string[]).includes(p.symbol),
);

/** Gás da cotação, em dólar. Ver `gasDaCotacao` no 🏦 — mesma leitura. */
function gasUsd(q: LfQuote): number {
  let usd = 0;
  for (const c of q.estimate?.gasCosts ?? []) {
    const v = parseFloat(c.amountUSD ?? "");
    if (Number.isFinite(v)) usd += v;
  }
  return usd;
}

function saida(q: LfQuote): number {
  const amt = parseFloat(q.estimate?.toAmount ?? "");
  const dec = q.action?.toToken?.decimals;
  if (!Number.isFinite(amt) || typeof dec !== "number") return 0;
  return amt / 10 ** dec;
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();
  const deadline = t0 + (maxDuration - 12) * 1000;
  const db = getSupabaseAdmin();

  const capital = BY_SLUG.get("dex_cex_arb")?.capitalRequiredUsd ?? 5000;
  let runId: string | null = null;
  if (db) {
    try {
      runId = await startRun(db, {
        slug: "dex_cex_arb", capitalUsd: capital, windowDays: 0,
        params: {
          notionalUsd: NOTIONAL_USD, taxaCexPct: TAXA_CEX_PCT,
          pares: PARES.map((p) => `${p.symbol}@${p.cadeia}`),
          excluidos: PARES_EXCLUIDOS,
        },
      });
    } catch { /* o laboratório é registro, não pré-requisito da medição */ }
  }

  const linhas: LinhaDexCex[] = [];
  const falhas: string[] = [];

  /**
   * ⚠️ PARES EM PARALELO, cotações do MESMO par em série.
   *
   * São 7 pares × (2 cotações + 1 livro) = 21 chamadas. Sequencial estouraria
   * os 60s e devolveria resultado parcial — o defeito que a Fase 3 pegou. Mas
   * as duas cotações do mesmo par são em série de propósito: a segunda usa a
   * QUANTIDADE que a primeira devolveu, e é essa dependência que faz a ida e
   * volta ser real em vez de espelhada.
   */
  await Promise.all(PARES.map(async ({ symbol, cadeia, venue }) => {
    if (Date.now() > deadline) { falhas.push(`${symbol}@${cadeia}: tempo`); return; }
    const usdc = findToken(cadeia, "USDC");
    const token = findToken(cadeia, symbol);
    const chainId = LIFI_CHAIN_IDS[cadeia];
    if (!usdc || !token || chainId == null) {
      falhas.push(`${symbol}@${cadeia}: sem token ou cadeia na LI.FI`);
      return;
    }

    try {
      const entrada = BigInt(Math.round(NOTIONAL_USD)) * 10n ** BigInt(usdc.decimals);
      const compra = await fetchLiFiQuote({
        fromChainId: chainId, toChainId: chainId,
        fromToken: usdc.address, toToken: token.address,
        fromAmount: entrada.toString(),
        fromAddress: ENDERECO_LEITURA, slippageBps: 50,
      }, process.env.LIFI_API_KEY);

      const tokens = saida(compra);
      if (!(tokens > 0)) { falhas.push(`${symbol}@${cadeia}: cotação de compra vazia`); return; }

      // A volta usa a QUANTIDADE recebida — é isso que torna a ida e volta real.
      const devolve = BigInt(Math.floor(tokens * 10 ** token.decimals));
      const venda = await fetchLiFiQuote({
        fromChainId: chainId, toChainId: chainId,
        fromToken: token.address, toToken: usdc.address,
        fromAmount: devolve.toString(),
        fromAddress: ENDERECO_LEITURA, slippageBps: 50,
      }, process.env.LIFI_API_KEY);

      const usdVolta = saida(venda);
      if (!(usdVolta > 0)) { falhas.push(`${symbol}@${cadeia}: cotação de venda vazia`); return; }

      const dex = precoDex(NOTIONAL_USD, tokens, usdVolta, gasUsd(compra), gasUsd(venda));
      if (!dex) { falhas.push(`${symbol}@${cadeia}: preço de DEX inválido`); return; }

      const livro = await fetchOrderbook(venue, symbol);
      if (!livro?.asks.length || !livro.bids.length) {
        falhas.push(`${symbol}@${venue}: sem livro`);
        return;
      }
      const cex = precoCex(livro.asks, livro.bids, NOTIONAL_USD);
      if (!cex) { falhas.push(`${symbol}@${venue}: livro não formou preço`); return; }

      const ss = sentidos(dex, cex);
      const melhor = melhorSentido(ss);
      const outro = ss.find((x) => x.rota !== melhor.rota)!;
      linhas.push({
        symbol, cadeia, venueCex: venue, notionalUsd: NOTIONAL_USD,
        melhorRota: melhor.rota, brutaPct: melhor.brutaPct, liquidaPct: melhor.liquidaPct,
        outraRotaPct: outro.liquidaPct,
        precoDexCompra: dex.compraMedio, precoDexVenda: dex.vendaMedio,
        precoCexCompra: cex.compraMedio, precoCexVenda: cex.vendaMedio,
        livroCompleto: cex.completo,
      });
    } catch (e) {
      falhas.push(`${symbol}@${cadeia}: ${String(e).slice(0, 50)}`);
    }
  }));

  linhas.sort((a, b) => b.liquidaPct - a.liquidaPct);
  const veredito = vereditoDexCex(linhas);
  const usaveis = linhas.filter((l) => l.livroCompleto);
  const medianaLiquida = usaveis.length ? median(usaveis.map((l) => l.liquidaPct)) : null;

  const naoMedido = [
    "⚠️ MEV — quem vê a mesma diferença no bloco monta um pacote e entra antes. "
      + "Tudo aqui é TETO da borda que EXISTE, não do que seria capturado",
    "transação que REVERTE custa gás e não entrega nada — slippage, bloco cheio "
      + "ou MEV derrubam a perna on-chain, e cotação não mede isso",
    "a janela de bloco é a vantagem E o risco: a perna de CEX é instantânea, a de "
      + "DEX espera um bloco, e é nessa espera que o preço se move contra",
    "dois bolsos — estoque nos dois lados, sem transferir. Ponte não entra porque "
      + "não entra na operação",
    "⚠️ a lista de pares é curta porque `tokens.ts` é o registro da INTERFACE, não "
      + "um universo de mercado. É limite de dado, não recorte de conveniência",
  ];

  if (db && runId) {
    try {
      await finishRun(db, runId, {
        netPct: medianaLiquida,
        grossPct: usaveis.length ? median(usaveis.map((l) => l.brutaPct)) : null,
        costPct: TAXA_CEX_PCT,
        // ⚠️ A amostra são os pares com livro COMPLETO — parcial mente a favor.
        sampleN: usaveis.length,
        verdict: veredito.status,
        verdictText: veredito.verdict,
        perSymbol: linhas.map((l) => ({
          s: l.symbol, cadeia: l.cadeia, venue: l.venueCex,
          rota: l.melhorRota,
          bruta: Math.round(l.brutaPct * 1000) / 1000,
          liquida: Math.round(l.liquidaPct * 1000) / 1000,
          outra: Math.round(l.outraRotaPct * 1000) / 1000,
          completo: l.livroCompleto,
        })),
        notMeasured: naoMedido,
      }, Date.now() - t0);
    } catch (e) {
      try {
        await failRun(db, runId, "falha ao gravar a medição", String(e).slice(0, 200), Date.now() - t0);
      } catch { /* idem */ }
    }
  }

  await recordEvent("dex_cex_study", { meta: {
    pares: linhas.length, comLivroCompleto: usaveis.length,
    medianaLiquida, status: veredito.status, notionalUsd: NOTIONAL_USD,
    falhas: falhas.join(" · ") || null, tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    veredito,
    resumo: {
      pares: linhas.length,
      comLivroCompleto: usaveis.length,
      notionalUsd: NOTIONAL_USD,
      taxaCexPct: TAXA_CEX_PCT,
      medianaLiquidaPct: medianaLiquida,
      positivos: usaveis.filter((l) => l.liquidaPct > 0).length,
      excluidos: [...PARES_EXCLUIDOS],
    },
    linhas,
    falhas: falhas.length ? falhas : null,
    naoMedido,
    aviso: "Leitura pura. Os dois lados são medidos para o MESMO notional, com a régua "
      + "que reprovou a arbitragem CEX↔CEX. É TETO da borda, não captura.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
