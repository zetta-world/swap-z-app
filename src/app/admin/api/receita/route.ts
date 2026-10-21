import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerTodasPorChave } from "@/lib/supabase/paginar";
import { TIER_FEE_BPS, receitaUsd, REGRA_TAXA_SOLANA } from "@/lib/tier/fees";
import { resumirVerificacao, separarPorAtribuicao, temIdentidadeAssinada, type ResumoVerificacao } from "@/lib/admin/atribuicao";
import type { Tier } from "@/lib/tier/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RECEITA DE TAXA — C21/C22, o painel da Fase 9.3.
 *
 * ⚠️ DUAS COISAS SEPARADAS, E A SEPARAÇÃO É O PONTO: o volume REAL (medido no
 * livro de operações) e a PROJEÇÃO por faixa. Misturar as duas produziria o
 * número que este laboratório passou nove fases evitando — uma projeção lida
 * como resultado.
 *
 * ⚠️ E O TRÁFEGO DE SONDA SAI DA CONTA. O banco de ataque grava operações com
 * `volume_usd = 0` de propósito; contá-las como volume de cliente inflaria a
 * amostra com o nosso próprio teste.
 *
 * ⚠️ MAS SONDA E VOLUME NÃO REGISTRADO SÃO COISAS DIFERENTES (11/08).
 *
 * O filtro era `Number(r.volume_usd ?? 0) > 0`, e ele tratava `NULL` como
 * zero. Só que TODA troca DEX entrava com `volume_usd = NULL` — o
 * `ExecuteSwap` nunca passava `valueUsd` ao histórico, então o valor em dólar
 * morria antes de chegar ao livro. Resultado: as trocas de cliente de verdade
 * eram contadas como "sonda do banco de ataque" e sumiam da conta.
 *
 * Três situações com a mesma cara: zero declarado (sonda), zero por falta de
 * registro (troca real sem volume) e volume de verdade. A do meio é a única
 * que pede alguma coisa — ela diz que o livro tem um buraco.
 */

/** Faixas declaradas. A primeira é a nossa realidade; as outras, cenários. */
const FAIXAS_MENSAIS = [10_000, 100_000, 1_000_000, 10_000_000] as const;
const PLANOS: Tier[] = ["free", "pro", "trader", "pilot"];

/**
 * As origens que TÊM mecanismo de cobrança. Hoje é uma só.
 *
 * ⚠️ Esta lista existe para a tela distinguir "não rendeu" de "não pode
 * render". `autopilot_cex` e `cex_spot` são ordens do usuário na corretora
 * dele, e não passam por `/api/quote` — não há onde reter nada. Somar o volume
 * deles ao denominador da receita produziria uma taxa efetiva falsamente baixa.
 */
const COBRAM: readonly string[] = ["dex_swap", "dex_bridge"];

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();

  let real = { operacoes: 0, volumeUsd: 0, desde: null as string | null, ate: null as string | null };
  let sonda = 0;
  /** Operações confirmadas cujo volume nunca foi gravado. Buraco no livro. */
  let semVolume = 0;
  /** O que de fato foi retido, somado das operações. Ver a nota em `comTaxa`. */
  let arrecadado = { usd: 0, operacoes: 0 };
  /**
   * ⚠️⚠️ RETENÇÃO DECLARADA POR CHAMADA SEM SESSÃO — achado A07.
   *
   * `/api/operations/record` aceita `status: "confirmed"` e `platformFeeUsd` de
   * quem não apresentou cookie assinado nenhum. A linha entra com
   * `wallet_address = NULL`, e este painel somava tudo que estava confirmado:
   * uma alegação anônima virava arrecadação na tela, sem nada que a
   * distinguisse de dinheiro medido.
   *
   * Não há a quem perguntar sobre esta linha. Ela sai do agregado e ganha nome
   * próprio — o mesmo tratamento que `sonda` e `semVolume` já recebiam.
   */
  let naoAtribuido = { usd: 0, operacoes: 0, linhas: 0, volumeUsd: 0 };
  let porOrigem: Array<{
    kind: string; operacoes: number; volumeUsd: number;
    arrecadadoUsd: number; comTaxa: number; cobravel: boolean;
    /** ⚠️ A parcela desta origem que veio sem sessão — ver `naoAtribuido`. */
    naoAtribuidoUsd: number;
  }> = [];
  let falha: string | null = null;
  let verificacao: ResumoVerificacao | null = null;

  if (db) {
    try {
      /**
       * ⚠️ PAGINADO (CE-14). Uma leitura só devolvia as primeiras 1.000
       * operações confirmadas (o `db-max-rows`), e a receita, o volume e a
       * quebra por origem desta tela passavam a ser os das 1.000 primeiras —
       * sem aviso. Ordem por `id` (única) para a paginação não pular linha.
       */
      /**
       * ⚠️ RM-12 (audit remediation): POR CHAVE, não por offset. "Arrecadado" é
       * apresentado como caixa medido, e offset sobre `id` (UUID) com o livro
       * recebendo operações durante a leitura podia contar uma linha duas vezes
       * ou pular outra. Ainda não é ledger-grade (não é retrato num instante) —
       * declarado na resposta (`natureza`).
       */
      const leitura = await lerTodasPorChave<{
        id: string; volume_usd: number | string | null; created_at: string; status: string; kind: string | null;
        platform_fee_usd: number | string | null; wallet_address: string | null;
        verificacao: string | null; verificacao_motivo: string | null; pagador_onchain: string | null;
        taxa_onchain_raw: number | string | null; taxa_onchain_mint: string | null;
      }>((depoisDe, limite) => {
        let q = db
          .from("operations")
          .select("id, volume_usd, created_at, status, kind, platform_fee_usd, wallet_address, verificacao, verificacao_motivo, pagador_onchain, taxa_onchain_raw, taxa_onchain_mint")
          .eq("status", "confirmed");
        if (depoisDe) q = q.gt("id", depoisDe);
        return q.order("id", { ascending: true }).limit(limite);
      }, "id");
      if (leitura.erro) throw new Error(leitura.erro);
      if (leitura.truncado) throw new Error("operações demais para somar nesta tela — use a agregação no banco");
      const linhas = leitura.linhas;
      /**
       * ⚠️ TRÊS BALDES, NÃO DOIS. `null` é ausência de medição e sai por uma
       * porta com nome; `0` declarado é sonda e sai por outra. Somar os dois
       * como "sonda" fazia troca de cliente virar tráfego de teste na tela.
       */
      const reais     = linhas.filter((r) => r.volume_usd != null && Number(r.volume_usd) > 0);
      semVolume       = linhas.filter((r) => r.volume_usd == null).length;
      sonda           = linhas.length - reais.length - semVolume;
      /**
       * ⚠️ ARRECADADO É SOMA DE PARCELA, NÃO PORCENTAGEM DE AGREGADO (Fase 11).
       *
       * O `receitaRealTetoUsd` abaixo é 1% do volume — a resposta de "quanto
       * TERIA rendido". Ela ficou por meses no lugar do resultado, e em 11/08
       * descobrimos que a cotação firme nunca mandava a taxa: de 13/06 a 11/08
       * às 10:42 toda troca cobrou ZERO, e a tela dizia $1,27.
       *
       * Isto aqui é o oposto: a soma do que cada operação declarou ter sido
       * retido. Sem parcela, o número é zero — e zero por ausência de dado
       * aparece em `arrecadadoOperacoes`, que é a amostra ao lado do agregado.
       */
      /**
       * ⚠️ ARRECADADO É SÓ O QUE TEM IDENTIDADE ASSINADA (A07). A linha anônima
       * não é descartada — ela é REAL no livro, e as quatro de hoje são trocas
       * BSC de verdade feitas sem sessão. Ela só não pode entrar num número que
       * a tela apresenta como caixa medido.
       */
      ({ arrecadado, naoAtribuido } = separarPorAtribuicao(linhas));
      // W3-D: o que a REDE confirmou, separado do declarado e da identidade.
      verificacao = resumirVerificacao(linhas);

      /**
       * ⚠️ A QUEBRA POR ORIGEM RESPONDE "DE ONDE VEM O DINHEIRO", e a resposta
       * honesta hoje é que só uma origem arrecada.
       *
       * `bpsEfetivos`/`destinatarioDaTaxa` são chamados em UM lugar de
       * produção: `/api/quote`, o caminho DEX. CEX e autopiloto não têm
       * mecanismo de cobrança nenhum — o volume deles é real e a receita é zero
       * POR CONSTRUÇÃO, não por falha. A tela precisa dizer isso, senão
       * "VOLUME $127" ao lado de "RECEITA" faz o leitor concluir que os $127
       * renderam.
       */
      const mapa = new Map<string, {
        operacoes: number; volumeUsd: number; arrecadadoUsd: number; comTaxa: number;
        naoAtribuidoUsd: number;
      }>();
      for (const r of linhas) {
        const k = String(r.kind ?? "?");
        const cur = mapa.get(k)
          ?? { operacoes: 0, volumeUsd: 0, arrecadadoUsd: 0, comTaxa: 0, naoAtribuidoUsd: 0 };
        cur.operacoes += 1;
        cur.volumeUsd += Number(r.volume_usd ?? 0);
        // ⚠️ Mesma régua do agregado (A07): a coluna tem que fechar com o topo.
        if (r.platform_fee_usd != null) {
          if (temIdentidadeAssinada(r)) { cur.arrecadadoUsd += Number(r.platform_fee_usd); cur.comTaxa += 1; }
          else { cur.naoAtribuidoUsd += Number(r.platform_fee_usd); }
        }
        mapa.set(k, cur);
      }
      porOrigem = [...mapa.entries()]
        .map(([kind, v]) => ({
          kind,
          operacoes: v.operacoes,
          volumeUsd: Number(v.volumeUsd.toFixed(2)),
          arrecadadoUsd: Number(v.arrecadadoUsd.toFixed(6)),
          comTaxa: v.comTaxa,
          naoAtribuidoUsd: Number(v.naoAtribuidoUsd.toFixed(6)),
          /** Se esta origem PODE cobrar. Zero sem mecanismo ≠ zero por falha. */
          cobravel: COBRAM.includes(kind),
        }))
        .sort((a, b) => b.arrecadadoUsd - a.arrecadadoUsd || b.volumeUsd - a.volumeUsd);

      const datas = reais.map((r) => String(r.created_at)).sort();
      real = {
        operacoes: reais.length,
        volumeUsd: Number(reais.reduce((s, r) => s + Number(r.volume_usd ?? 0), 0).toFixed(2)),
        desde: datas[0] ?? null,
        ate: datas[datas.length - 1] ?? null,
      };
    } catch (e) {
      falha = String(e).slice(0, 160);
    }
  } else {
    falha = "sem banco";
  }

  /**
   * ⚠️ A RECEITA REAL usa a taxa do plano FREE de propósito, e a tela diz isso:
   * não sabemos o plano de cada operação passada — o campo não existe no livro.
   * Usar o teto é o limite SUPERIOR do que teríamos arrecadado, não uma
   * estimativa. Um número menor precisaria de um dado que não temos.
   */
  const receitaRealTetoUsd = receitaUsd(real.volumeUsd, "free");

  const projecao = FAIXAS_MENSAIS.map((volumeUsd) => ({
    volumeUsd,
    porPlano: Object.fromEntries(
      PLANOS.map((t) => [t, receitaUsd(volumeUsd, t)]),
    ) as Record<Tier, number>,
  }));

  return NextResponse.json({
    real, sonda, semVolume, arrecadado, naoAtribuido, porOrigem, falha, verificacao,
    receitaRealTetoUsd,
    taxaPorPlano: TIER_FEE_BPS,
    projecao,
    // ⚠️ RM-12: leitura por chave (sem repetir nem pular linha), mas NÃO é retrato num instante.
    natureza: "painel_nao_ledger",
    solanaRegra: REGRA_TAXA_SOLANA,
    naoMedido: [
      "⚠️ o livro NÃO guarda o plano de quem operou, então a receita real é o "
        + "TETO (tudo cobrado a 1%), não uma estimativa. Para o número exato, o "
        + "plano teria que ser gravado por operação daqui para a frente",
      "⚠️ a projeção NÃO é previsão: é aritmética sobre um volume hipotético. "
        + "Ela responde 'quanto renderia SE', não 'quanto vai render'",
      "⚠️ operação ANÔNIMA é declaração, não medição: `/api/operations/record` "
        + "aceita `confirmed` e taxa de quem não tem sessão assinada. Ela conta "
        + "no volume (a troca aconteceu na cadeia) mas NÃO na arrecadação — "
        + "sai em NÃO ATRIBUÍDO, porque não há a quem perguntar",
      "⚠️ W3-D: ARRECADADO é a taxa DECLARADA pelo navegador. Receita COMPROVADA é só `verificacao.financeiro.verificada` "
        + "(Solana, taxa medida na conta de taxa pela assinatura pública). EVM, LI.FI e CEX seguem NÃO VERIFICADOS",
      "EVM e Solana cobram (Solana desde 16/10): na Jupiter só pares com USDC ou SOL; outros pares saem sem taxa",
      "⚠️ NÃO é número contábil: soma de leituras paginadas (por chave), não um retrato do livro num "
        + "instante só. Conciliação/tesouraria tem de vir de uma agregação SQL única",
      "a taxa é retida no token de saída, então o valor em dólar depende do "
        + "preço daquele token na hora, não do preço de hoje",
    ],
    fetchedAt: new Date().toISOString(),
  });
}
