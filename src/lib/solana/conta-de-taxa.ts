/**
 * ⚠️⚠️ A CONTA DE TOKEN QUE RECEBE A TAXA NA SOLANA (16/10, L-061).
 *
 * Na Jupiter (Metis `/swap/v1`) a taxa é `platformFeeBps` na cotação + `feeAccount` no `/swap`,
 * e o `feeAccount` é uma CONTA DE TOKEN de um dos mints do par — não a carteira. A dona das
 * contas é `CARTEIRA_TAXA_SOLANA` (`tier/fees.ts`). Contas por mint:
 *
 *   · USDC → `SWAP_FEE_ACCOUNT_SOLANA_USDC` (padrão: a conta criada pelo dono, conferida em 16/10)
 *   · wSOL → `SWAP_FEE_ACCOUNT_SOLANA_WSOL` (padrão: a conta criada pelo dono, conferida em 16/10)
 *
 * Valor `off` numa das variáveis desliga a cobrança naquele mint sem deploy.
 *
 * Escolha por par: USDC se um dos lados é USDC; senão wSOL se um dos lados é SOL; senão nada.
 *
 * ⚠️ A CONTA É CONFERIDA NA REDE ANTES DE COBRAR. Se ela não existir (fechada para "recuperar
 * aluguel"), for de outro mint/dono, estiver congelada, ou o RPC falhar, a Jupiter recusaria o
 * swap — e o usuário ficaria sem trocar por causa de uma conta NOSSA. Então: sem taxa, swap
 * segue, e quem chama avisa o dono. Cache curto: o "ok" vale 10 min; a falha, 1 min.
 */
import { CARTEIRA_TAXA_SOLANA } from "@/lib/tier/fees";
import { rpcSolanaServidor } from "@/lib/solana/rpc-servidor";

export const MINT_USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const MINT_WSOL = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** Conta USDC criada pelo dono (16/10): mint USDC, dona `H7zw…`, inicializada — conferido na rede. */
export const CONTA_TAXA_SOLANA_USDC_PADRAO = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo";
/** Conta wSOL criada pelo dono (16/10): mint wSOL, dona `H7zw…`, inicializada — conferido na rede. */
export const CONTA_TAXA_SOLANA_WSOL_PADRAO = "7PPDQWck54V79XwgThz9hcPJQTwWbRT8aP4TV9iT5qFW";

const base58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const lerConta = (v: string | undefined, padrao: string | null) => {
  const s = (v ?? "").trim();
  if (!s) return padrao;
  if (/^off$/i.test(s)) return null;
  return base58.test(s) ? s : null;
};

export function contasDeTaxaSolana(): { usdc: string | null; wsol: string | null } {
  return {
    usdc: lerConta(process.env.SWAP_FEE_ACCOUNT_SOLANA_USDC, CONTA_TAXA_SOLANA_USDC_PADRAO),
    wsol: lerConta(process.env.SWAP_FEE_ACCOUNT_SOLANA_WSOL, CONTA_TAXA_SOLANA_WSOL_PADRAO),
  };
}

/** A conta para ESTE par, ou `null` (par sem USDC nem SOL, ou conta não configurada). */
export function escolherContaDeTaxa(inputMint: string, outputMint: string): { conta: string; mint: string } | null {
  const c = contasDeTaxaSolana();
  const tem = (m: string) => inputMint === m || outputMint === m;
  if (tem(MINT_USDC_SOLANA) && c.usdc) return { conta: c.usdc, mint: MINT_USDC_SOLANA };
  if (tem(MINT_WSOL) && c.wsol) return { conta: c.wsol, mint: MINT_WSOL };
  return null;
}

const cache = new Map<string, { ok: boolean; porque?: string; ate: number }>();
/** Só para testes. */
export function _limparCacheDeContas() { cache.clear(); }


/** A conta existe NA REDE, é do Token Program, do mint certo, da dona certa e não está congelada? */
export async function contaDeTaxaValida(conta: string, mint: string, agora = Date.now()): Promise<{ ok: true } | { ok: false; porque: string }> {
  const chave = `${conta}:${mint}`;
  const c = cache.get(chave);
  if (c && c.ate > agora) return c.ok ? { ok: true } : { ok: false, porque: c.porque ?? "?" };
  const guardar = (ok: boolean, porque?: string) => {
    cache.set(chave, { ok, porque, ate: agora + (ok ? 10 * 60_000 : 60_000) });
    return ok ? { ok: true as const } : { ok: false as const, porque: porque ?? "?" };
  };
  try {
    const res = await fetch(rpcSolanaServidor(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [conta, { encoding: "jsonParsed", commitment: "confirmed" }] }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return guardar(false, `RPC HTTP ${res.status}`);
    const j = await res.json() as { result?: { value?: { owner?: string; data?: { parsed?: { info?: { mint?: string; owner?: string; state?: string } } } } | null } };
    const v = j.result?.value;
    if (!v) return guardar(false, "conta não existe na rede (fechada?)");
    const i = v.data?.parsed?.info;
    if (v.owner !== TOKEN_PROGRAM || !i) return guardar(false, "não é conta de token SPL");
    if (i.mint !== mint) return guardar(false, `mint errado (${String(i.mint).slice(0, 6)}…)`);
    if (i.owner !== CARTEIRA_TAXA_SOLANA) return guardar(false, "dona não é a carteira de taxa da plataforma");
    if (i.state !== "initialized") return guardar(false, `estado ${i.state}`);
    return guardar(true);
  } catch (e) {
    return guardar(false, `RPC falhou: ${e instanceof Error ? e.message.slice(0, 80) : "erro"}`);
  }
}

/** Conta pronta para receber a taxa deste par, ou o motivo de não cobrar. */
export async function contaDeTaxaParaPar(
  inputMint: string, outputMint: string,
): Promise<{ conta: string; mint: string } | { conta: null; porque: string | null }> {
  const escolhida = escolherContaDeTaxa(inputMint, outputMint);
  if (!escolhida) return { conta: null, porque: null }; // par sem USDC/SOL: sem taxa, não é problema
  const v = await contaDeTaxaValida(escolhida.conta, escolhida.mint);
  return v.ok ? escolhida : { conta: null, porque: v.porque };
}
