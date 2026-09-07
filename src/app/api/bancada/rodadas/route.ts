/**
 * O HISTÓRICO DA BANCADA — as rodadas que este cliente já rodou.
 *
 * ⚠️⚠️ ELA EXISTE PORQUE A TELA ESQUECIA. `bancada_rodada`, `bancada_resultado`
 * e `bancada_operacao` guardavam tudo desde a fase 1, e NENHUMA rota as lia de
 * volta: cada corrida nova substituía a anterior num único estado do React, e
 * recarregar a página apagava a tarde inteira de testes. É o mesmo defeito que
 * `bancada_posicao` teve — a peça existe, é testada, e está desligada do caminho
 * que o cliente enxerga.
 *
 * ⚠️ DUAS FORMAS, e a divisão é de tamanho, não de gosto:
 *   · sem `id` — a LISTA, com o veredito de cada rodada. Leve o bastante para
 *     carregar junto com a tela.
 *   · com `id` — as OPERAÇÕES daquela rodada. Uma rodada de mesa sobre quatro
 *     pares passa de 300 linhas; mandar isso vezes trinta para montar uma lista
 *     seria pagar o extrato inteiro de todo mundo para mostrar um título.
 *
 * ⚠️ NÃO HÁ `dono` NO CORPO NEM NA QUERY, e nunca poderá haver: o `Dono` sai da
 * sessão assinada e o tipo marcado (`dono.ts`) impede que qualquer outra string
 * chegue ao store. Aceitar um id de rodada é seguro justamente por isso — o
 * filtro de dono vem ANTES do filtro de id, e a rodada alheia não volta.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { donoDaSessao } from "@/lib/bancada/dono";
import { denialResponse } from "@/lib/tier/enforce";
import { listarRodadas, resultadosDasRodadas, rodada, operacoesDaRodada } from "@/lib/bancada/store";
import { identidadeDaRodada, janelaEmDias } from "@/lib/bancada/identidade";
import { NAO_MEDIDO } from "@/lib/bancada/veredito";

/**
 * ⚠️ A PROSA DAS CHAVES, para SUBTRAIR — nunca para exibir.
 *
 * `nao_medido` guarda a soma de duas coisas: as ressalvas estruturais (que a
 * tela traduz a partir da chave) e os problemas daquela leitura ("BTC 1h:
 * chegaram 66% da janela"), que só existem como frase. Devolver a soma faria a
 * mesma ressalva aparecer duas vezes — uma no idioma do cliente e outra em
 * português.
 */
const PROSA_DAS_CHAVES = new Set<string>(Object.values(NAO_MEDIDO));

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ TRINTA, e o número tem motivo: é quanto cabe numa tela de histórico sem
 * paginação, e a cota diária mais generosa da §6.2 não chega perto disso num
 * dia. Quem estourar 30 está lendo o passado distante, não o trabalho de hoje.
 */
const QUANTAS = 30;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return denialResponse({ kind: "unauthenticated" });
  const v = donoDaSessao(session);
  if (!v) return denialResponse({ kind: "unauthenticated" });
  const db = getSupabaseAdmin();
  if (!db) return json({ ok: false, error: "sem_banco" }, 503);

  const id = req.nextUrl.searchParams.get("id");

  // ── UMA rodada: o extrato dela ──────────────────────────────────────
  if (id) {
    const r = await rodada(v.dono, db, id);
    // ⚠️ 404, NUNCA 403. A rodada de outra carteira e a rodada inexistente têm
    // de ser indistinguíveis daqui de fora — a mesma regra do `requireAdmin`.
    if (!r) return json({ ok: false, error: "nao_encontrada" }, 404);
    const operacoes = await operacoesDaRodada(v.dono, db, id);
    return json({ ok: true, id, operacoes });
  }

  // ── A LISTA ─────────────────────────────────────────────────────────
  // leitura-limitada: as últimas 30 rodadas do próprio cliente. O recorte é a
  // tela, não uma medição — nada aqui soma, credita ou decide.
  const rodadas = await listarRodadas(v.dono, db, QUANTAS);
  const resultados = await resultadosDasRodadas(v.dono, db, rodadas.map((r) => r.id));

  return json({
    ok: true,
    rodadas: rodadas.map((r) => {
      const res = resultados.get(r.id) ?? null;
      return {
        id: r.id,
        quando: r.criadaEm,
        status: r.status,
        porque: r.porque,
        identidade: identidadeDaRodada(r.origem, r.params),
        contexto: {
          simbolos: r.simbolos,
          intervalo: r.intervalo,
          janelaDias: janelaEmDias(r.janelaDe, r.janelaAte),
          praca: r.praca,
          papel: r.papel,
          capitalUsd: r.capitalUsd,
        },
        /**
         * ⚠️ A RODADA SEM RESULTADO DEVOLVE `null`, não um resultado zerado.
         * `recusada` pelo portão do pedágio, `falhou`, ou ainda `rodando` são
         * três coisas diferentes de "rodou e não rendeu nada" — e `status` +
         * `porque` já dizem qual delas foi.
         */
        resultado: res == null ? null : {
          veredito: res.veredito,
          n: res.n,
          acertos: res.acertos,
          brutoPct: res.brutoPct,
          taxaPct: res.taxaPct,
          liquidoPct: res.liquidoPct,
          equilibrioPct: res.equilibrioExigidoPct,
          competidorPct: res.competidorPct,
          naoMedidoChaves: res.naoMedidoChaves,
          /**
           * ⚠️ A PROSA VIAJA JUNTO porque ela carrega o que chave nenhuma
           * carrega: "BTC 1h: só chegaram 66% da janela". Perder isso deixaria
           * o histórico mais bonito e menos verdadeiro que a rodada ao vivo.
           */
          naoMedidoTexto: res.naoMedido.filter((x) => !PROSA_DAS_CHAVES.has(x)),
        },
      };
    }),
  });
}
