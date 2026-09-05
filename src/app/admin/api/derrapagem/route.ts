import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import {
  fetchLivroGateio, impactoNoLivro, vereditoPorTamanho, leituraDaDerrapagem,
  TAMANHOS_USD, type ImpactoNoTamanho,
} from "@/lib/cex/derrapagem-gateio";
import { fetchTaxasGateio, medianaDeTaxas } from "@/lib/cex/taxa-gateio";
import { CUSTO_POR_PERNA_PCT } from "@/lib/zion/custo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A DERRAPAGEM — o último grande buraco do modelo de custo.
 *
 * ⚠️ A PERGUNTA. Todo resultado direcional do laboratório é líquido de 0,2% por
 * perna. Em 15/08 medimos a taxa publicada da Gate.io: **0,2% por ordem** — a
 * taxa consome o orçamento INTEIRO e sobra ZERO para impacto de preço.
 *
 * Isso já dizia que os resultados estão otimistas. O que faltava era a
 * QUANTIDADE: otimistas por quanto?
 *
 * ⚠️ A TAXA VEM DA MESMA CONSULTA que alimenta o painel de custo, no mesmo
 * instante — não de uma constante copiada. Duas cópias da mesma grandeza
 * divergem, e este projeto já pagou por isso (o `0,2` que significava duas
 * coisas em catorze arquivos).
 *
 * ⚠️ LEITURA PURA: não abre posição, não escreve em `admin_kv`, não toca mesa.
 * O único efeito é o evento — sem ele a medição só existiria enquanto alguém
 * olhasse a resposta HTTP (invariante nº 14).
 */

/**
 * ⚠️ A MESMA LISTA DECLARADA das outras medições, e não os pares que as mesas
 * mais operaram. Escolher os pares depois de ver quais deram certo é o viés que
 * o laboratório inteiro existe para evitar — aqui apareceria como "medir
 * derrapagem só onde o livro é fundo".
 */
const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "LINK", "ARB", "OP", "ADA", "DOGE"];

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  // Livros e taxa em paralelo: são a mesma corretora e o mesmo instante.
  const [livros, taxas] = await Promise.all([
    Promise.all(SIMBOLOS.map((s) => fetchLivroGateio(s))),
    fetchTaxasGateio(SIMBOLOS),
  ]);

  const falhas = livros.map((l) => l.falha).filter((f): f is string => !!f);
  const ok = livros.map((l) => l.livro).filter((l): l is NonNullable<typeof l> => l !== null);

  /**
   * ⚠️ SEM TAXA MEDIDA, O VEREDITO NÃO É INVENTADO. Cair para uma constante
   * aqui produziria um "cabe/não cabe" que parece medição e é palpite. `null`
   * força a tela a dizer que não sabe.
   */
  const taxaPorPernaPct = medianaDeTaxas(taxas.taxas.map((t) => t.taxaPct));

  const porTamanho = TAMANHOS_USD.map((usd) => {
    const impactos: ImpactoNoTamanho[] = ok.map((l) => impactoNoLivro(l, usd));
    /**
     * ⚠️⚠️ O `?? 0` SAIU DAQUI (01/09), e ele fazia o oposto do comentário três
     * linhas acima. Com a taxa não medida, `0` produzia `sobra = 0,4` e
     * `cabe: true` — o painel aprovava $50 numa rodada em que a taxa nunca foi
     * lida. Agora o `null` viaja, `sobraPct` vira `null`, e `cabe` já falha
     * fechado sozinho.
     */
    const v = vereditoPorTamanho(usd, impactos, taxaPorPernaPct, CUSTO_POR_PERNA_PCT);
    return {
      ...v,
      medido: taxaPorPernaPct !== null,
      leitura: taxaPorPernaPct === null
        ? `${usd < 1000 ? `$${usd}` : `$${usd / 1000}k`}: impacto medido, mas a taxa não respondeu — `
          + "sem ela não dá para dizer se cabe no orçamento."
        : leituraDaDerrapagem(v),
      // O detalhe por par, para quando o número agregado não bastar.
      porPar: ok.map((l, i) => ({
        simbolo: l.simbolo,
        idaEVoltaPct: impactos[i].idaEVoltaPct,
        livroAcabou: impactos[i].livroAcabou,
      })),
    };
  });

  /** O tamanho que as mesas operam HOJE — é este que decide o veredito de topo. */
  const hoje = porTamanho.find((p) => p.usd === 50) ?? porTamanho[0];

  await recordEvent("lab_derrapagem", { meta: {
    corretora: "gateio",
    taxa_por_perna_pct: taxaPorPernaPct,
    orcamento_por_perna_pct: CUSTO_POR_PERNA_PCT,
    pares: ok.length,
    falhas: falhas.length,
    impacto_50usd_pct: hoje?.idaEVoltaPct ?? null,
    sobra_50usd_pct: hoje?.sobraPct ?? null,
    cabe_em_50usd: hoje?.cabe ?? false,
    ms: Date.now() - t0,
  } });

  return NextResponse.json({
    corretora: "gateio",
    taxaPorPernaPct,
    orcamentoPorPernaPct: CUSTO_POR_PERNA_PCT,
    pares: ok.length,
    falhas,
    porTamanho,
    /**
     * ⚠️ AS RESSALVAS VIAJAM NA RESPOSTA, não no comentário. Uma medição de
     * derrapagem lida sem elas vira "a derrapagem está resolvida", e ela não
     * está — isto é o PISO, medido num livro calmo.
     */
    naoMedido: [
      "derrapagem de TEMPO: isto anda o livro de agora. Entre decidir e preencher "
        + "o preço anda, e esse pedaço só aparece comparando `quoted_price` com "
        + "`executed_price` em ordem real — instrumentação que ainda não existe",
      "maker versus taker: andar o livro é execução a MERCADO. Ordem limitada que "
        + "descansa no livro tem derrapagem diferente, às vezes negativa",
      "o livro no instante do preenchimento: um retrato não é um filme, e em "
        + "notícia o livro afina em segundos",
      "o lado DEX: lá o custo é outro mundo (impacto de pool, gás, MEV) e nada "
        + "disto se aplica",
    ],
    fetchedAt: new Date().toISOString(),
  });
}
