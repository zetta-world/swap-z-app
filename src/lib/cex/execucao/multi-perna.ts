/**
 * ⚠️⚠️⚠️ EXECUÇÃO MULTI-PERNA NÃO É ATÔMICA — e o código chamava de atômica.
 *
 * O cabeçalho de `AutopilotPilot.tsx` dizia, sobre arbitragem entre corretoras:
 *
 *     "Two legs → arbitrage_cross_cex (BUY on cheap venue + SELL on expensive
 *      venue, ATOMIC — both legs fire in parallel so price moves between them
 *      can't open one-sided directional risk)"
 *
 * Disparar em paralelo NÃO é atomicidade. São duas chamadas a dois sistemas
 * independentes, cada uma podendo falhar sozinha:
 *
 *     BUY executa, SELL falha    → exposição direcional COMPRADA, sem hedge
 *     BUY falha, SELL executa    → exposição VENDIDA, possivelmente a descoberto
 *     triangular: perna 2 falha  → inventário preso numa moeda intermediária
 *
 * O paralelismo reduz a JANELA entre as pernas. Ele não elimina o caso de uma
 * executar e a outra não — e é exatamente esse caso que "atomic" promete que
 * não existe. Chamar pelo nome errado faz quem lê parar de procurar o resíduo.
 *
 * ⚠️ NÃO EXISTE ROLLBACK. Trade em corretora não desfaz. "Desfazer" é abrir uma
 * ordem CONTRÁRIA, que tem preço próprio, custo próprio e pode falhar também —
 * é COMPENSAÇÃO, e este módulo a chama assim.
 *
 * ⚠️ ENQUANTO ISTO NÃO FOR PROVADO EM PRODUÇÃO, ARBITRAGEM AUTÔNOMA É NO-GO.
 * Este módulo dá o vocabulário e a máquina de estados; ele NÃO autoriza nada.
 */

export type EstadoMultiPerna =
  | "PREPARADO"
  /** Ao menos uma perna foi enviada. Nada pode ser concluído ainda. */
  | "PERNAS_EM_VOO"
  /** Todas as pernas executaram como planejado. O único desfecho limpo. */
  | "COMPLETO"
  /**
   * ⚠️ Parte das pernas executou e o conjunto NÃO está neutro. Há exposição
   * direcional que ninguém pediu.
   */
  | "HEDGE_PARCIAL"
  /** Nenhuma proteção: uma perna sozinha, exposta ao mercado. */
  | "SEM_HEDGE"
  /** Precisa de ordem CONTRÁRIA para voltar ao neutro. Não é rollback. */
  | "COMPENSACAO_NECESSARIA"
  /** Fail-closed: mão humana. Nada automático prossegue. */
  | "QUARENTENA";

export interface PernaObservada {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  /** A base que esta perna movimenta. */
  base: string;
  /** Quanto foi pedido. */
  pedido: number;
  /** ⚠️ Quanto o LIVRO tem. Nunca o pedido, nunca o ACK. */
  executado: number;
  /** O intent ainda pode mudar? (UNKNOWN, SUBMITTED, PARTIALLY_FILLED…) */
  emVoo: boolean;
  /** Preço médio realizado, quando há execução. */
  precoMedio: number | null;
}

export interface ExposicaoResidual {
  base: string;
  /** Positivo = comprado a descoberto; negativo = vendido a descoberto. */
  quantidade: number;
  /** Em dólares, quando dá para precificar. `null` = não medido. */
  usd: number | null;
}

export interface VereditoMultiPerna {
  estado: EstadoMultiPerna;
  /** O que sobrou exposto, por base. Vazio = neutro. */
  residual: ExposicaoResidual[];
  porque: string;
}

/**
 * ⚠️ O TETO DE EXPOSIÇÃO RESIDUAL. Acima disto não se espera nem se torce: vai
 * para compensação. Abaixo, o resíduo é registrado e tolerado — compensar
 * centavos custa mais pedágio do que o risco que remove.
 */
export const RESIDUO_TOLERADO_USD =
  Number(process.env.ARB_RESIDUO_TOLERADO_USD ?? 5);

/**
 * ⚠️ QUANTO TEMPO UMA PERNA PODE FICAR EM VOO antes de virar quarentena.
 * Uma perna que não resolve é uma exposição que ninguém está medindo.
 */
export const TIMEOUT_DA_PERNA_MS =
  Number(process.env.ARB_TIMEOUT_PERNA_MS ?? 5 * 60_000);

/**
 * Onde a operação multi-perna está, e o que sobrou exposto.
 *
 * ⚠️ FUNÇÃO PURA. Ela é a diferença entre "a arbitragem fechou" e "a
 * arbitragem deixou o cliente comprado em BTC sem ninguém saber".
 */
export function avaliarMultiPerna(
  pernas: readonly PernaObservada[],
  opts: { idadeMs?: number } = {},
): VereditoMultiPerna {
  if (pernas.length === 0) {
    return { estado: "PREPARADO", residual: [], porque: "nenhuma perna enviada" };
  }

  // ── o resíduo por base: comprado menos vendido ────────────────────────
  const porBase = new Map<string, { qtd: number; usd: number | null }>();
  for (const p of pernas) {
    if (!(p.executado > 0)) continue;
    const sinal = p.side === "buy" ? 1 : -1;
    const atual = porBase.get(p.base) ?? { qtd: 0, usd: 0 as number | null };
    atual.qtd += sinal * p.executado;
    /**
     * ⚠️ SEM PREÇO, O DÓLAR VIRA `null` E NÃO ZERO. Uma perna cujo preço não
     * conhecemos torna o resíduo NÃO MEDIDO — e não medido não pode ser
     * comparado com o teto de tolerância.
     */
    if (atual.usd !== null) {
      atual.usd = p.precoMedio != null && p.precoMedio > 0
        ? atual.usd + sinal * p.executado * p.precoMedio
        : null;
    }
    porBase.set(p.base, atual);
  }

  const residual: ExposicaoResidual[] = [];
  for (const [base, v] of porBase) {
    if (Math.abs(v.qtd) < 1e-12) continue;
    residual.push({ base, quantidade: v.qtd, usd: v.usd });
  }

  const emVoo = pernas.filter((p) => p.emVoo);
  const velhaDemais = (opts.idadeMs ?? 0) > TIMEOUT_DA_PERNA_MS;

  if (emVoo.length > 0) {
    if (velhaDemais) {
      /**
       * ⚠️ PERNA PENDURADA VIRA QUARENTENA. Esperar para sempre por uma perna
       * que não resolve é deixar uma exposição sem dono — e sem alarme.
       */
      return { estado: "QUARENTENA", residual,
        porque: `${emVoo.length} perna(s) em voo ha mais de ${Math.round(TIMEOUT_DA_PERNA_MS / 1000)}s` };
    }
    return { estado: "PERNAS_EM_VOO", residual,
      porque: `${emVoo.length} perna(s) ainda sem desfecho — nada pode ser concluido` };
  }

  if (residual.length === 0) {
    const algumExecutou = pernas.some((p) => p.executado > 0);
    return algumExecutou
      ? { estado: "COMPLETO", residual: [], porque: "todas as pernas casaram — neutro" }
      : { estado: "COMPLETO", residual: [],
          porque: "nenhuma perna executou — nada aberto, nada a compensar" };
    }

  /**
   * ⚠️ RESÍDUO NÃO MEDIDO NÃO É RESÍDUO PEQUENO. Se o dólar de qualquer base
   * ficou `null`, não dá para dizer que cabe na tolerância — e o caminho de
   * dinheiro falha FECHADO.
   */
  const algumNaoMedido = residual.some((r) => r.usd === null);
  if (algumNaoMedido) {
    return { estado: "COMPENSACAO_NECESSARIA", residual,
      porque: "exposicao residual sem preco — nao medido nao cabe em tolerancia nenhuma" };
  }

  const maiorUsd = Math.max(...residual.map((r) => Math.abs(r.usd ?? 0)));
  if (maiorUsd <= RESIDUO_TOLERADO_USD) {
    return { estado: "HEDGE_PARCIAL", residual,
      porque: `residual de $${maiorUsd.toFixed(2)} dentro da tolerancia — registrado, nao compensado` };
  }

  const executaram = pernas.filter((p) => p.executado > 0).length;
  return {
    estado: executaram === 1 ? "SEM_HEDGE" : "COMPENSACAO_NECESSARIA",
    residual,
    porque: `exposicao residual de $${maiorUsd.toFixed(2)} acima do tolerado `
      + `$${RESIDUO_TOLERADO_USD} — precisa de ordem CONTRARIA (compensacao), nao de rollback`,
  };
}

/**
 * ⚠️ NÃO EXISTE `desfazer()` NESTE MÓDULO, e a ausência é o ponto.
 *
 * O que existe é a DESCRIÇÃO da compensação: qual ordem contrária devolveria o
 * conjunto ao neutro. Executá-la é decisão de outro caminho, com intent, reserva
 * e certificado próprios — porque ela é uma ordem nova, com risco novo.
 */
export function compensacaoNecessaria(
  v: VereditoMultiPerna,
): Array<{ base: string; side: "buy" | "sell"; quantidade: number }> {
  if (v.estado !== "COMPENSACAO_NECESSARIA" && v.estado !== "SEM_HEDGE") return [];
  return v.residual
    .filter((r) => Math.abs(r.quantidade) > 1e-12)
    .map((r) => ({
      base: r.base,
      // Comprado a mais → vender de volta. Vendido a mais → comprar de volta.
      side: r.quantidade > 0 ? ("sell" as const) : ("buy" as const),
      quantidade: Math.abs(r.quantidade),
    }));
}
