/**
 * ⚠️ REFERÊNCIA CONGELADA — `decidirAberturaDoAgente` como estava em
 * `bancada/agente.ts` na base `0afa841`. NÃO É USADO EM PRODUÇÃO: existe para o
 * teste diferencial do CE-09 provar que a análise compartilhada por símbolo
 * devolve, para cada instância, EXATAMENTE a decisão de antes. Diferença da
 * base: o nome (`…Legado`) e os tipos/constantes, que vêm do módulo oficial.
 */
import { computeIndicators } from "@/lib/api/market-indicators";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { paraCandle, ateOInstante, agregar } from "@/lib/bancada/mesa-real";
import { ultimaVelaFechada } from "@/lib/mercado/velas";
import {
  BARRAS_DE_AQUECIMENTO, INTERVALO_DO_AGENTE,
  type EstadoDaInstancia, type VelasDoAgente, type DecisaoDoAgente,
} from "@/lib/bancada/agente";

export function decidirAberturaDoAgenteLegado(
  estado: EstadoDaInstancia,
  simbolo: string,
  velas: VelasDoAgente,
  agoraMs: number,
): DecisaoDoAgente {
  if (estado.temPosicaoAberta) return { abre: false, porque: "ja_tem_posicao", regime: null };

  const fim = ultimaVelaFechada(INTERVALO_DO_AGENTE, agoraMs);
  if (fim == null) return { abre: false, porque: "sem_velas", regime: null };

  const h1 = ateOInstante(velas.h1, fim);
  if (h1.length < BARRAS_DE_AQUECIMENTO) return { abre: false, porque: "aquecendo", regime: null };

  const ultima = h1[h1.length - 1];
  if (estado.ultimaAberturaMs != null && ultima.t <= estado.ultimaAberturaMs) {
    return { abre: false, porque: "vela_ja_avaliada", regime: null };
  }
  if (!(ultima.close > 0)) return { abre: false, porque: "sem_velas", regime: null };

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
    return { abre: false, porque: tentativas[0]?.reason ?? "sem candidato no regime", regime: ind.regime };
  }

  const plano = comPlano.plan;
  if (!(plano.entry > 0)) return { abre: false, porque: "plano sem preço de entrada", regime: ind.regime };

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
  if (!(alvoPct > 0) || !(stopPct > 0)) return { abre: false, porque: "bracket degenerado", regime: ind.regime };

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
