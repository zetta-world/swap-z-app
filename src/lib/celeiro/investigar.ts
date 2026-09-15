/**
 * O CICLO DO INVESTIGADOR — de escrito-e-parado para rodando.
 *
 * ⚠️⚠️ ELE EXISTIA DESDE 20/08 E NINGUÉM O CHAMAVA. Prompt, validador e placar
 * estavam escritos e testados; `celeiro_genoma` e `celeiro_mutacoes` existiam
 * com só o genoma-semente gravado. Era o pedaço que APRENDE, órfão — a mesma
 * forma de morte silenciosa que este projeto já pagou três vezes.
 *
 * O ciclo tem três passos, nesta ordem, e a ordem importa:
 *
 *   ① JULGA o que está em curso     — fecha antes de abrir
 *   ② PERGUNTA aos modelos          — só se não há mutação viva
 *   ③ APLICA a melhor proposta      — uma por agente, nunca duas
 *
 * ⚠️ JULGAR VEM ANTES DE PERGUNTAR. Se perguntasse primeiro, uma segunda
 * mutação entraria com a primeira ainda viva — e o braço `mutacao` carregaria
 * as duas, tornando ilegível qual delas pagou.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredProviders } from "@/lib/ai/registry";
import { chamarComReserva } from "@/lib/ai/modelo-reserva";
import { isTripped, recordResult } from "@/lib/ai/circuit";
import { recordEvent, notifyTelegram } from "@/lib/admin/track";
import { AGENTES, ehRegua, type Agente } from "@/lib/celeiro/agentes";
import { extratoDe, julgarMutacao, type Fluxo } from "@/lib/celeiro/fluxo";
import { promptDoInvestigador, lerResposta, placarDosModelos } from "@/lib/celeiro/investigador";
import {
  fluxosDesde, genomaAtivo, mutacaoEmCurso, registrarMutacao,
  aplicarMutacao, fecharMutacao, mutacoesJulgadas,
} from "@/lib/celeiro/store";

/** Quantos lançamentos o agente precisa ter para valer uma investigação. */
export const MINIMO_PARA_INVESTIGAR = Number(process.env.CELEIRO_MIN_INVESTIGAR ?? 30);

/**
 * ⚠️⚠️ QUANTOS DIAS UMA MUTAÇÃO PODE FICAR "AGUARDANDO" ANTES DE VIRAR ALARME.
 *
 * ACHADO MEDINDO O CELEIRO (14/09): três mutações aplicadas e nunca julgadas, a
 * mais velha havia QUINZE DIAS, e ninguém soube. `aguardar` é um estado
 * legítimo — a amostra ainda cresce —, mas ele é indistinguível de um
 * experimento MORTO quando o braço fraco parou de operar.
 *
 * O `maker_de_faixa` é o caso puro: braço de controle com ZERO operações nos
 * últimos 7 dias e 10 desde a aplicação, contra um mínimo de 20. Ele nunca
 * chegaria ao piso — e o `aguardar` seria eterno, em silêncio, com o genoma
 * mutado de pé.
 *
 * ⚠️ Um A/B em que um braço PAROU não é um A/B lento: é um A/B quebrado, e a
 * diferença entre os dois é exatamente o que este prazo existe para dizer.
 */
export const DIAS_ATE_MUTACAO_TRAVADA = Number(process.env.CELEIRO_DIAS_TRAVADA ?? 10);

/** A janela de extrato que o modelo enxerga. */
export const JANELA_DE_ANALISE_MS = Number(process.env.CELEIRO_JANELA_ANALISE_MS ?? 7 * 86_400_000);

export interface RelatoDoAgente {
  agente: string;
  julgou?: { veredito: string; porque: string };
  /** ⚠️ Mutação em curso há tempo demais com um braço parado — ver `DIAS_ATE_MUTACAO_TRAVADA`. */
  travada?: { dias: number; porque: string };
  perguntou?: number;
  propostas?: Array<{ modelo: string; ok: boolean; porque: string }>;
  aplicou?: { modelo: string; versao: number; hipotese: string } | null;
  /**
   * ⚠️ A MUTAÇÃO QUE A ARENA RECUSOU (05/09). `aplicou: null` cobria "erro de
   * escrita" e "genoma que nunca abriria" com a mesma cara. O segundo caso
   * custou dois dias de A/B com um braço que não operou.
   */
  recusou?: { modelo: string; motivo: "impossivel" | "escrita"; porque: string };
  /**
   * ⚠️ O FECHAMENTO QUE NÃO FECHOU (achado A06). `fecharMutacao` devolvia `void`
   * e descartava todo `error`: uma reversão que falhava deixava o agente
   * operando com um genoma que a arena já tinha reprovado, e o relato saía
   * idêntico ao de um fechamento perfeito.
   */
  naoFechou?: { onde: "julgamento" | "reversao"; porque: string };
  pulou?: string;
}

/**
 * Um ciclo completo do Investigador.
 *
 * ⚠️ MELHOR-ESFORÇO POR AGENTE: uma falha num não derruba os outros. O
 * Investigador não opera dinheiro — travar o cron por causa dele seria parar o
 * que ganha por causa do que aprende.
 */
export async function investigar(db: SupabaseClient, agoraMs = Date.now()): Promise<{
  agentes: RelatoDoAgente[];
  placar: ReturnType<typeof placarDosModelos>;
}> {
  const agentes: RelatoDoAgente[] = [];

  /**
   * ⚠️ NENHUMA RÉGUA É INVESTIGADA, e não é esquecimento. Elas são os PISOS:
   * mudar os parâmetros de uma move a referência contra a qual todos os outros
   * são medidos, e um experimento cuja régua muda no meio não mede nada.
   *
   * ⚠️⚠️ E SÃO DUAS RÉGUAS, não uma (30/08). Este filtro dizia `!a.controle` e
   * deixava passar o `comprador_cego`, que é o piso de DIREÇÃO sob outra flag.
   * Ele foi mutado em 27/08 por um A/B quebrado. Ver `ehRegua`.
   */
  const investigaveis = AGENTES.filter((a) => !ehRegua(a));

  for (const ag of investigaveis) {
    try {
      agentes.push(await umAgente(db, ag, agoraMs));
    } catch (e) {
      agentes.push({ agente: ag.id, pulou: `erro: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  const placar = placarDosModelos(await mutacoesJulgadas(db));
  await recordEvent("celeiro_investigador", { meta: { agentes, placar } });
  return { agentes, placar };
}

async function umAgente(db: SupabaseClient, ag: Agente, agoraMs: number): Promise<RelatoDoAgente> {
  const relato: RelatoDoAgente = { agente: ag.id };

  // ── ① JULGAR o que está em curso ────────────────────────────────────────
  const emCurso = await mutacaoEmCurso(db, ag.id);

  /**
   * ⚠️⚠️ A LEITURA VAI ATÉ A APLICAÇÃO DA MUTAÇÃO, NÃO SÓ 7 DIAS (14/09).
   *
   * ACHADO MEDINDO O CELEIRO A PEDIDO DO DONO. Três mutações estavam aplicadas
   * e NUNCA julgadas — a mais velha havia 15 dias —, e a causa não era falta de
   * amostra: era a janela.
   *
   * `fluxosDesde(agoraMs - JANELA_DE_ANALISE_MS)` traz 7 dias. O julgamento
   * então filtra `f.ocorreuEmMs >= desde` (a aplicação) — um filtro que declara
   * medir DESDE A MUTAÇÃO sobre um conjunto que já foi truncado em 7 DIAS. O
   * filtro virou no-op e o truncamento ficou invisível.
   *
   * Medido no banco, com a mutação aplicada em 30/08:
   *
   *     alavancado  controle: 10 ops na janela · 29 DESDE a aplicação
   *     cacador     controle:  5 ops na janela · 19 DESDE a aplicação
   *     maker       controle:  0 ops na janela · 10 DESDE a aplicação
   *
   * Com `MINIMO_POR_BRACO = 20`, o Alavancado já podia ter sido julgado — e
   * ficou 15 dias em "aguardar" porque 19 das 29 operações dele estavam fora
   * da janela. E o defeito PIORA SOZINHO: quanto mais a mutação espera, mais
   * evidência dela sai pela borda.
   *
   * ⚠️ A janela de 7 dias continua valendo para o que ela existe: o extrato que
   * o MODELO enxerga ao propor. Essa é uma pergunta sobre o presente. Julgar é
   * uma pergunta sobre o experimento inteiro, e são janelas diferentes.
   */
  const desdeDaLeitura = emCurso?.aplicadaEmMs != null
    ? Math.min(emCurso.aplicadaEmMs, agoraMs - JANELA_DE_ANALISE_MS)
    : agoraMs - JANELA_DE_ANALISE_MS;
  const fluxos: Fluxo[] = await fluxosDesde(db, ag.id, desdeDaLeitura);

  if (emCurso) {
    const desde = emCurso.aplicadaEmMs ?? 0;
    const j = julgarMutacao(fluxos.filter((f) => f.ocorreuEmMs >= desde));
    relato.julgou = { veredito: j.veredito, porque: j.porque };

    /**
     * ⚠️ `aguardar` NÃO FECHA A MUTAÇÃO — ela continua em teste. Fechar por
     * falta de tempo descartaria a hipótese por uma amostra que ainda estava
     * crescendo, e o modelo levaria a culpa.
     *
     * ⚠️⚠️ MAS `inconclusiva` DEIXOU DE SIGNIFICAR "espere" (29/08). Com os dois
     * braços destruindo valor o veredito é inconclusivo sobre o PARÂMETRO e
     * ainda assim a mutação tem de sair de pé — senão o genoma continua andando
     * em cima de comparações que não decidiram nada. Quem manda agora é `acao`.
     */
    if (j.acao === "aguardar") {
      /**
       * ⚠️⚠️ ESPERAR É LEGÍTIMO; ESPERAR PARA SEMPRE, NÃO (14/09).
       *
       * Sem isto, uma mutação cujo braço fraco parou de operar fica em
       * `aguardar` indefinidamente — com o genoma mutado NO AR — e o único
       * sinal é uma linha de `relato` que ninguém lê. Foram 15 dias assim.
       *
       * ⚠️ O alarme exige as DUAS coisas: prazo estourado E braço fraco sem
       * nenhuma operação recente. Só o prazo acusaria experimento lento; só o
       * braço vazio acusaria o primeiro dia de toda mutação.
       */
      const diasEmCurso = emCurso.aplicadaEmMs == null ? null
        : Math.floor((agoraMs - emCurso.aplicadaEmMs) / 86_400_000);
      const recentes = fluxos.filter((f) => f.ocorreuEmMs >= agoraMs - JANELA_DE_ANALISE_MS);
      const fracoParado =
        recentes.filter((f) => f.braco === "controle").length === 0 ||
        recentes.filter((f) => f.braco === "mutacao").length === 0;

      if (diasEmCurso != null && diasEmCurso >= DIAS_ATE_MUTACAO_TRAVADA && fracoParado) {
        relato.travada = { dias: diasEmCurso, porque: j.porque };
        notifyTelegram(
          `⚠️ CELEIRO — mutação travada em ${ag.id} há ${diasEmCurso} dias: um braço do A/B parou de operar.\n${j.porque}`,
          { dedupKey: `celeiro:travada:${ag.id}`, meta: { agente: ag.id, dias: diasEmCurso } },
        );
      }
      return relato;
    }

    /**
     * ⚠️⚠️ O RETORNO É CONFERIDO (achado A06). Nenhuma das duas falhas é
     * corrigível aqui — a mutação fica POR JULGAR e o próximo ciclo refaz o
     * fechamento inteiro, que é idempotente de propósito. O que não pode é
     * passar calado: enquanto não fechar, o agente segue operando o genoma que
     * o julgamento acabou de reprovar.
     */
    const fechamento = await fecharMutacao(
      db, emCurso.id, ag.id, j.veredito, j.usdtControle, j.usdtMutacao, j.acao,
    );
    if (!fechamento.ok) {
      relato.naoFechou = { onde: fechamento.onde, porque: fechamento.porque };
      notifyTelegram(
        `⚠️ CELEIRO — o fechamento de ${ag.id} falhou em "${fechamento.onde}": o genoma `
        + `reprovado SEGUE NO AR até o próximo ciclo refazer.\n${fechamento.porque}`,
        { dedupKey: `celeiro:naofechou:${ag.id}`, meta: { agente: ag.id, onde: fechamento.onde } },
      );
    }
    return relato;   // ⚠️ só volta a perguntar no próximo ciclo, com o genoma limpo
  }

  // ── ② PERGUNTAR aos modelos ─────────────────────────────────────────────
  if (fluxos.length < MINIMO_PARA_INVESTIGAR) {
    relato.pulou = `${fluxos.length} lançamentos na janela, mínimo ${MINIMO_PARA_INVESTIGAR} — `
      + "sem extrato não há o que investigar";
    return relato;
  }

  const genoma = await genomaAtivo(db, ag.id, {});
  if (!genoma) { relato.pulou = "genoma não legível"; return relato; }

  const extrato = extratoDe(ag.id, fluxos);
  const prompt = promptDoInvestigador(extrato, genoma.params, fluxos.length);

  /**
   * ⚠️ CADA MODELO RESPONDE SEM VER OS OUTROS, e é o desenho inteiro. Se um
   * visse a resposta do anterior, o segundo concordaria — e o placar mediria
   * convergência em vez de qualidade. Nenhum modelo da Anthropic participa
   * (decisão do dono); `configuredProviders` já devolve só os compatíveis.
   */
  const provedores = configuredProviders();
  relato.perguntou = provedores.length;
  relato.propostas = [];

  const candidatas: Array<{ modelo: string; hipotese: string; diff: Record<string, unknown>; esperado: string }> = [];

  for (const p of provedores) {
    if (!p.apiKey || await isTripped(p.id)) {
      relato.propostas.push({ modelo: p.id, ok: false, porque: "sem chave ou disjuntor aberto" });
      continue;
    }
    try {
      const r = await chamarComReserva(p,
        { system: "Você investiga o caixa de um agente de trading. Responda só JSON.",
          user: prompt, maxTokens: 800, timeoutMs: p.timeoutMs ?? 30_000 });
      await recordResult(p.id, p.label, true);
      const lida = lerResposta(r.text, genoma.params);
      relato.propostas.push({ modelo: p.id, ok: lida.ok, porque: lida.ok ? "proposta válida" : lida.porque });
      if (lida.ok) candidatas.push({ modelo: p.id, ...lida.proposta });
    } catch (e) {
      await recordResult(p.id, p.label, false, e instanceof Error ? e.message : String(e));
      relato.propostas.push({ modelo: p.id, ok: false, porque: e instanceof Error ? e.message : String(e) });
    }
  }

  if (candidatas.length === 0) { relato.aplicou = null; return relato; }

  // ── ③ APLICAR uma, e só uma ─────────────────────────────────────────────
  /**
   * ⚠️ ESCOLHE PELO PLACAR DO MODELO, não pela ordem nem pelo texto. Quem
   * propôs mudanças que pagaram no passado tem preferência — é assim que o
   * Investigador vira mérito acumulado em vez de rodízio cego.
   *
   * ⚠️ E O PISO DE RODÍZIO GARANTE QUE NINGUÉM É ZERADO: um modelo no fundo
   * ainda entra quando é o único com proposta válida, e pode voltar. Zerar
   * congelaria o julgamento do passado para sempre.
   */
  const placar = placarDosModelos(await mutacoesJulgadas(db));
  const nota = new Map(placar.map((p) => [p.modelo, p.usdtGerado]));
  candidatas.sort((a, b) => (nota.get(b.modelo) ?? 0) - (nota.get(a.modelo) ?? 0));
  const escolhida = candidatas[0];

  const id = await registrarMutacao(db, { agente: ag.id, ...escolhida });
  if (!id) { relato.aplicou = null; return relato; }

  const r = await aplicarMutacao(
    db, id, ag.id, { ...genoma.params, ...escolhida.diff }, escolhida.modelo, escolhida.hipotese,
  );
  /**
   * ⚠️ A RECUSA É DITA, não engolida (05/09). Antes `null` cobria "erro de
   * escrita" e "genoma impossível" com a mesma cara, e o relato só dizia
   * `aplicou: null` — foi assim que o Maker ficou dois dias com um braço de A/B
   * que nunca operou sem ninguém saber.
   */
  relato.aplicou = r.ok ? { modelo: escolhida.modelo, versao: r.versao, hipotese: escolhida.hipotese } : null;
  if (!r.ok) relato.recusou = { modelo: escolhida.modelo, motivo: r.motivo, porque: r.porque };
  return relato;
}
