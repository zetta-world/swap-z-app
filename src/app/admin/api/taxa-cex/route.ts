import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { fetchTaxasGateio, compararCusto } from "@/lib/cex/taxa-gateio";
import { CUSTO_POR_PERNA_PCT } from "@/lib/zion/custo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A TAXA REAL DA CORRETORA — P0 do plano fechado com a Luna em 15/08.
 *
 * ⚠️ A PERGUNTA QUE ESTA ROTA RESPONDE, E POR QUE ELA É P0.
 *
 * Todo resultado direcional deste laboratório é líquido de um custo que **nós
 * escolhemos**: `BACKTEST_COST_PCT ?? 0.2`, constante, por perna. Quando um
 * veredito diz "o custo matou a borda", em boa parte das medições isso é uma
 * premissa da simulação, não uma observação.
 *
 * Três vereditos dependem disso e mudam se a premissa estiver errada:
 *
 *     Grade         reprovou com custo de 54,27%
 *     LP em AMM     aprovou por +0,82%
 *     DEX ↔ CEX     aprovou por +0,019%
 *
 * As duas últimas passaram por margens MENORES que a incerteza do próprio
 * custo.
 *
 * ⚠️ E ELA NÃO RESPONDE A NOSSA TAXA EFETIVA. Nível VIP e desconto por pontos
 * só aparecem numa consulta AUTENTICADA, e `autopilot_sessions` tem 0 linhas —
 * não há sessão de onde tirar chave. O que sai daqui é a taxa PUBLICADA do par,
 * que é o piso de quem não tem desconto nenhum. **A nossa é DESCONHECIDA.**
 *
 * ⚠️ LEITURA PURA: não abre posição, não escreve em `admin_kv`, não toca mesa.
 * O único efeito colateral é o evento — sem ele, esta medição seria um número
 * que só existe enquanto alguém está olhando a resposta HTTP (invariante nº 14).
 */

/**
 * ⚠️ A MESMA LISTA DECLARADA das outras medições, e não os pares que as mesas
 * mais operaram. Escolher os pares depois de ver quais deram certo é o viés que
 * o laboratório inteiro existe para evitar — aqui ele apareceria como "medir a
 * taxa só onde ela é baixa".
 */
const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];

/** O que o laboratório assume hoje, por perna. Lido do MESMO lugar que as
 *  medições leem — comparar contra um valor digitado aqui compararia com uma
 *  cópia, não com a premissa em uso. */
const MODELO_POR_PERNA_PCT = CUSTO_POR_PERNA_PCT;

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const { taxas, falha } = await fetchTaxasGateio(SIMBOLOS);
  const comparacao = compararCusto(taxas, MODELO_POR_PERNA_PCT);

  await recordEvent("lab_custo_cex", { meta: {
    corretora: "gateio",
    modelo_por_perna_pct: MODELO_POR_PERNA_PCT,
    taxa_publicada_pct: comparacao.taxaPublicadaPct,
    sobra_derrapagem_pct: comparacao.sobraParaDerrapagemPct,
    pares: comparacao.pares,
    falha: falha ?? null,
    ms: Date.now() - t0,
  } });

  return NextResponse.json({
    corretora: "gateio",
    ...comparacao,
    porPar: taxas,
    falha: falha ?? null,
    /**
     * ⚠️ O QUE ESTE NÚMERO NÃO COBRE — vai na resposta, não no comentário, para
     * que quem ler o JSON leia junto.
     */
    naoMedido: [
      "a NOSSA taxa efetiva: nível VIP e desconto por pontos só aparecem em "
        + "consulta autenticada, e não há sessão de autopilot ativa (0 linhas)",
      "maker versus taker: o campo público `fee` não separa os dois",
      "derrapagem: não é taxa, e continua sem medição em lugar nenhum",
      "o lado DEX é outro mundo de custo — lá o 0x cobra 0,15% medidos, e isso "
        + "calibra o SWAP (produto), não as mesas (laboratório)",
    ],
    fetchedAt: new Date().toISOString(),
  });
}
