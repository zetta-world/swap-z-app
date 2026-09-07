/**
 * O AGENTE DO INVESTIDOR — a decisão de abertura de UMA INSTÂNCIA dele.
 *
 * ⚠️⚠️ POR QUE ESTE ARQUIVO EXISTE (07/09). O dono, olhando a bancada:
 *
 *   *"apenas estamos pegando os resultados das mesas do painel e Admin e
 *   repetindo para o investidor... eu falei que tinha que ser isolado... o
 *   investidor roda estratégia/agente e o mesmo começa a trabalhar e gerar
 *   resultado dali"*.
 *
 * Ele estava certo, e o defeito era de arquitetura. O que a bancada tinha:
 *
 *   · o card da mesa, com o número da casa lido de `zion_suggestions` — o livro
 *     do ADMIN, replicado na tela do cliente;
 *   · o botão "rodar esta", que fazia um BACKTEST — passado obedecendo;
 *   · o papel adiante, que era vivo e isolado de verdade, mas só sabia rodar o
 *     vocabulário fechado do cliente (`media | canal | rsi`).
 *
 * Faltava a peça do meio: o agente da casa rodando NA CONTA DO INVESTIDOR, a
 * partir do instante em que ele o contrata. É isto.
 *
 * ⚠️ E ELE NÃO REIMPLEMENTA A MESA. `computeIndicators` e `candidateAttempts`
 * são os mesmos que `mesa-real.ts` chama e que o cron da casa chama. O que
 * muda é DE QUEM é a posição que nasce daqui — e é só isso que tinha de mudar.
 *
 * ⚠️ PURO, e fora do tique de propósito: o vitest desta base roda em
 * `environment: "node"`, e decisão que mora dentro do laço do cron é decisão
 * sem teste.
 */

import { computeIndicators } from "@/lib/api/market-indicators";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { paraCandle, ateOInstante, agregar } from "@/lib/bancada/mesa-real";
import { ultimaVelaFechada } from "@/lib/mercado/velas";
import type { VelaComTempo } from "@/lib/mercado/velas";

/**
 * ⚠️ O MESMO AQUECIMENTO DO BACKTEST. `computeIndicators` devolve vazio abaixo
 * de 52 velas de 1h, e o EMA50/ADX só assentam bem depois disso. Um agente que
 * decide com 60 barras não está sendo "mais ágil": está lendo indicador que
 * ainda não nasceu, e o investidor pagaria por isso com dinheiro de verdade
 * quando esta bancada virar execução.
 */
export const BARRAS_DE_AQUECIMENTO = 200;

/** ⚠️ O agente CAMINHA em 1h, como a mesa ao vivo — não no intervalo da tela. */
export const INTERVALO_DO_AGENTE = "1h";

export interface VelasDoAgente {
  h1: ReadonlyArray<VelaComTempo>;
  h4: ReadonlyArray<VelaComTempo>;
  d1: ReadonlyArray<VelaComTempo>;
  /** ⚠️ AGREGADA das diárias — ver `agregar`. Nunca as diárias no lugar. */
  w1?: ReadonlyArray<VelaComTempo>;
}

/** O que a instância já sabe de si quando o tick chega. */
export interface EstadoDaInstancia {
  /** ⚠️ Uma posição por vez, como no backtest e no motor do cliente. */
  temPosicaoAberta: boolean;
  /**
   * De qual vela veio o último sinal desta instância (unix ms).
   *
   * ⚠️ É A GUARDA DE REABERTURA. O cron ticka a cada 30 minutos e a vela de 1h
   * fecha a cada 60: sem isto, a MESMA vela abriria duas posições, e o `n`
   * contaria repetição como evidência.
   */
  ultimaAberturaMs: number | null;
}

export type DecisaoDoAgente =
  | {
      abre: true;
      velaMs: number;
      entrada: number;
      /** ⚠️ Em % DA ENTRADA, derivado do plano — o bracket é variável. */
      alvoPct: number;
      stopPct: number;
      horasLimite: number;
      /** Qual dos dez playbooks abriu. Sem isto o extrato não se confere. */
      playbook: string;
      regime: string;
    }
  | { abre: false; porque: string };

/**
 * O agente decide, nesta vela, se abre.
 *
 * ⚠️⚠️ SÓ VELA FECHADA. `ultimaVelaFechada` corta a vela corrente — ela muda a
 * cada negócio, e decidir sobre ela é decidir sobre um período que ainda não
 * aconteceu. É a mesma trava da janela do backtest, e vale mais aqui: no
 * backtest o erro dá um número errado; aqui ele abre uma posição.
 *
 * ⚠️ E O MOTIVO DA RECUSA É DEVOLVIDO, nunca um `null` mudo. Uma instância
 * parada e uma instância quebrada produzem exatamente a mesma tela — foi assim
 * que o Maker de Faixa ficou dois dias sem abrir posição sem ninguém notar, e
 * ali éramos NÓS, com acesso ao banco.
 */
export function decidirAberturaDoAgente(
  estado: EstadoDaInstancia,
  simbolo: string,
  velas: VelasDoAgente,
  agoraMs: number,
): DecisaoDoAgente {
  if (estado.temPosicaoAberta) return { abre: false, porque: "ja_tem_posicao" };

  const fim = ultimaVelaFechada(INTERVALO_DO_AGENTE, agoraMs);
  if (fim == null) return { abre: false, porque: "sem_velas" };

  const h1 = ateOInstante(velas.h1, fim);
  if (h1.length < BARRAS_DE_AQUECIMENTO) return { abre: false, porque: "aquecendo" };

  const ultima = h1[h1.length - 1];
  if (estado.ultimaAberturaMs != null && ultima.t <= estado.ultimaAberturaMs) {
    return { abre: false, porque: "vela_ja_avaliada" };
  }
  if (!(ultima.close > 0)) return { abre: false, porque: "sem_velas" };

  /**
   * ⚠️⚠️ QUATRO PRAZOS, e nenhum deles é opcional. O regime e o alinhamento
   * saem da comparação entre 1h, 4h, 1d e 1w. Faltando os altos, o regime sai
   * sempre "TRANSITIONING" e a instância fica parada por FALTA DE DADO em vez
   * de por falta de setup — e uma instância quieta e uma cega têm exatamente a
   * mesma aparência na tela do investidor.
   */
  const d1 = ateOInstante(velas.d1, ultima.t);
  const w1 = velas.w1 ? ateOInstante(velas.w1, ultima.t) : agregar(d1, 7);

  const ind = computeIndicators(
    simbolo,
    paraCandle(h1),
    paraCandle(ateOInstante(velas.h4, ultima.t)),
    paraCandle(d1),
    paraCandle(w1),
  );

  const tentativas = candidateAttempts(ind);
  const comPlano = tentativas.find((a) => a.plan !== null);
  if (!comPlano || !comPlano.plan) {
    // ⚠️ O motivo vem do playbook de MAIOR prioridade do regime — o que mais
    // tinha chance de operar. Sem playbook nenhum, o próprio regime é a
    // resposta. É a mesma disciplina de `selectWithCandidates`.
    return { abre: false, porque: tentativas[0]?.reason ?? "sem candidato no regime" };
  }

  const plano = comPlano.plan;
  if (!(plano.entry > 0)) return { abre: false, porque: "plano sem preço de entrada" };

  /**
   * ⚠️ O BRACKET VIRA PERCENTUAL DA ENTRADA porque é assim que a posição o
   * guarda — e ele é VARIÁVEL: sai da volatilidade daquele instante
   * (`stopFloorPct = max(ATR% × 1,5, piso)`, alvo ≤ `ATR% × √horas × 2,0`, piso
   * de RR 1,8). Duas posições da MESMA instância têm brackets diferentes, e é
   * por isso que `alvo_pct`/`stop_pct`/`horas_limite` moram na LINHA da posição
   * (0043) em vez de serem relidos da estratégia na hora de fechar.
   *
   * ⚠️ `Math.abs` porque estas mesas são long-only por construção: o alvo está
   * acima e o stop abaixo, e um sinal negativo aqui viraria um stop que nunca
   * dispara.
   */
  const alvoPct = Math.abs((plano.target - plano.entry) / plano.entry) * 100;
  const stopPct = Math.abs((plano.entry - plano.stop) / plano.entry) * 100;
  if (!(alvoPct > 0) || !(stopPct > 0)) return { abre: false, porque: "bracket degenerado" };

  return {
    abre: true,
    velaMs: ultima.t,
    /**
     * ⚠️ A ENTRADA É O FECHAMENTO DA VELA QUE DEU O SINAL, não `plano.entry`.
     *
     * O plano é montado sobre `ind.price`, que é esse mesmo fechamento — mas
     * quando eles divergirem (um playbook que propõe entrada em recuo, por
     * exemplo), o investidor tem de ser preenchido ao preço que EXISTIA, não ao
     * preço que a regra desejava. Preencher no preço desejado é a forma mais
     * educada de inventar borda.
     */
    entrada: ultima.close,
    alvoPct, stopPct,
    horasLimite: plano.horizonHours,
    playbook: plano.playbook,
    regime: ind.regime,
  };
}
