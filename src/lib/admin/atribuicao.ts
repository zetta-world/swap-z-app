/**
 * QUEM TEM DONO E QUEM É SÓ ALEGAÇÃO — achado A07 da auditoria externa.
 *
 * ⚠️⚠️ `/api/operations/record` aceita `status: "confirmed"` e `platformFeeUsd`
 * de um chamador SEM sessão assinada. A carteira não vem do corpo (isso foi
 * corrigido em 30/07), então a linha entra com `wallet_address = NULL` — e os
 * dois painéis que somam dinheiro somavam TUDO que estava confirmado.
 *
 * Medido em produção em 15/09: 4 das 18 operações confirmadas são anônimas, e a
 * ÚNICA linha que carrega arrecadação — 100% do valor exibido no painel RECEITA
 * e no telão do mural — é uma delas.
 *
 * ⚠️ RECUSAR A LINHA ANÔNIMA SERIA PIOR. As quatro de hoje são trocas BSC de
 * verdade, feitas sem sessão assinada; jogá-las fora abriria um buraco no livro
 * para tapar um buraco no painel. A troca aconteceu na cadeia: o VOLUME é real.
 * O que não é medição é a RETENÇÃO declarada, porque não há a quem perguntar.
 *
 * ⚠️ POR QUE UM MÓDULO, e não a conta inline em cada rota. A separação estava
 * para nascer duas vezes — `/admin/api/receita` e `/admin/api/mural` — e duas
 * cópias da mesma régua é a porta dos fundos desta base: cada uma certa sozinha
 * e divergindo na primeira correção. Além disso, trava textual sobre fonte de
 * rota já foi marcada como armadilha aqui; função pura tem teste de verdade.
 */

export interface LinhaDeOperacao {
  wallet_address?: string | null;
  platform_fee_usd?: number | string | null;
  volume_usd?: number | string | null;
}

/**
 * A linha tem uma carteira que apresentou cookie assinado?
 *
 * ⚠️ String vazia NÃO é identidade. `wallet_address` sai de `session.sub`, então
 * hoje ela não chega vazia — mas `!= null` aceitaria `""` calado, e a diferença
 * entre "sem dono" e "dono em branco" não pode depender de sorte.
 */
export function temIdentidadeAssinada(r: LinhaDeOperacao): boolean {
  const w = r.wallet_address;
  return typeof w === "string" && w.trim().length > 0;
}

/**
 * ⚠️ AUSÊNCIA NÃO É ZERO (invariante da casa). `Number(null)` é 0 e passa em
 * `isFinite`; uma linha sem taxa gravada não declarou zero, ela não declarou.
 * Quem soma trata as duas igual — por isso a CONTAGEM viaja junto do total.
 */
function taxaDe(r: LinhaDeOperacao): number | null {
  if (r.platform_fee_usd == null) return null;
  const n = Number(r.platform_fee_usd);
  return Number.isFinite(n) ? n : null;
}

function volumeDe(r: LinhaDeOperacao): number {
  const n = Number(r.volume_usd ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export interface Separacao {
  /** Retenção de linhas COM carteira assinada. É o que a tela chama de caixa. */
  arrecadado: { usd: number; operacoes: number };
  /** Retenção DECLARADA por chamada sem sessão. Alegação, não medição. */
  naoAtribuido: { usd: number; operacoes: number; linhas: number; volumeUsd: number };
}

/** Separa a retenção entre o que tem dono e o que é alegação anônima. */
export function separarPorAtribuicao(linhas: readonly LinhaDeOperacao[]): Separacao {
  let usdCom = 0, opsCom = 0;
  let usdSem = 0, opsSem = 0, linhasSem = 0, volumeSem = 0;

  for (const r of linhas) {
    const taxa = taxaDe(r);
    if (temIdentidadeAssinada(r)) {
      if (taxa !== null) { usdCom += taxa; opsCom += 1; }
    } else {
      linhasSem += 1;
      volumeSem += volumeDe(r);
      if (taxa !== null) { usdSem += taxa; opsSem += 1; }
    }
  }

  return {
    arrecadado: { usd: arredondar(usdCom, 6), operacoes: opsCom },
    naoAtribuido: {
      usd: arredondar(usdSem, 6), operacoes: opsSem,
      linhas: linhasSem, volumeUsd: arredondar(volumeSem, 2),
    },
  };
}

const arredondar = (n: number, casas: number) => Number(n.toFixed(casas));
