/**
 * AS SEMENTES DE GENOMA — e a trava que faltava.
 *
 * ⚠️⚠️ POR QUE ISTO SAIU DA ROTA (31/08). As sementes viviam dentro de um
 * ternário aninhado no `cron/route.ts`. Nenhum teste alcança uma rota — ela
 * importa `supabase/server`, `recordEvent` e meio mundo — e o efeito foi
 * exatamente o previsível:
 *
 * O `maker_de_faixa` foi recriado no mesmo dia com `alvoPct: 1.5` e um
 * comentário afirmando *"com múltiplo 6 sobre uma ida-e-volta de 0,225%, o
 * mínimo é 1,35%"*. **0,225% é o pedágio LEGADO da arena**, e o portão já não
 * usa esse número desde a correção que separou a taxa por praça E por papel:
 * ele recebe `taxaPerna * 2` do AGENTE. Para `spot_gate` + `maker` isso é
 * **0,40%**, e o mínimo é **2,40%**.
 *
 * Resultado, medido em produção nos ticks de 22:30 e 23:00 de 31/08:
 *
 *     BTC  abre: false  "alvo de 1.50% deixa 27% para o pedágio (mínimo 2.40%)"
 *     ETH  abre: false  idem
 *     SOL  abre: false  idem
 *
 * O agente aparecia em todo tick, examinava três símbolos, escrevia o porquê —
 * e **não podia abrir uma única posição, nunca**. Compilou, passou no CI, foi
 * mergeado e deployado. É a lição da própria entrega: *atividade não é
 * evidência de funcionamento*.
 *
 * ⚠️ A TRAVA É `sementeAbreAlgumaVez`, e ela mora aqui junto das sementes de
 * propósito. Um teste que percorre `SEMENTES` e afirma que cada uma limpa o
 * pedágio DO SEU AGENTE falha na hora em que alguém escreve um alvo impossível
 * — que é a única hora em que o aviso serve para alguma coisa.
 */

import { agentePor, type Agente } from "@/lib/celeiro/agentes";
import { taxaPorPerna } from "@/lib/celeiro/taxas";
import { alvoLimpaOPedagio, MULTIPLO_DO_PEDAGIO } from "@/lib/celeiro/regime";

/**
 * ⚠️ `type` COM ÍNDICE, não `interface`. O `genomaAtivo` recebe
 * `Record<string, unknown>` (o genoma é jsonb no banco), e uma `interface` não
 * satisfaz essa restrição — é a mesma pegadinha documentada em
 * `supabase/types.ts`, onde uma `interface` degradava a linha inteira a `never`.
 */
export type Semente = {
  [k: string]: number | undefined;
  alvoPct?: number;
  stopPct?: number;
  horasLimite?: number;
  margemPp?: number;
  multiploDoPedagio?: number;
};

/**
 * ⚠️ O BRACKET DO MAKER — ±2,5%, e o número é o portão, não o gosto.
 *
 * A autópsia de 23/08: ele morreu com ±0,6% **acertando 70,4%** (19 alvos
 * contra 8 stops, n=27, p≈0,026). No spot da Gate a ida-e-volta de 0,40% comia
 * DOIS TERÇOS do movimento bruto — ele não errava, ele pagava pedágio.
 *
 * O portão desta casa exige alvo ≥ 6× o pedágio do agente: **2,40%**. O 2,5%
 * limpa isso com folga e mantém TODAS as travas existentes intactas — em vez de
 * afrouxar o múltiplo, que é a trava que o comentário dela chama de cicatriz.
 *
 * ⚠️ E ISTO É UMA TERCEIRA HIPÓTESE, não a de 23/08 nem a de 31/08. Um alvo
 * 4× mais distante que agosto muda a geometria de saída: mais saídas por tempo,
 * menos por alvo, e a taxa de alvo-primeiro cai por GEOMETRIA antes de cair por
 * sinal. Ler o resultado como "o Maker de agosto foi refutado" seria comparar
 * duas coisas diferentes.
 *
 * A aritmética que sobra, para o registro:
 *
 *     equilíbrio = 0,5 + custo / (2 × alvo)
 *     ±0,6% → 83,3%   (mediu 70,4% → perdeu, e a conta explica o −0,62)
 *     ±1,5% → 63,3%
 *     ±2,5% → 58,0%
 *
 * ⚠️ SIMÉTRICO DE PROPÓSITO: alvo = stop mantém a taxa de alvo-primeiro
 * comparável com agosto (num passeio, 50% é o esperado). Mexer na simetria
 * junto com a largura mediria duas mudanças de uma vez.
 */
export const SEMENTES: Record<string, Semente> = {
  convergencia_base: { margemPp: 0.15, horasLimite: 8 },

  maker_de_faixa: {
    alvoPct: 2.5,
    stopPct: 2.5,
    /** Sobe de 8h para 24h porque um alvo mais distante precisa de prazo — ver acima. */
    horasLimite: 24,
    multiploDoPedagio: MULTIPLO_DO_PEDAGIO,
  },

  /**
   * ⚠️ O PADRÃO DOS AGENTES DE TENDÊNCIA. Eles são `futuros_gate`, onde a perna
   * do taker custa 0,05% — ida-e-volta 0,10%, mínimo 0,60%. O alvo de 2,0%
   * limpa com folga de mais de 3×.
   */
  padrao: {
    alvoPct: 2.0,
    stopPct: 1.2,
    horasLimite: 48,
    multiploDoPedagio: MULTIPLO_DO_PEDAGIO,
  },
};

/** A semente de um agente — a dele, ou o padrão dos de tendência. */
export function sementeDe(agenteId: string): Semente {
  return SEMENTES[agenteId] ?? SEMENTES.padrao;
}

export interface VeredictoDaSemente {
  /** `false` quando o agente NUNCA conseguiria abrir com esta semente. */
  abre: boolean;
  alvoPct: number | null;
  alvoMinimoPct: number;
  pedagioIdaEVoltaPct: number;
  porque: string;
}

/**
 * Esta semente consegue abrir alguma vez?
 *
 * ⚠️⚠️ O PEDÁGIO É DO AGENTE, e é aqui que o erro de 31/08 nasce ou morre. Usar
 * `PEDAGIO_IDA_E_VOLTA_PCT` (o legado da arena, 0,225%) daria "passa" a um alvo
 * que o cron recusa — a trava concordaria com o defeito. O número certo é
 * `2 × taxaPorPerna(modalidade, execucao)`, exatamente como o cron calcula.
 *
 * ⚠️ E O STOP ENTRA NA CONTA. `alvoAcompanhaOStop` (I3) faz o alvo subir para
 * acompanhar o stop efetivo, nunca descer — então o alvo que o portão julga é
 * `max(alvo, stop)`. Julgar só o `alvoPct` declarado erraria para o lado
 * otimista num genoma de stop largo.
 */
export function sementeAbreAlgumaVez(
  agente: Agente,
  semente: Semente = sementeDe(agente.id),
): VeredictoDaSemente {
  const pedagio = 2 * taxaPorPerna(agente.modalidade, agente.execucao);
  const multiplo = Number(semente.multiploDoPedagio ?? MULTIPLO_DO_PEDAGIO);

  /**
   * Um agente sem `alvoPct` na semente não usa o portão do alvo — é o caso do
   * `convergencia_base`, que decide por margem em pontos-base. `null` aqui é
   * "não se aplica", nunca "reprovado".
   */
  if (semente.alvoPct == null) {
    return {
      abre: true, alvoPct: null,
      alvoMinimoPct: pedagio * multiplo, pedagioIdaEVoltaPct: pedagio,
      porque: "semente sem alvo — este agente não passa pelo portão de pedágio",
    };
  }

  const alvoEfetivo = Math.max(Number(semente.alvoPct), Number(semente.stopPct ?? 0));
  const v = alvoLimpaOPedagio(alvoEfetivo, multiplo, pedagio);
  return {
    abre: v.passa,
    alvoPct: alvoEfetivo,
    alvoMinimoPct: v.alvoMinimoPct,
    pedagioIdaEVoltaPct: pedagio,
    porque: v.passa
      ? `alvo de ${alvoEfetivo.toFixed(2)}% limpa o mínimo de ${v.alvoMinimoPct.toFixed(2)}% `
        + `(pedágio de ${pedagio.toFixed(3)}% em ${agente.modalidade}/${agente.execucao})`
      : v.porque,
  };
}

/**
 * Os agentes cuja semente NUNCA abriria. Lista vazia é o estado saudável.
 *
 * ⚠️ Percorre `SEMENTES`, não a lista do cron: uma semente escrita para um
 * agente que não existe mais é lixo, mas uma semente impossível para um agente
 * que existe é um agente morto em pé.
 */
export function sementesImpossiveis(): Array<{ agente: string; porque: string }> {
  const fora: Array<{ agente: string; porque: string }> = [];
  for (const id of Object.keys(SEMENTES)) {
    if (id === "padrao") continue;
    const ag = agentePor(id);
    if (!ag) continue;
    const v = sementeAbreAlgumaVez(ag, SEMENTES[id]);
    if (!v.abre) fora.push({ agente: id, porque: v.porque });
  }
  return fora;
}
