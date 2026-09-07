/**
 * QUEM RODOU — a identidade de uma rodada, reconstruída do que foi gravado.
 *
 * ⚠️⚠️ ESTE MÓDULO EXISTE POR UMA FRASE DO DONO (07/09): *"cada teste que rodo
 * sobrepõe o outro, e não mostra qual agente está rodando, não dá pra saber o
 * que está rodando"*. Ele tinha `+2,14%` na tela e nada dizia de onde veio.
 *
 * ⚠️ E ELE É PURO, de propósito. A tela precisa da identidade ANTES da resposta
 * chegar (para o cartão em andamento já dizer "FREYJA · BTC · 365d") e DEPOIS
 * de reler o histórico do banco. Se cada lado montasse o próprio rótulo, os
 * dois divergiriam sem ninguém perceber — e a divergência apareceria justamente
 * onde ela mais confunde: duas rodadas parecidas, lado a lado.
 *
 * ⚠️ NÃO HÁ TEXTO TRADUZIDO AQUI. A identidade é ESTRUTURA (qual mesa, qual
 * gatilho, quais números); a frase é da tela, nos quatro idiomas. Devolver
 * prosa daqui seria repetir o defeito do veredito, que voltava português para
 * uma UI de quatro locales.
 */

import type { Entrada, Praca, Papel, Direcao, EstrategiaDoCliente } from "@/lib/bancada/vocabulario";

/**
 * O que a rodada É.
 *
 * ⚠️ UNIÃO FECHADA, e as duas pernas não se misturam: uma mesa da casa NÃO tem
 * alvo fixo (o bracket sai da volatilidade a cada operação) e uma estratégia
 * própria NÃO tem playbook. Um único formato com tudo opcional deixaria a tela
 * mostrar "alvo 0,0%" para a FREYJA — que é exatamente a mentira que o modo
 * mesa foi criado para não contar.
 */
export type Identidade =
  | { tipo: "mesa"; mesa: string; nome: string }
  | {
      tipo: "propria";
      entrada: Entrada;
      direcao: Direcao;
      alvoPct: number;
      stopPct: number;
      horasLimite: number;
    };

/** O contexto que emoldura o número — e sem o qual ele não quer dizer nada. */
export interface Contexto {
  simbolos: string[];
  intervalo: string;
  janelaDias: number;
  praca: Praca;
  papel: Papel;
  capitalUsd: number;
}

function numero(v: unknown, padrao: number): number {
  // ⚠️ `Number(null)` é 0 e passa em `isFinite`. Aqui a checagem de tipo vem
  // ANTES da conversão, senão um campo ausente viraria um zero convincente.
  return typeof v === "number" && Number.isFinite(v) ? v : padrao;
}

function lerEntrada(v: unknown): Entrada {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = Math.round(numero(o.n, 20));
  if (o.tipo === "canal") return { tipo: "canal", n };
  if (o.tipo === "rsi") return { tipo: "rsi", n, nivel: Math.round(numero(o.nivel, 30)) };
  return { tipo: "media", n };
}

/**
 * A identidade de uma rodada a partir dos `params` CONGELADOS no banco.
 *
 * ⚠️ TOLERA O PASSADO. Antes da rodada #401 a mesa não gravava `mesa`/`mesaNome`
 * — uma corrida da FREYJA ficou registrada como `propria`. Uma linha assim volta
 * como `propria` com os números que ela de fato tem, em vez de a leitura inteira
 * falhar: histórico incompleto é ruim, histórico que some é pior.
 */
export function identidadeDaRodada(origem: "propria" | "casa", params: Record<string, unknown>): Identidade {
  const mesa = typeof params.mesa === "string" ? params.mesa : null;
  if (origem === "casa" && mesa) {
    const nome = typeof params.mesaNome === "string" && params.mesaNome.length > 0 ? params.mesaNome : mesa;
    return { tipo: "mesa", mesa, nome };
  }
  return {
    tipo: "propria",
    entrada: lerEntrada(params.entrada),
    direcao: params.direcao === "venda" ? "venda" : "compra",
    alvoPct: numero(params.alvoPct, 0),
    stopPct: numero(params.stopPct, 0),
    horasLimite: numero(params.horasLimite, 48),
  };
}

/** A identidade de uma rodada que a tela está PRESTES a disparar. */
export function identidadeDaMesa(mesa: string, nome: string): Identidade {
  return { tipo: "mesa", mesa, nome };
}

export function identidadeDaPropria(e: EstrategiaDoCliente): Identidade {
  return {
    tipo: "propria",
    entrada: e.entrada,
    direcao: e.direcao,
    alvoPct: e.alvoPct,
    stopPct: e.stopPct,
    horasLimite: e.horasLimite,
  };
}

/**
 * ⚠️ A JANELA EM DIAS SAI DOS DOIS CARIMBOS, não de um campo à parte.
 *
 * `janela_de`/`janela_ate` são o que de fato foi medido; um `janelaDias`
 * gravado em separado poderia discordar deles depois de qualquer ajuste de
 * borda — e aí a tela anunciaria uma janela que a rodada não usou.
 */
export function janelaEmDias(janelaDe: number, janelaAte: number): number {
  return Math.max(0, Math.round((janelaAte - janelaDe) / 86_400_000));
}
