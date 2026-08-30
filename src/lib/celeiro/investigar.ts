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
import { recordEvent } from "@/lib/admin/track";
import { AGENTES, type Agente } from "@/lib/celeiro/agentes";
import { extratoDe, julgarMutacao, type Fluxo } from "@/lib/celeiro/fluxo";
import { promptDoInvestigador, lerResposta, placarDosModelos } from "@/lib/celeiro/investigador";
import {
  fluxosDesde, genomaAtivo, mutacaoEmCurso, registrarMutacao,
  aplicarMutacao, fecharMutacao, mutacoesJulgadas,
} from "@/lib/celeiro/store";

/** Quantos lançamentos o agente precisa ter para valer uma investigação. */
export const MINIMO_PARA_INVESTIGAR = Number(process.env.CELEIRO_MIN_INVESTIGAR ?? 30);

/** A janela de extrato que o modelo enxerga. */
export const JANELA_DE_ANALISE_MS = Number(process.env.CELEIRO_JANELA_ANALISE_MS ?? 7 * 86_400_000);

export interface RelatoDoAgente {
  agente: string;
  julgou?: { veredito: string; porque: string };
  perguntou?: number;
  propostas?: Array<{ modelo: string; ok: boolean; porque: string }>;
  aplicou?: { modelo: string; versao: number; hipotese: string } | null;
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
   * ⚠️ O CONTROLE NÃO É INVESTIGADO, e não é esquecimento. Ele é o PISO: mudar
   * os parâmetros dele moveria a régua contra a qual todos os outros são
   * medidos, e um experimento cujo controle muda no meio não mede nada.
   */
  const investigaveis = AGENTES.filter((a) => !a.controle);

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
  const fluxos: Fluxo[] = await fluxosDesde(db, ag.id, agoraMs - JANELA_DE_ANALISE_MS);
  const relato: RelatoDoAgente = { agente: ag.id };

  // ── ① JULGAR o que está em curso ────────────────────────────────────────
  const emCurso = await mutacaoEmCurso(db, ag.id);
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
    if (j.acao === "aguardar") return relato;

    await fecharMutacao(db, emCurso.id, ag.id, j.veredito, j.usdtControle, j.usdtMutacao, j.acao);
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

  const versao = await aplicarMutacao(
    db, id, ag.id, { ...genoma.params, ...escolhida.diff }, escolhida.modelo, escolhida.hipotese,
  );
  relato.aplicou = versao == null ? null
    : { modelo: escolhida.modelo, versao, hipotese: escolhida.hipotese };
  return relato;
}
