/**
 * O PEDÁGIO, ANTES DE RODAR — o bloco que aparece acima do botão.
 *
 * ⚠️⚠️ É ISTO QUE TORNA A BANCADA NOSSA E NÃO UM BACKTESTER GENÉRICO.
 *
 * Todo backtester do mercado mostra **retorno bruto**, e é por isso que todo
 * backtester do mercado mente. As três medições que esta casa pagou:
 *
 *     Maker de Faixa, 23/08   acertou 70,4% e PERDEU — entregou 121% do ganho
 *                             de preço em taxa
 *     Grade, 31/08            −46,77%: os degraus renderam 1,25% e o estoque
 *                             preso comeu o resto
 *     Rotação, 31/08          −1,61% por período · FICAR EM CAIXA BATEU
 *
 * ⚠️ O bloco reage a cada tecla e não gasta rodada nenhuma. O cliente que
 * digitar alvo de 0,6% lê *"você precisaria acertar 83%"* de graça, e metade das
 * ideias ruins morre ali — que é o melhor negócio possível para os dois lados:
 * ele não perde dinheiro, e nós não gastamos CPU.
 *
 * ⚠️ ESTE MÓDULO NÃO INVENTA CONTA. Ele compõe o que já existe medido:
 * `taxaPorPerna` (praça E papel), `fracaoDoPedagio`, `pedagioSobreAlvo`.
 */

import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";
import { taxaDaBancadaPct, rotuloDaPraca } from "@/lib/bancada/vocabulario";
import { fracaoDoPedagio } from "@/lib/celeiro/taxas";
import { pedagioSobreAlvo, type Severidade } from "@/lib/pro/custo-da-ideia";

/**
 * ⚠️⚠️ O ACERTO NECESSÁRIO PARA EMPATAR — e a fórmula do plano era o caso
 * PARTICULAR.
 *
 * O plano registra `equilíbrio = 0,5 + custo/(2 × alvo)`, e ela está certa —
 * para bracket SIMÉTRICO. O cliente pode pôr alvo de 3% com stop de 1%, e ali
 * aquela conta erra.
 *
 * A geral sai de igualar o que se ganha ao que se perde:
 *
 *     p × (alvo − custo) = (1 − p) × (stop + custo)
 *     p = (stop + custo) / (alvo + stop)
 *
 * ⚠️ E ELA REPRODUZ A TABELA DE CICATRIZ EXATAMENTE, com custo de 0,40%:
 *
 *     ±0,6%  →  (0,6+0,4)/1,2  =  83,3%
 *     ±1,5%  →  (1,5+0,4)/3,0  =  63,3%
 *     ±2,5%  →  (2,5+0,4)/5,0  =  58,0%
 *
 * Se ela não batesse com os três, seria a fórmula nova que estaria errada — não
 * a cicatriz. Os testes fixam os três.
 */
export interface Equilibrio {
  /** A taxa de acerto que EMPATA, em % (0 a 100). */
  acertoParaEmpatarPct: number;
  /**
   * ⚠️ `false` quando nem acertar SEMPRE paga a conta — o alvo é menor que o
   * pedágio. Ali `acertoParaEmpatarPct` passa de 100, e um número acima de 100
   * numa tela parece meta difícil quando na verdade é impossibilidade.
   */
  alcancavel: boolean;
}

export function equilibrioExigido(
  alvoPct: number, stopPct: number, custoIdaEVoltaPct: number,
): Equilibrio | null {
  if (!Number.isFinite(alvoPct) || !Number.isFinite(stopPct) || !Number.isFinite(custoIdaEVoltaPct)) return null;
  const denominador = alvoPct + stopPct;
  // ⚠️ Sem denominador não há conta — e devolver Infinity seria pior que devolver
  // nada, porque Infinity numa tela parece um número.
  if (!(denominador > 0)) return null;
  const p = ((stopPct + custoIdaEVoltaPct) / denominador) * 100;
  return { acertoParaEmpatarPct: p, alcancavel: p <= 100 };
}

/** O bloco inteiro que a tela mostra antes de o cliente clicar. */
export interface PedagioAntesDeRodar {
  /** Taxa de UMA perna, em %. */
  taxaPernaPct: number;
  /** Entrar e sair: `2 ×` a de cima. É este que decide. */
  idaEVoltaPct: number;
  /** Que fração do alvo o pedágio come (0 a 1). `null` sem alvo positivo. */
  fatiaDoAlvo: number | null;
  /** `ok` · `atencao` (≥1/3 do alvo) · `grave` (≥1/2) · `sem_dado`. */
  severidade: Severidade;
  equilibrio: Equilibrio | null;
  /** Uma frase pronta, em português, para a tela não montar texto sozinha. */
  frase: string;
}

/**
 * ⚠️ A FRASE VEM DAQUI, não do componente.
 *
 * Texto montado no JSX é texto que nenhum teste lê — e foi assim que um painel
 * do admin passou meses dizendo "nenhuma pool encontrada" para um 429. A frase
 * é parte da medição, então ela nasce junto com os números.
 */
export function oPedagioAntesDeRodar(e: EstrategiaDoCliente): PedagioAntesDeRodar {
  const taxaPernaPct = taxaDaBancadaPct(e.praca, e.papel);
  const idaEVoltaPct = taxaPernaPct * 2;
  const leitura = pedagioSobreAlvo(taxaPernaPct, e.alvoPct);
  const fatiaDoAlvo = fracaoDoPedagio(taxaPernaPct, e.alvoPct);
  const equilibrio = equilibrioExigido(e.alvoPct, e.stopPct, idaEVoltaPct);

  const pedaco = fatiaDoAlvo == null
    ? "o alvo precisa ser positivo para a conta existir"
    : `${(fatiaDoAlvo * 100).toFixed(0)}% do seu alvo`;

  let frase = `Na ${rotuloDaPraca(e.praca)} como ${e.papel}, a ida e volta custa `
    + `${idaEVoltaPct.toFixed(3)}% — ${pedaco}.`;

  if (equilibrio) {
    frase += equilibrio.alcancavel
      ? ` Você precisa acertar ${equilibrio.acertoParaEmpatarPct.toFixed(1)}% das vezes só para empatar.`
      /**
       * ⚠️ ACIMA DE 100% NÃO É "DIFÍCIL", É IMPOSSÍVEL — e a frase precisa dizer
       * a palavra. "Você precisa acertar 118%" soa como meta ambiciosa para quem
       * não parar para pensar, e quem não para para pensar é exatamente o
       * público que esta bancada existe para proteger.
       */
      : ` Nem acertando SEMPRE isto fecha: o alvo de ${e.alvoPct}% é menor que o pedágio de ${idaEVoltaPct.toFixed(3)}%.`;
  }

  return { taxaPernaPct, idaEVoltaPct, fatiaDoAlvo, severidade: leitura.severidade, equilibrio, frase };
}
