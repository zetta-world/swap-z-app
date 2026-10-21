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

/**
 * ⚠️⚠️ W3-D (21/10) — DUAS DIMENSÕES, SEM MISTURA.
 *
 *   ESTADO FINANCEIRO (`verificacao`): o que a REDE confirmou (`verificada_onchain`, com a taxa
 *   MEDIDA na conta de taxa) × `aguardando` × `divergente` × `declarada` (só alegação do navegador).
 *   IDENTIDADE: origem comprovada pela rede (`pagador_onchain`) × autenticada (sessão = origem,
 *   `wallet_address`) × não atribuída.
 *
 * Uma operação pode ser "autenticada" e financeiramente "declarada" (EVM, CEX), ou "verificada" e
 * sem sessão (a rede provou o pagador mesmo sem cookie). Somar uma dimensão pela outra é o erro.
 */
export interface LinhaVerificavel extends LinhaDeOperacao {
  verificacao?: string | null;
  verificacao_motivo?: string | null;
  pagador_onchain?: string | null;
  taxa_onchain_raw?: number | string | null;
  taxa_onchain_mint?: string | null;
}

export const MINT_USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MINT_WSOL = "So11111111111111111111111111111111111111112";

export interface ResumoVerificacao {
  financeiro: {
    verificada: { operacoes: number; taxaUsdc: number; taxaWsolLamports: string; outrosMints: number; autoTaxa: number };
    aguardando: number;
    divergente: { operacoes: number; motivos: Record<string, number> };
    /** Alegação: soma do que o navegador DISSE ter retido nas linhas não verificadas. */
    declarada: { operacoes: number; taxaDeclaradaUsd: number };
  };
  identidade: { origemComprovada: number; autenticada: number; naoAtribuida: number };
}

export function resumirVerificacao(linhas: readonly LinhaVerificavel[]): ResumoVerificacao {
  const r: ResumoVerificacao = {
    financeiro: {
      verificada: { operacoes: 0, taxaUsdc: 0, taxaWsolLamports: "0", outrosMints: 0, autoTaxa: 0 },
      aguardando: 0, divergente: { operacoes: 0, motivos: {} }, declarada: { operacoes: 0, taxaDeclaradaUsd: 0 },
    },
    identidade: { origemComprovada: 0, autenticada: 0, naoAtribuida: 0 },
  };
  let usdcRaw = 0n, wsol = 0n;
  for (const l of linhas) {
    const v = l.verificacao ?? "declarada";
    if (v === "verificada_onchain") {
      r.financeiro.verificada.operacoes += 1;
      if (l.verificacao_motivo === "pagador_e_dono_da_conta_de_taxa") r.financeiro.verificada.autoTaxa += 1;
      let raw = 0n;
      try { raw = BigInt(String(l.taxa_onchain_raw ?? "0").split(".")[0]); } catch { raw = 0n; }
      if (raw > 0n) {
        if (l.taxa_onchain_mint === MINT_USDC) usdcRaw += raw;
        else if (l.taxa_onchain_mint === MINT_WSOL) wsol += raw;
        else r.financeiro.verificada.outrosMints += 1;
      }
    } else if (v === "aguardando") {
      r.financeiro.aguardando += 1;
    } else if (v === "divergente") {
      r.financeiro.divergente.operacoes += 1;
      const m = l.verificacao_motivo ?? "?";
      r.financeiro.divergente.motivos[m] = (r.financeiro.divergente.motivos[m] ?? 0) + 1;
    } else {
      r.financeiro.declarada.operacoes += 1;
      const t = taxaDe(l);
      if (t !== null) r.financeiro.declarada.taxaDeclaradaUsd += t;
    }
    if (typeof l.pagador_onchain === "string" && l.pagador_onchain) r.identidade.origemComprovada += 1;
    else if (temIdentidadeAssinada(l)) r.identidade.autenticada += 1;
    else r.identidade.naoAtribuida += 1;
  }
  r.financeiro.verificada.taxaUsdc = Number(usdcRaw) / 1e6;
  r.financeiro.verificada.taxaWsolLamports = wsol.toString();
  r.financeiro.declarada.taxaDeclaradaUsd = Number(r.financeiro.declarada.taxaDeclaradaUsd.toFixed(6));
  return r;
}
