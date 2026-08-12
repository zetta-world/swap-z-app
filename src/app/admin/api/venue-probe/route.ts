import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { CEX_TRACKED_SYMBOLS } from "@/lib/api/cex-spot";
import { fetchObservedVenues, DECLINED_VENUES, OBSERVED_VENUES } from "@/lib/api/cex-spot-extra";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
/**
 * ⚠️ SÃO PAULO, NÃO VIRGÍNIA — e é conformidade, não desempenho (12/08).
 *
 * A Binance devolve 451 (bloqueio geográfico) para chamadas vindas de
 * infraestrutura nos EUA quando a conta é Binance Brasil. Esta rota fala com
 * a corretora, então ela sai do Brasil — que é como servir cliente brasileiro
 * a partir de infraestrutura brasileira, e não contornar restrição nenhuma.
 *
 * ⚠️ E É POR ROTA, NÃO NO `vercel.json`. Mover TODAS as funções para `gru1`
 * foi a proposta inicial e teria quebrado o painel: o Supabase está em
 * `us-east-1`, então cada consulta ao banco passaria a atravessar São Paulo ↔
 * Virgínia (~5ms viram ~120ms). A rota `/admin/api/lab` faz ~85 idas ao banco
 * e passaria de meio segundo para mais de dez. As 52 rotas administrativas que
 * só falam com o banco ficam em `iad1`, coladas nele.
 *
 * Esta aqui faz 1 a 2 consultas e já espera 300-800ms pela própria Binance —
 * o custo da distância é ruído dentro do tempo que a corretora leva.
 */
export const preferredRegion = "gru1";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * SONDA DE VENUE NOVA — o adaptador funciona, ou está devolvendo vazio calado?
 *
 * ⚠️ POR QUE ESTA ROTA EXISTE ANTES DE QUALQUER MEDIÇÃO (04/08).
 *
 * Os oito adaptadores novos foram escritos ÀS CEGAS: o proxy do sandbox bloqueia
 * as CEX, então nenhum formato de resposta foi exercitado daqui. Todos vieram de
 * documentação pública.
 *
 * Adaptador com o formato errado não estoura — ele devolve lista vazia. E lista
 * vazia, na tela, lê-se como "esta venue não tem oportunidade". É o defeito que
 * esta semana achou seis vezes, e desta vez eu sei de antemão que ele vai
 * acontecer em pelo menos um dos oito.
 *
 * Então a primeira coisa que se mede não é spread: é se o adaptador LÊ.
 *
 * Três estados, e a diferença entre eles é a informação toda:
 *
 *   ok=false                  → a venue não respondeu (HTTP ou rede). Problema
 *                               dela, ou bloqueio de jurisdição como o 451 da
 *                               binance-futuros.
 *   ok=true  · parsed=0       → ela respondeu e EU li errado. Problema meu.
 *   ok=true  · parsed>0       → o adaptador funciona; aí sim vale medir spread.
 *
 * Sem separar os dois primeiros, "a venue não serve" e "eu escrevi errado"
 * ficam idênticos — e a conclusão errada seria descartar uma corretora boa por
 * causa de um bug meu.
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, e estas venues
 * NÃO estão em `CexSpotSource` — nenhuma mesa as enxerga.
 */

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const simbolos = [...CEX_TRACKED_SYMBOLS];
  const resultados = await fetchObservedVenues(simbolos);

  const linhas = resultados.map((r) => ({
    venue: r.venue,
    ok: r.ok,
    status: r.status,
    simbolos: r.parsed,
    // Uma amostra de preços para conferência a olho: se o BTC da venue vier
    // 10× fora, o adaptador leu o campo errado (preço de outro par, ou uma
    // cotação em outra moeda) — e isso passa por qualquer teste de contagem.
    amostra: ["BTC", "ETH", "SOL"]
      .map((s) => ({ s, p: r.quotes.get(s) ?? null }))
      .filter((x) => x.p != null),
    diagnostico: !r.ok
      ? "a venue não respondeu — problema dela ou bloqueio de jurisdição"
      : r.parsed === 0
        ? "respondeu e o adaptador leu ZERO — formato errado, problema meu"
        : "adaptador funciona",
  }));

  const funcionando = linhas.filter((l) => l.ok && l.simbolos > 0);
  const adaptadorQuebrado = linhas.filter((l) => l.ok && l.simbolos === 0);
  const naoResponderam = linhas.filter((l) => !l.ok);

  const resumo = {
    tentadas: linhas.length,
    funcionando: funcionando.length,
    adaptadorQuebrado: adaptadorQuebrado.length,
    naoResponderam: naoResponderam.length,
    // Quantas venues a matriz de medição ganharia se todas subissem.
    simbolosNovos: funcionando.reduce((s, l) => s + l.simbolos, 0),
  };

  await recordEvent("venue_probe", { meta: {
    ...resumo,
    linhas: linhas.map((l) => ({ v: l.venue, ok: l.ok, st: l.status, n: l.simbolos })),
    tookMs: Date.now() - t0,
  } });

  return NextResponse.json({
    resumo, linhas,
    observadas: OBSERVED_VENUES,
    recusadas: DECLINED_VENUES,
    portao: [
      "dispersão ≤0.05% (a casa de binance/okx), não ≤0.6% (a da kucoin)",
      "em VÁRIAS leituras, em DIAS diferentes — a kucoin foi de 0.140% às 13h para 0.601% às 21h",
      "desvio SEM viés de direção — barata sempre, em muitas moedas, é atraso de feed",
      "e a que nenhum código responde: dá para SACAR de lá?",
    ],
    aviso: "Leitura pura. Estas venues NÃO estão em CexSpotSource — nenhuma mesa as enxerga. "
      + "Esta sonda mede se o ADAPTADOR lê, não se a venue tem spread.",
    tookMs: Date.now() - t0,
    ranAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
