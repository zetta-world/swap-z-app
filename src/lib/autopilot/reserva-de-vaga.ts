/**
 * ⚠️⚠️⚠️ UMA ÚNICA FORMA DE CONSUMIR A VAGA DO DIA — achado A132.
 *
 * O Round 8 consertou o navegador: `/api/cex/order` RESERVA a vaga ANTES do
 * efeito externo, por compare-and-swap. O cron ficou como estava: chamava
 * `bumpSessionTrades` DEPOIS da ordem, e esse RPC é
 * `trades_today = trades_today + n` — soma atômica, **sem conferir teto**.
 *
 * Com 4 de 5 feitos:
 *
 *     navegador lê 4 → reserva → 5
 *     cron já tinha lido 4 → envia → soma → 6
 *
 * Teto de 5 fechando o dia em 6. Duas primitivas para o mesmo limite é a
 * família do A113 aplicada a um contador: cada canal respeita um número que o
 * outro não vê.
 *
 * ⚠️ ESTE MÓDULO NÃO É UMA TERCEIRA CÓPIA. Ele é a costura `ReservaDeRisco` do
 * executor — a mesma que o navegador já usava — extraída para que os dois
 * canais passem literalmente o mesmo objeto, com a mesma semântica de
 * liberação. Se um dia divergirem, vai ser aqui dentro, num lugar só.
 *
 * ⚠️ `liberar` SÓ RODA NA RECUSA PROVADA. O executor a chama em três pontos,
 * todos com prova de que nada saiu, e NUNCA em `UNKNOWN`: devolver a vaga
 * sobre dúvida autorizaria um segundo envio para um dinheiro que talvez já
 * tenha saído (INVARIANTE 4).
 */

import {
  reservarTradeDaSessao, liberarTradeDaSessao, type ResultadoDaReserva,
} from "@/lib/autopilot/sessions";
import type { ReservaDeRisco } from "@/lib/cex/execucao/executor";

export type MotivoDaReservaNegada = Extract<ResultadoDaReserva, { ok: false }>["motivo"];

export interface VagaDiaria extends ReservaDeRisco {
  /**
   * O motivo da ÚLTIMA recusa, ou `null` se a última tentativa deu certo.
   *
   * ⚠️ Quem chama precisa distinguir "o teto do dia acabou" (parada legítima,
   * silenciosa) de "não consegui falar com o banco" (o contador deixou de ser
   * confiável, e a passada tem de parar de disparar).
   */
  ultimoMotivo: () => MotivoDaReservaNegada | null;
  /** O valor gravado na reserva viva, ou `null` se não há vaga pendurada. */
  vagaViva: () => number | null;
}

export interface DependenciasDaVaga {
  reservar?: typeof reservarTradeDaSessao;
  liberar?: typeof liberarTradeDaSessao;
}

/**
 * A reserva de UMA vaga diária para UMA ordem.
 *
 * ⚠️ UMA ORDEM, UMA VAGA, e o objeto é de uso único por ordem de propósito:
 * num cartão de duas ou três pernas, cada perna cria a sua. Reservar as três
 * de antemão contaria vagas por pernas que podem nunca ser enviadas — e a
 * perna 2 só existe se a 1 saiu (§12).
 */
export function reservaDaVagaDiaria(
  sessionId: string, hojeUtc: string, deps: DependenciasDaVaga = {},
): VagaDiaria {
  const reservar = deps.reservar ?? reservarTradeDaSessao;
  const liberar  = deps.liberar  ?? liberarTradeDaSessao;

  let vaga: number | null = null;
  let motivo: MotivoDaReservaNegada | null = null;

  return {
    // ⚠️ A vaga do dia não depende do intent — mas a assinatura é a da
    // costura, que passou a carregá-lo para as reservas de inventário (A137).
    reservar: async () => {
      const r = await reservar(sessionId, hojeUtc);
      if (r.ok) {
        vaga = r.tradesDepois;
        motivo = null;
        return { ok: true as const };
      }
      motivo = r.motivo;
      return { ok: false as const, porque: `${r.motivo}: ${r.porque}` };
    },
    liberar: async () => {
      // ⚠️ Sem reserva viva não há o que devolver — e chamar assim mesmo
      // roubaria a vaga de OUTRA ordem que reservou depois.
      if (vaga === null) return;
      await liberar(sessionId, hojeUtc, vaga);
      vaga = null;
    },
    ultimoMotivo: () => motivo,
    vagaViva: () => vaga,
  };
}
