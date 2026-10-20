/**
 * ⚠️⚠️ LEITURA DE SALDO SOLANA NO SERVIDOR (W1, 20/10/2026).
 *
 * CAUSA RAIZ do "Balance: —": o navegador lia saldo direto no RPC público
 * (`api.mainnet-beta.solana.com`, porque `NEXT_PUBLIC_SOLANA_RPC` não existe na Vercel) e esse
 * RPC devolve **HTTP 403 "Access forbidden" a TODA requisição com cabeçalho `Origin`** — que o
 * navegador sempre manda num POST entre domínios. Medido em 20/10: sem `Origin` → 200; com
 * `Origin` de qualquer site (até localhost) → 403; User-Agent e Referer não importam.
 *
 * Então a leitura vem para cá, no RPC do servidor (`rpcSolanaServidor()` — Helius, credencial só
 * no servidor). Isto NÃO é um proxy JSON-RPC: só dois métodos fixos (`getBalance` e
 * `getTokenAccountsByOwner` filtrado por mint), endereço e mint validados, resposta reduzida ao
 * número. A URL do RPC nunca sai daqui — nem em resposta, nem em log, nem em erro.
 *
 * ⚠️ ERRO NUNCA VIRA ZERO. "Nenhuma conta de token desse mint" é zero de verdade (a rede respondeu);
 * 403/429/timeout/queda é `erro` com o tipo — quem chama mostra "indisponível", não "0".
 */
import { PublicKey } from "@solana/web3.js";
import { rpcSolanaServidor } from "@/lib/solana/rpc-servidor";

export type TipoErroSaldo = "proibido" | "limite" | "timeout" | "conexao" | "rpc" | "resposta";

export type LeituraSaldo =
  | { ok: true; owner: string; mint: string; raw: string; decimals: number | null; contas: number; slot: number | null }
  | { ok: false; owner: string; mint: string; tipo: TipoErroSaldo; transitorio: boolean };

/** `native` = SOL (lamports). */
export const MINT_NATIVO = "native";
export const DECIMAIS_SOL = 9;
const TIMEOUT_MS = 5_000;
const CACHE_OK_MS = 10_000;
const CACHE_ERRO_MS = 2_000;

/** Endereço base58 que é uma chave pública Solana válida (32 bytes). */
export function chaveValida(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return false;
  try { return new PublicKey(s).toBase58() === s; } catch { return false; }
}

const transitorio = (t: TipoErroSaldo) => t === "limite" || t === "timeout" || t === "conexao" || t === "rpc";

class ErroRpc extends Error {
  constructor(readonly tipo: TipoErroSaldo) { super(tipo); }
}

async function chamar(method: string, params: unknown[]): Promise<{ result: unknown; texto: string }> {
  let res: Response;
  try {
    res = await fetch(rpcSolanaServidor(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const nome = (e as { name?: string })?.name;
    throw new ErroRpc(nome === "TimeoutError" || nome === "AbortError" ? "timeout" : "conexao");
  }
  if (res.status === 403 || res.status === 401) throw new ErroRpc("proibido");
  if (res.status === 429) throw new ErroRpc("limite");
  if (!res.ok) throw new ErroRpc("rpc");
  let j: { result?: unknown; error?: { code?: number } };
  let texto: string;
  try { texto = await res.text(); j = JSON.parse(texto); } catch { throw new ErroRpc("resposta"); }
  if (j.error) {
    const c = j.error.code;
    throw new ErroRpc(c === 403 ? "proibido" : c === 429 ? "limite" : "rpc");
  }
  if (j.result === undefined) throw new ErroRpc("resposta");
  return { result: j.result, texto };
}

async function lerAgora(owner: string, mint: string): Promise<LeituraSaldo> {
  try {
    if (mint === MINT_NATIVO) {
      const { result, texto } = await chamar("getBalance", [owner, { commitment: "confirmed" }]);
      const r = result as { context?: { slot?: number }; value?: unknown };
      // ⚠️ Lamports são u64: acima de 2^53 (~9 M SOL) o `JSON.parse` arredonda. O inteiro é lido do
      // TEXTO, dígito por dígito (visto no preview 20/10: carteira com 11.175.975.344.469.535 lamports).
      const exato = /"value"\s*:\s*(\d+)\s*[,}]/.exec(texto.slice(texto.indexOf('"result"')))?.[1];
      if (typeof r?.value !== "number" || r.value < 0 || !exato) throw new ErroRpc("resposta");
      return { ok: true, owner, mint, raw: BigInt(exato).toString(), decimals: DECIMAIS_SOL, contas: 1, slot: r.context?.slot ?? null };
    }
    // Filtro por MINT: pega contas do Token Program E do Token-2022, e todas as contas do mesmo
    // mint (ATA + contas auxiliares) — o saldo é a SOMA, em inteiro.
    const { result } = await chamar("getTokenAccountsByOwner",
      [owner, { mint }, { commitment: "confirmed", encoding: "jsonParsed" }]);
    const r = result as { context?: { slot?: number }; value?: unknown };
    if (!Array.isArray(r?.value)) throw new ErroRpc("resposta");
    let total = 0n;
    let decimals: number | null = null;
    for (const conta of r.value as { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } } }[]) {
      const info = conta?.account?.data?.parsed?.info;
      const amount = info?.tokenAmount?.amount;
      if (info?.mint !== mint || typeof amount !== "string" || !/^\d+$/.test(amount)) throw new ErroRpc("resposta");
      total += BigInt(amount);
      if (typeof info.tokenAmount?.decimals === "number") decimals = info.tokenAmount.decimals;
    }
    return { ok: true, owner, mint, raw: total.toString(), decimals, contas: r.value.length, slot: r.context?.slot ?? null };
  } catch (e) {
    const tipo = e instanceof ErroRpc ? e.tipo : "resposta";
    return { ok: false, owner, mint, tipo, transitorio: transitorio(tipo) };
  }
}

// Cache curto + deduplicação de leituras simultâneas (Swap, Portfólio e chip pedem o mesmo saldo).
const cache = new Map<string, { leitura: LeituraSaldo; ate: number }>();
const emVoo = new Map<string, Promise<LeituraSaldo>>();
/** Só para testes. */
export function _limparCacheDeSaldos() { cache.clear(); emVoo.clear(); }

/** Saldo de `owner` em `mint` (`native` = SOL). Valide os dois com `chaveValida` antes. */
export async function lerSaldoSolana(owner: string, mint: string, agora = Date.now()): Promise<LeituraSaldo> {
  const chave = `${owner}:${mint}`;
  const c = cache.get(chave);
  if (c && c.ate > agora) return c.leitura;
  const voando = emVoo.get(chave);
  if (voando) return voando;
  const p = lerAgora(owner, mint).then((leitura) => {
    cache.set(chave, { leitura, ate: Date.now() + (leitura.ok ? CACHE_OK_MS : CACHE_ERRO_MS) });
    if (cache.size > 5_000) cache.delete(cache.keys().next().value as string);
    return leitura;
  }).finally(() => emVoo.delete(chave));
  emVoo.set(chave, p);
  return p;
}
