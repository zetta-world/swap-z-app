import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AGENTES, FAIXAS, ROTULO_DA_FAIXA, oControle, agentesDaFaixa } from "@/lib/celeiro/agentes";
import {
  extratoDe, ranquear, curvaAcumulada, contraOPiso, usdtProduzido,
  retornoSobreCapital,
  type Fluxo, type Causa,
} from "@/lib/celeiro/fluxo";

export const dynamic = "force-dynamic";

/**
 * O PAINEL DO CELEIRO — uma tabela POR FAIXA, nunca uma lista com tudo dentro.
 *
 * ⚠️⚠️ POR QUE SEPARADO POR FAIXA E NÃO UM RANKING SÓ. O portão de profundidade
 * mostra que o MESMO livro aprova 100 USD com 0% de derrapagem e reprova 800
 * com 7,45%. Logo o mesmo agente rende diferente em tamanhos diferentes, e uma
 * tabela única compararia coisas distintas — que é a versão em USDT do erro de
 * comparar day trade com swing na mesma régua.
 *
 * ⚠️ E O CONTROLE APARECE EM TODA FAIXA. Um agente que rende menos que o
 * Aluguel de Ocioso está destruindo valor: bastaria deixar o USDT parado
 * rendendo. Sem a linha do piso na MESMA tela, curva bonita e inútil passa por
 * vitória — foi assim que "+7,04% com amostra pequena" virou notícia boa.
 */

interface LinhaFluxo {
  agente: string;
  causa: Causa;
  usdt: string | number;
  ocorreu_em: string;
  braco: "controle" | "mutacao" | null;
  genoma_versao: number | null;
}

export async function GET() {
  /**
   * ⚠️ `requireAdmin()` NÃO DEVOLVE RESPOSTA DE ERRO — ele lança `notFound()`
   * quando nega, e devolve `{ wallet }` quando aprova.
   *
   * A primeira versão daqui fazia `const negado = await requireAdmin(); if
   * (negado) return negado;` — e como `{ wallet }` é truthy, a rota SEMPRE
   * devolveria `{"wallet":"0x…"}` no lugar dos dados. O painel nunca mostraria
   * nada, e o motivo não apareceria em log nenhum.
   *
   * Quem pegou foi o tipo gerado do Next em `.next/types`, que só existe depois
   * de um build — `tsc --noEmit` sozinho passa batido. É o mesmo padrão que o
   * torneio usa desde sempre: chamar e ignorar o retorno.
   */
  await requireAdmin();

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ erro: "sem banco" }, { status: 503 });

  // leitura-limitada: 20 mil lançamentos cobrem meses do arranque do Celeiro.
  // Passando disso, a agregação sai daqui e vira consulta no banco.
  const { data, error } = await db
    .from("celeiro_fluxos")
    .select("agente, causa, usdt, ocorreu_em, braco, genoma_versao")
    .order("ocorreu_em", { ascending: false })
    .limit(20_000);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const fluxos: Fluxo[] = (data ?? []).map((r: LinhaFluxo) => ({
    agente: r.agente,
    causa: r.causa,
    usdt: Number(r.usdt) || 0,
    ocorreuEmMs: Date.parse(r.ocorreu_em),
    braco: r.braco,
    genomaVersao: r.genoma_versao,
  }));

  const controle = oControle();

  /**
   * ⚠️ AGENTE SEM NENHUM LANÇAMENTO APARECE MESMO ASSIM, com `semDado: true`.
   * Escondê-lo faria um agente quebrado — que nunca escreveu fluxo — sumir da
   * tela em silêncio, e "não apareceu" é indistinguível de "não existe". É a
   * mesma razão de o extrato dizer "sem dado" em vez de devolver zero.
   */
  const fluxosDe = (a: string) => fluxos.filter((f) => f.agente === a);
  const usdtPiso = usdtProduzido(fluxosDe(controle.id));

  /**
   * ⚠️⚠️ O RETORNO DO PISO É A RÉGUA HONESTA. Comparar USDT absoluto premiava
   * quem arrisca mais: o Aluguel rende sobre $1.000 e um alavancado pode ter
   * $1.500 de exposição efetiva. Sobre capital, a pergunta fica justa — para
   * cada dólar administrado, quanto sobrou?
   */
  const retornoDoPisoPct = retornoSobreCapital(usdtPiso, controle.bancaUsd, null).pct;

  const faixas = FAIXAS.map((faixa) => {
    const doGrupo = agentesDaFaixa(faixa).map((a) => a.id);
    // O piso entra em toda faixa, mesmo não pertencendo a ela.
    const comControle = doGrupo.includes(controle.id) ? doGrupo : [...doGrupo, controle.id];
    const ranking = ranquear(fluxos, comControle, controle.id);

    /**
     * ⚠️ O DESTAQUE É POR FAIXA, e só existe se houver com quem comparar. Um
     * selo de "melhor" numa faixa com um agente só premiaria a ausência de
     * concorrência — e o piso, que é convidado, nunca pode levá-lo.
     */
    const concorrentes = ranking.filter(
      (r) => !r.ehControle && fluxosDe(r.agente).length > 0,
    );
    const destaque = concorrentes.length >= 2 && concorrentes[0].usdt > 0
      ? concorrentes[0].agente : null;

    return {
      faixa,
      rotulo: ROTULO_DA_FAIXA[faixa],
      linhas: ranking.map((r) => {
        const a = AGENTES.find((x) => x.id === r.agente)!;
        const meus = fluxosDe(r.agente);
        const e = extratoDe(r.agente, fluxos);
        return {
          ...r,
          nome: a.nome,
          modalidade: a.modalidade,
          ritmo: a.ritmo,
          motor: a.motor,
          capitalMinimoUsd: a.capitalMinimoUsd,
          mecanismo: a.mecanismo,
          naoFaz: a.naoFaz,
          /** De onde veio e por onde vazou — a resposta que o placar antigo não dava. */
          porCausa: e.porCausa,
          vazamentos: e.vazamentos,
          fontes: e.fontes,
          lancamentos: meus.length,
          semDado: meus.length === 0,
          /** O agente só pertence a esta faixa; o controle é convidado. */
          convidado: !doGrupo.includes(r.agente),
          /** A linha do minigráfico: USDT acumulado ao longo do tempo. */
          serie: curvaAcumulada(meus),
          /** Como comparar com o piso sem produzir número que estoura a tela. */
          piso: contraOPiso(r.usdt, usdtPiso, r.ehControle),
          /** A régua honesta: % da própria banca, e a diferença em pp. */
          retorno: retornoSobreCapital(r.usdt, a.bancaUsd, r.ehControle ? null : retornoDoPisoPct),
          bancaUsd: a.bancaUsd,
          alavancagemMaxima: a.alavancagemMaxima,
          tetoDeExposicao: a.tetoDeExposicao,
          categoria: a.categoria,
          destaque: r.agente === destaque,
        };
      }),
    };
  });

  /**
   * ⚠️ O RESUMO SOMA CADA AGENTE UMA VEZ SÓ. As faixas repetem o piso como
   * convidado — somar as linhas das três tabelas contaria o Aluguel de Ocioso
   * três vezes e inflaria o total do Celeiro sem que nada tivesse rendido.
   */
  const instantes = fluxos.map((f) => f.ocorreuEmMs).filter(Number.isFinite);
  const resumo = {
    usdtTotal: usdtProduzido(fluxos),
    lancamentos: fluxos.length,
    agentesComDado: new Set(fluxos.map((f) => f.agente)).size,
    deMs: instantes.length ? Math.min(...instantes) : null,
    ateMs: instantes.length ? Math.max(...instantes) : null,
    /**
     * ⚠️ "ATIVO" É MEDIDO, NÃO DECLARADO: houve lançamento na última hora?
     * Um selo fixo de "ativo e transmitindo" continuaria verde com o cron morto,
     * que é a morte muda que este projeto já pagou três vezes.
     */
    ativo: instantes.length > 0 && (Date.now() - Math.max(...instantes)) < 3_600_000,
    ultimoMs: instantes.length ? Math.max(...instantes) : null,
  };

  return NextResponse.json({
    arena: "celeiro",
    controle: controle.id,
    /**
     * ⚠️ O ESTADO DE ARRANQUE É DITO, NÃO DEDUZIDO. Um painel todo zerado é
     * ambíguo: pode ser "ninguém rendeu nada" ou "nada foi lançado ainda". A
     * primeira é um resultado; a segunda é ausência de medição, e confundi-las
     * é o começo de toda leitura errada.
     */
    semNenhumLancamento: fluxos.length === 0,
    totalDeLancamentos: fluxos.length,
    resumo,
    faixas,
  });
}
