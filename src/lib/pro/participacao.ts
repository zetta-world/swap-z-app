/**
 * A LEITURA DE PARTICIPAÇÃO — quantas CARTEIRAS, não quantas trades.
 *
 * ⚠️⚠️ POR QUE ISTO É DIFERENTE DE VOLUME, e por que é o campo mais valioso que
 * o terminal descartava (31/08).
 *
 * `ORDER FLOW` já mostrava "$626 de compra contra $2,99K de venda". Isso não
 * distingue **mil carteiras vendendo um pouco** de **uma carteira vendendo
 * muito** — e as duas coisas dizem o oposto sobre o que está acontecendo. A
 * primeira é distribuição ampla; a segunda é uma saída, ou um teste de
 * profundidade, ou um único ator.
 *
 * `transactions.h24.buyers` e `.sellers` são carteiras ÚNICAS, e vinham em toda
 * resposta de pool desde sempre.
 *
 * ⚠️ TUDO AQUI É FUNÇÃO PURA e vive fora do componente, porque o vitest deste
 * repo roda em `environment: "node"` e não parseia JSX — conta que decide número
 * não mora em `.tsx`.
 */

export interface Participacao {
  /** Trades por carteira compradora. >1 = poucas carteiras repetindo. */
  tradesPorComprador: number | null;
  tradesPorVendedor:  number | null;
  /** Fração das carteiras ativas que comprou (0 a 1). */
  fracaoCompradores:  number | null;
  /** A frase que a tela mostra. Nunca inventa quando falta dado. */
  leitura: string;
  /** `concentrado` quando poucas carteiras fazem muitas trades. */
  classe: "amplo" | "concentrado" | "equilibrado" | "sem_dado";
}

/**
 * ⚠️ ACIMA DE QUANTAS TRADES POR CARTEIRA A COISA É "CONCENTRADA".
 *
 * Três não é gosto: numa pool saudável a maioria das carteiras entra uma ou
 * duas vezes por dia. Bots de arbitragem e market makers fazem dezenas — e é
 * exatamente essa cauda que o volume esconde e a razão revela.
 */
export const TRADES_POR_CARTEIRA_CONCENTRADO = 3;

export function lerParticipacao(m: {
  compradores24h: number | null;
  vendedores24h:  number | null;
  compras24h:     number | null;
  vendas24h:      number | null;
} | null): Participacao {
  const vazio: Participacao = {
    tradesPorComprador: null, tradesPorVendedor: null, fracaoCompradores: null,
    leitura: "a fonte não devolveu contagem de carteiras nesta janela",
    classe: "sem_dado",
  };
  if (!m) return vazio;

  const { compradores24h: cb, vendedores24h: vd, compras24h: cp, vendas24h: vn } = m;
  /**
   * ⚠️ FALTANDO QUALQUER UM, NÃO SE CALCULA NADA. Completar com zero faria
   * "nenhum vendedor" — a leitura mais otimista possível a partir de nenhuma
   * informação, e a mais cara quando estiver errada.
   */
  if (cb === null || vd === null || cp === null || vn === null) return vazio;
  if (cb + vd === 0) {
    return { ...vazio, leitura: "nenhuma carteira operou esta pool em 24h", classe: "sem_dado" };
  }

  const tradesPorComprador = cb > 0 ? cp / cb : null;
  const tradesPorVendedor  = vd > 0 ? vn / vd : null;
  const fracaoCompradores  = (cb + vd) > 0 ? cb / (cb + vd) : null;

  const pico = Math.max(tradesPorComprador ?? 0, tradesPorVendedor ?? 0);
  if (pico >= TRADES_POR_CARTEIRA_CONCENTRADO) {
    return {
      tradesPorComprador, tradesPorVendedor, fracaoCompradores,
      classe: "concentrado",
      leitura: `${pico.toFixed(1)} trades por carteira — poucas carteiras repetindo, `
        + "o volume não vem de participação ampla",
    };
  }

  const fc = fracaoCompradores ?? 0.5;
  if (fc >= 0.6 || fc <= 0.4) {
    return {
      tradesPorComprador, tradesPorVendedor, fracaoCompradores,
      classe: "amplo",
      leitura: `${cb} carteiras compraram contra ${vd} que venderam `
        + `(${(fc * 100).toFixed(0)}% do lado comprador)`,
    };
  }
  return {
    tradesPorComprador, tradesPorVendedor, fracaoCompradores,
    classe: "equilibrado",
    leitura: `${cb} compradores e ${vd} vendedores — participação equilibrada`,
  };
}

/**
 * A idade da pool, em texto curto.
 *
 * ⚠️ IDADE É SINAL DE RISCO DE PRIMEIRA ORDEM, e é o que separa uma pool com
 * anos de histórico de uma criada há vinte minutos com a mesma liquidez na tela.
 * O dado (`pool_created_at`) já chegava e era descartado.
 */
export function idadeDaPool(criadaEmMs: number | null, agoraMs: number = Date.now()): string | null {
  if (criadaEmMs === null || !Number.isFinite(criadaEmMs)) return null;
  const dias = (agoraMs - criadaEmMs) / 86_400_000;
  if (dias < 0) return null;
  if (dias < 1) return `${Math.max(1, Math.round(dias * 24))}h`;
  if (dias < 60) return `${Math.round(dias)}d`;
  if (dias < 730) return `${Math.round(dias / 30)}mes`;
  return `${(dias / 365).toFixed(1)}a`;
}
