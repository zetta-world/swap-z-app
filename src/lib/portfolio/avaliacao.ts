/**
 * ⚠️⚠️ PREÇO DESCONHECIDO NÃO É PATRIMÔNIO ZERO (auditoria externa A32, 14/09).
 *
 * O portfólio somava `usdValue ?? 0`: 100 USDC sem preço apareciam como $0 na
 * linha, entravam como 0 no total e o total incompleto virava ponto do
 * histórico, comparado depois com totais completos. Três estados diferentes
 * liam igual:
 *
 *   · ZERO CONHECIDO   — há preço e ele vale 0 (ou o saldo é 0): é valor;
 *   · SEM PREÇO        — há saldo, mas nenhum preço (`null`/`undefined`/NaN);
 *   · INDISPONÍVEL     — nem o saldo foi lido (erro do fornecedor/RPC).
 *
 * Aqui só o primeiro soma. Os outros dois são CONTADOS, e o total diz que é
 * parcial. Nada é estimado: sem preço não se inventa preço.
 */

/** O valor em USD é conhecido? Zero conta como conhecido; null/undefined/NaN/negativo não. */
export function temPreco(usd: number | null | undefined): usd is number {
  return typeof usd === "number" && Number.isFinite(usd) && usd >= 0;
}

export interface Avaliacao {
  /** Soma SÓ dos ativos com preço. */
  totalUsd: number;
  /** Ativos com saldo e sem preço — fora do total. */
  semPreco: number;
  /** Saldos que nem foram lidos — fora do total. */
  indisponiveis: number;
  /** O total cobre tudo? Só então ele é comparável e pode virar histórico. */
  completo: boolean;
}

export function avaliar(valores: ReadonlyArray<number | null | undefined>, indisponiveis = 0): Avaliacao {
  let totalUsd = 0;
  let semPreco = 0;
  for (const v of valores) {
    if (temPreco(v)) totalUsd += v;
    else semPreco++;
  }
  return { totalUsd, semPreco, indisponiveis, completo: semPreco === 0 && indisponiveis === 0 };
}

/** Ordena por valor decrescente; quem não tem preço vai para o fim (não é "o menor"). */
export function porValorDesc(a: number | null | undefined, b: number | null | undefined): number {
  const pa = temPreco(a), pb = temPreco(b);
  if (pa && pb) return b - a;
  if (pa) return -1;
  if (pb) return 1;
  return 0;
}

/**
 * O resumo da carteira que o ZION recebe. ⚠️ A32: antes dizia `~$0.00` para o
 * ativo sem preço e somava-o como zero — a IA raciocinava sobre um patrimônio
 * que não era o do usuário. Agora: preço desconhecido é DITO, e o total diz que
 * é parcial.
 */
export function linhasDaCarteira(
  holdings: ReadonlyArray<{ symbol: string; chain: string; amount: string; usdValue?: number | null }>,
  max: number,
): string[] {
  const a = avaliar(holdings.map((h) => h.usdValue));
  const out = [`  total_portfolio_usd: ${a.totalUsd.toFixed(2)}${a.completo ? "" : ` (partial: ${a.semPreco} asset(s) without price excluded)`}`];
  [...holdings]
    .sort((x, y) => porValorDesc(x.usdValue, y.usdValue))
    .slice(0, max)
    .forEach((h) => {
      out.push(`  - ${h.symbol} on ${h.chain}: ${h.amount} (${temPreco(h.usdValue) ? `~$${h.usdValue.toFixed(2)}` : "price unavailable"})`);
    });
  return out;
}
