/**
 * ⚠️⚠️ W3-D — RECONCILIAÇÃO FINANCEIRA DE OPERAÇÕES SOLANA PELA ASSINATURA PÚBLICA (21/10/2026).
 *
 * O navegador DECLARA `status`, volume e taxa em `/api/operations/record`. Nada disso é receita
 * comprovada. Aqui o SERVIDOR busca a transação na rede e mede:
 *   · existe e `meta.err === null` (pousou SEM erro) — senão `divergente: falhou_na_rede`;
 *   · invocou a Jupiter v6 — senão `divergente: nao_e_swap_jupiter`;
 *   · o pagador (1ª conta, assinante) é a carteira de ORIGEM do registro — senão `divergente: pagador`;
 *   · a taxa: delta POSITIVO de saldo nas contas de taxa da plataforma (pré/pós da própria transação).
 *     Taxa declarada (> 0) que não chegou → `divergente: taxa_declarada_nao_recebida`.
 *
 * ⚠️ Separação de dimensões: isto decide o ESTADO FINANCEIRO. A identidade (sessão) é outra coluna e
 * não é alterada aqui; `pagador_onchain` só registra o que a rede diz.
 * ⚠️ Nada é inventado: transação não encontrada fica `aguardando` (até o prazo — ver `PRAZO_SEM_REGISTRO_MS`).
 */
import { rpcSolanaServidor } from "@/lib/solana/rpc-servidor";
import { contasDeTaxaSolana } from "@/lib/solana/conta-de-taxa";

const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/** Sem registro na rede depois disso, a alegação "confirmada" é divergente (o blockhash venceu há muito). */
export const PRAZO_SEM_REGISTRO_MS = 24 * 60 * 60_000;

export type Verificacao =
  | { verificacao: "verificada_onchain"; pagador: string; taxaRaw: string; taxaMint: string | null; motivo?: string }
  | { verificacao: "divergente"; motivo: string; pagador: string | null }
  | { verificacao: "aguardando"; motivo: string };

interface TokenBal { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }
export interface TxParseada {
  meta: { err: unknown; preTokenBalances?: TokenBal[] | null; postTokenBalances?: TokenBal[] | null } | null;
  transaction: { message: {
    accountKeys: { pubkey: string; signer?: boolean }[];
    instructions: { programId: string }[];
  } };
}

const bigOuZero = (s: string | undefined) => { try { return s ? BigInt(s) : 0n; } catch { return 0n; } };

/** Decisão pura sobre a transação já lida (testável sem rede). */
export function avaliarTransacao(
  tx: TxParseada | null,
  esperado: { carteira: string | null; taxaDeclarada: boolean },
  contasDeTaxa: readonly string[],
): Verificacao {
  if (!tx) return { verificacao: "aguardando", motivo: "sem_registro" };
  if (!tx.meta) return { verificacao: "aguardando", motivo: "sem_meta" };
  const chaves = tx.transaction.message.accountKeys;
  const pagador = chaves[0]?.pubkey ?? null;
  // ⚠️ SUCESSO SÓ COM `err === null` EXPLÍCITO.
  if (!("err" in tx.meta) || tx.meta.err === undefined) return { verificacao: "aguardando", motivo: "meta_incompleta" };
  if (tx.meta.err !== null) return { verificacao: "divergente", motivo: "falhou_na_rede", pagador };
  if (!tx.transaction.message.instructions.some((i) => i.programId === JUPITER_V6)) {
    return { verificacao: "divergente", motivo: "nao_e_swap_jupiter", pagador };
  }
  if (!pagador || chaves[0]?.signer !== true) return { verificacao: "divergente", motivo: "pagador_ilegivel", pagador };
  if (esperado.carteira && pagador !== esperado.carteira) return { verificacao: "divergente", motivo: "pagador", pagador };

  let total = 0n;
  let mint: string | null = null;
  for (const conta of contasDeTaxa) {
    const i = chaves.findIndex((k) => k.pubkey === conta);
    if (i < 0) continue;
    const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === i);
    const pos = tx.meta.postTokenBalances?.find((b) => b.accountIndex === i);
    /**
     * ⚠️ PAGADOR = DONO DA CONTA DE TAXA (o dono da plataforma operando a própria carteira): a conta de
     * taxa é também a conta de token DELE, então o delta inclui o resultado do swap — não mede taxa.
     * E economicamente não há receita: o dinheiro sai e volta para o mesmo dono. Receita verificada = 0.
     */
    if ((pos?.owner ?? pre?.owner) === pagador) {
      return { verificacao: "verificada_onchain", pagador, taxaRaw: "0", taxaMint: null, motivo: "pagador_e_dono_da_conta_de_taxa" };
    }
    const delta = bigOuZero(pos?.uiTokenAmount.amount) - bigOuZero(pre?.uiTokenAmount.amount);
    if (delta > 0n) { total += delta; mint = pos?.mint ?? pre?.mint ?? mint; }
  }
  if (total === 0n && esperado.taxaDeclarada) {
    return { verificacao: "divergente", motivo: "taxa_declarada_nao_recebida", pagador };
  }
  return { verificacao: "verificada_onchain", pagador, taxaRaw: total.toString(), taxaMint: total > 0n ? mint : null };
}

/** Lê a transação no RPC do SERVIDOR. `null` = não encontrada; lança em falha de rede/RPC. */
export async function lerTransacao(assinatura: string, timeoutMs = 5_000): Promise<TxParseada | null> {
  const res = await fetch(rpcSolanaServidor(), {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction",
      params: [assinatura, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await res.json().catch(() => null) as { result?: TxParseada | null; error?: unknown } | null;
  if (!res.ok || !j || j.error || !("result" in j)) throw new Error(`rpc_${res.status}`);
  return j.result ?? null;
}

/** Verifica uma assinatura. Falha de RPC → `aguardando` (nunca vira verificada nem divergente por acidente). */
export async function verificarOperacaoSolana(
  assinatura: string,
  esperado: { carteira: string | null; taxaDeclarada: boolean; criadaEm?: number },
  deps: { ler?: typeof lerTransacao; agora?: number } = {},
): Promise<Verificacao> {
  let tx: TxParseada | null;
  try { tx = await (deps.ler ?? lerTransacao)(assinatura); }
  catch { return { verificacao: "aguardando", motivo: "rpc_indisponivel" }; }
  const c = contasDeTaxaSolana();
  const v = avaliarTransacao(tx, esperado, [c.usdc, c.wsol].filter((x): x is string => !!x));
  const agora = deps.agora ?? Date.now();
  if (v.verificacao === "aguardando" && v.motivo === "sem_registro"
      && esperado.criadaEm !== undefined && agora - esperado.criadaEm > PRAZO_SEM_REGISTRO_MS) {
    return { verificacao: "divergente", motivo: "sem_registro_onchain", pagador: null };
  }
  return v;
}

/** Colunas a gravar em `operations` para o resultado. */
export function colunasDaVerificacao(v: Verificacao, agoraIso = new Date().toISOString()) {
  if (v.verificacao === "verificada_onchain") {
    return { verificacao: v.verificacao, verificacao_motivo: v.motivo ?? null, verificada_em: agoraIso,
      pagador_onchain: v.pagador, taxa_onchain_raw: v.taxaRaw, taxa_onchain_mint: v.taxaMint };
  }
  if (v.verificacao === "divergente") {
    return { verificacao: v.verificacao, verificacao_motivo: v.motivo, verificada_em: agoraIso, pagador_onchain: v.pagador };
  }
  return { verificacao: v.verificacao, verificacao_motivo: v.motivo };
}
