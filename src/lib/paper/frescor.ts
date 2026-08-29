/**
 * O FRESCOR DA SUGESTÃO — o sinal de cinco horas atrás.
 * (`docs/PLANO-ATRASO-DE-EXECUCAO.md`)
 *
 * ⚠️⚠️ POR QUE ESTE PORTÃO EXISTE (29/08).
 *
 * As mesas executam sugestões em média **5 horas** depois de geradas. Não é
 * lentidão de cron: é a fila. A regra de uma posição por símbolo por mesa
 * (correta, e explicada em `engine.ts`) faz a sugestão preterida ESPERAR — e
 * ela espera indefinidamente, executando quando a vaga abrir, com o alvo e o
 * stop calculados sobre um preço de referência que já não existe.
 *
 * O atraso medido é bimodal: p25 de 0,6 min, mediana de 180 min, e cauda até
 * **94,5 horas**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O DANO NÃO É "TRADE ATRASADO PERDE DINHEIRO" — eu apostei nisso e a
 * medição não confirmou. Todas as faixas de atraso deram expectativa positiva
 * na janela de 18–29/08. Registrar isto importa: o portão não está aqui para
 * consertar o placar.
 *
 * O dano é que o atraso transforma HORIZONTE EM FICÇÃO:
 *
 *     posição aberta dentro do prazo ......  15% expiram  (36 de 238)
 *     com metade do horizonte já gasto ....  52% expiram  (22 de 42)
 *     nascida já vencida ..................  80% expiram  (4 de 5)
 *
 * `expired` não é win nem loss — é o flywheel dizendo "não deu tempo de saber".
 * Uma entrada atrasada não perde dinheiro; ela FABRICA AMOSTRA SEM VEREDITO, e
 * a contagem de fechadas é a régua de confiança do laboratório inteiro.
 *
 * O segundo efeito, mais sutil: atraso INFLA O ACERTO e ENCOLHE O GANHO. Com
 * mais de 50% do caminho até o alvo já consumido no preenchimento, a amostra
 * deu 77% de acerto, ZERO stops — e a pior expectativa de todas (+0,66 contra
 * +1,80 na faixa de 15–30%). É catar centavos com o risco inteiro na mesa.
 */

/**
 * ⚠️ MEIO HORIZONTE, E O NÚMERO É DELIBERADAMENTE FROUXO.
 *
 * Os dados dizem que a melhor faixa é a imediata (161 trades, expectativa
 * +1,38, atraso de 0,2h) e que TUDO que espera é pior. Cortar em 5% capturaria
 * isso — e seria ajustar ao ruído de 285 trades, que é exatamente o pecado que
 * o flywheel deste repo foi construído para não cometer.
 *
 * Meio horizonte corta só o que é errado por ARITMÉTICA: uma posição cujo prazo
 * de vida já foi majoritariamente consumido antes de ela nascer. O alvo e o
 * stop foram dimensionados para uma janela que já tinha acabado.
 *
 * O teto aperta na F2, a partir de medição com o portão ligado — nunca do meu
 * dedo. Ver §5 do plano, onde o critério de sucesso está escrito ANTES.
 */
export const MAX_FRACAO_DO_HORIZONTE = Number(
  process.env.PAPER_MAX_FRACAO_HORIZONTE ?? 0.5,
);

export type MotivoRecusaFrescor = "sinal_velho";

export interface Frescor {
  /** Quanto do horizonte da sugestão já passou quando ela ia virar posição.
   *  `null` = não deu para medir (sem data legível ou sem horizonte). */
  fracaoGasta: number | null;
  /** Horas entre a geração da sugestão e este instante. `null` = não sei. */
  atrasoHoras: number | null;
  /** ⚠️ `true` também quando NÃO DEU PARA MEDIR — ver a nota de falha aberta. */
  fresca: boolean;
}

/**
 * Mede o frescor de uma sugestão no instante em que ela viraria posição.
 *
 * ⚠️⚠️ FALHA ABERTA, ao contrário do caminho do dinheiro — e é a mesma decisão
 * que `permiteEntrada` tomou no filtro de regime, pela mesma razão.
 *
 * A regra da casa é falhar FECHADO quando há dinheiro em jogo: sem preço de
 * referência, rejeita. Aqui fechar não protege capital nenhum — só impede a
 * mesa de operar. Uma data ilegível desligaria o laboratório inteiro em
 * silêncio, que é precisamente a morte muda que este projeto já pagou (a
 * FREYJA, dez dias sem executar e sem ninguém saber de quê).
 *
 * ⚠️ HORIZONTE AUSENTE NÃO VIRA 72. O default de 72h existe no `insert` da
 * posição, e replicá-lo aqui faria este portão julgar por um número que a
 * sugestão nunca declarou — barrando por uma janela inventada. Sem horizonte,
 * `null`, e passa.
 */
export function medirFrescor(
  criadaEmIso: string | null | undefined,
  horizonteHoras: number | null | undefined,
  agoraMs: number,
): Frescor {
  const nada: Frescor = { fracaoGasta: null, atrasoHoras: null, fresca: true };

  if (criadaEmIso == null || criadaEmIso === "") return nada;
  const criadaMs = Date.parse(criadaEmIso);
  if (!Number.isFinite(criadaMs) || !Number.isFinite(agoraMs)) return nada;

  const atrasoMs = agoraMs - criadaMs;
  /**
   * ⚠️ ATRASO NEGATIVO É RELÓGIO TORTO, NÃO SUGESTÃO DO FUTURO. Acontece com
   * desvio entre o relógio do banco e o da função. Tratar como 0 mantém a
   * sugestão fresca — que é o desfecho certo: ela acabou de ser criada.
   */
  const atrasoHoras = Math.max(0, atrasoMs) / 3_600_000;

  if (horizonteHoras == null || !Number.isFinite(horizonteHoras) || horizonteHoras <= 0) {
    // Sabemos o atraso, mas não temos régua para julgá-lo. Reporta e deixa passar.
    return { fracaoGasta: null, atrasoHoras, fresca: true };
  }

  const fracaoGasta = atrasoHoras / horizonteHoras;
  return { fracaoGasta, atrasoHoras, fresca: fracaoGasta < MAX_FRACAO_DO_HORIZONTE };
}

/**
 * O portão, em uma linha, para quem só quer o sim/não.
 *
 * ⚠️ Existe separado porque o abridor precisa do NÚMERO para o evento — barrar
 * sem dizer o quanto estava velha é a invariante nº 7 de novo, e a fração é o
 * que a F2 vai usar para escolher o teto de verdade.
 */
export function sinalFresco(
  criadaEmIso: string | null | undefined,
  horizonteHoras: number | null | undefined,
  agoraMs: number,
): boolean {
  return medirFrescor(criadaEmIso, horizonteHoras, agoraMs).fresca;
}
