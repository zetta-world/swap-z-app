/**
 * ⚠️⚠️ TRANSMISSÃO E STATUS DE TRANSAÇÕES SOLANA PELO SERVIDOR (W3, 21/10/2026).
 *
 * CAUSA RAIZ do "403 Access forbidden" no swap: o navegador enviava (`sendRawTransaction`) e
 * confirmava (`confirmTransaction`) pelo RPC público, que recusa com 403 NA PORTA toda requisição
 * com `Origin` — antes de ler o corpo (medido 21/10: `sendTransaction` com corpo inválido → 403
 * com Origin; sem Origin o RPC chega a desserializar e recusa o conteúdo). A transação assinada
 * na Phantom nunca foi transmitida (`H7zw…` sem nenhuma transação desde 16/10).
 *
 * NÃO-CUSTODIAL: o servidor só recebe bytes JÁ ASSINADOS pela carteira. Não existe chave aqui,
 * nem assinatura, nem alteração da mensagem — qualquer byte mudado invalida a assinatura, e é por
 * isso que ela é conferida (ed25519) antes de transmitir.
 *
 * NÃO É PROXY: só `sendTransaction` de uma transação v0 assinada, ≤ 1232 bytes, cujo pagador é a
 * carteira declarada e que invoca a Jupiter v6 só com programas permitidos; e `getSignatureStatuses`
 * + `getBlockHeight` para uma assinatura. A URL/credencial do RPC nunca sai daqui.
 *
 * ⚠️ HTTP ERRADO NÃO É "NÃO ENVIOU". O resultado do envio é um de três:
 *   · `enviada`     — o RPC aceitou e devolveu a assinatura;
 *   · `nao_enviada` — recusa CERTA antes de transmitir (porta 401/403/429, preflight, assinatura);
 *   · `incerta`     — timeout, queda, 5xx, resposta ilegível: PODE ter sido transmitida. Quem chama
 *                     consulta o status antes de qualquer nova tentativa.
 */
import { createPublicKey, verify } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { rpcSolanaServidor } from "@/lib/solana/rpc-servidor";
import { JUPITER_ALLOWED_PROGRAMS } from "@/lib/swap/solana-guard";
import { assinaturaDe, base58, deBase58 } from "@/lib/solana/assinatura";

export const MAX_BYTES_TX = 1232;
const JUPITER_V6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
/**
 * Programas que a CARTEIRA pode acrescentar depois que montamos a transação (ex.: asserções de
 * segurança). VAZIO de propósito: nenhum foi observado ainda num swap real assinado pela Phantom, e
 * um ID não verificado aqui seria uma porta aberta. Se a carteira inserir um programa, o servidor
 * RECUSA sem transmitir (nada sai da carteira) e loga QUAL programa — aí ele entra aqui com evidência.
 */
export const PROGRAMAS_DE_CARTEIRA: Record<string, string> = {};
const TIMEOUT_ENVIO_MS = 10_000;
const TIMEOUT_STATUS_MS = 5_000;

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

export { base58, assinaturaDe };

/** Assinatura Solana bem formada: base58 que decodifica em EXATAMENTE 64 bytes. */
export const assinaturaValidaFormato = (s: unknown): s is string =>
  typeof s === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s) && deBase58(s)?.length === 64;

export type Validacao =
  | { ok: true; tx: VersionedTransaction; bytes: Buffer; assinatura: string }
  | { ok: false; motivo: string };

/**
 * A transação recebida pode ser transmitida? Só se for EXATAMENTE uma transação v0 assinada pela
 * carteira `owner` (pagador), com todas as assinaturas exigidas válidas, invocando a Jupiter v6 e
 * nada fora dos programas permitidos.
 */
export function validarTransacaoAssinada(base64: unknown, owner: unknown): Validacao {
  if (typeof base64 !== "string" || base64.length === 0 || base64.length > Math.ceil(MAX_BYTES_TX / 3) * 4 + 4) {
    return { ok: false, motivo: "tamanho" };
  }
  if (typeof owner !== "string") return { ok: false, motivo: "owner" };
  let dono: PublicKey;
  try { dono = new PublicKey(owner); } catch { return { ok: false, motivo: "owner" }; }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_BYTES_TX || bytes.toString("base64") !== base64.replace(/\s/g, "")) {
    return { ok: false, motivo: "formato" };
  }
  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(bytes); } catch { return { ok: false, motivo: "formato" }; }
  if (tx.version !== 0) return { ok: false, motivo: "versao" };

  const msg = tx.message;
  const exigidas = msg.header.numRequiredSignatures;
  if (exigidas < 1 || tx.signatures.length !== exigidas) return { ok: false, motivo: "assinaturas" };
  if (!msg.staticAccountKeys[0]?.equals(dono)) return { ok: false, motivo: "pagador" };

  // Todas as assinaturas exigidas presentes E válidas sobre a mensagem serializada.
  const corpo = Buffer.from(msg.serialize());
  for (let i = 0; i < exigidas; i++) {
    const sig = tx.signatures[i];
    if (!sig || sig.every((b) => b === 0)) return { ok: false, motivo: "nao_assinada" };
    const chave = createPublicKey({ key: Buffer.concat([SPKI_ED25519, msg.staticAccountKeys[i].toBuffer()]), format: "der", type: "spki" });
    if (!verify(null, corpo, chave, Buffer.from(sig))) return { ok: false, motivo: "assinatura_invalida" };
  }

  // Programas: os invocados são sempre chaves estáticas (o guard do navegador depende disso também).
  const programas = new Set<string>();
  for (const ix of msg.compiledInstructions) {
    const p = msg.staticAccountKeys[ix.programIdIndex];
    if (!p) return { ok: false, motivo: "programa_em_alt" };
    programas.add(p.toBase58());
  }
  if (!programas.has(JUPITER_V6)) return { ok: false, motivo: "sem_jupiter" };
  for (const p of programas) {
    if (!(p in JUPITER_ALLOWED_PROGRAMS) && !(p in PROGRAMAS_DE_CARTEIRA)) return { ok: false, motivo: `programa_nao_permitido:${p}` };
  }
  return { ok: true, tx, bytes, assinatura: assinaturaDe(tx) };
}

export type ResultadoEnvio =
  | { estado: "enviada"; assinatura: string }
  | { estado: "nao_enviada"; assinatura: string; motivo: string; transitorio: boolean }
  | { estado: "incerta"; assinatura: string; motivo: string };

async function rpc(method: string, params: unknown[], timeoutMs: number): Promise<
  { tipo: "ok"; result: unknown } | { tipo: "erro_rpc"; code: number | null; mensagem: string; data: unknown }
  | { tipo: "http"; status: number } | { tipo: "rede"; timeout: boolean } | { tipo: "ilegivel" }> {
  let res: Response;
  try {
    res = await fetch(rpcSolanaServidor(), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
    });
  } catch (e) {
    const nome = (e as { name?: string })?.name;
    return { tipo: "rede", timeout: nome === "TimeoutError" || nome === "AbortError" };
  }
  let j: { result?: unknown; error?: { code?: number; message?: string; data?: unknown } } | null = null;
  try { j = await res.json(); } catch { j = null; }
  if (j?.error) return { tipo: "erro_rpc", code: typeof j.error.code === "number" ? j.error.code : null, mensagem: String(j.error.message ?? "").slice(0, 160), data: j.error.data };
  if (!res.ok) return { tipo: "http", status: res.status };
  if (!j || !("result" in j)) return { tipo: "ilegivel" };
  return { tipo: "ok", result: j.result };
}

/**
 * Transmite UMA vez (sem retry interno: repetir é decisão de quem chama, depois de consultar o
 * status). Preflight LIGADO — uma transação que falharia é recusada antes de ir à rede.
 */
export async function transmitir(v: Extract<Validacao, { ok: true }>): Promise<ResultadoEnvio> {
  const { assinatura } = v;
  const r = await rpc("sendTransaction", [v.bytes.toString("base64"),
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 }], TIMEOUT_ENVIO_MS);
  if (r.tipo === "ok") {
    return r.result === assinatura ? { estado: "enviada", assinatura }
      : { estado: "incerta", assinatura, motivo: "assinatura_divergente" };
  }
  if (r.tipo === "http") {
    // Porta do RPC recusou antes de ler o corpo (medido 21/10 para 403); 429 idem.
    if (r.status === 401 || r.status === 403) return { estado: "nao_enviada", assinatura, motivo: "proibido", transitorio: false };
    if (r.status === 429) return { estado: "nao_enviada", assinatura, motivo: "limite", transitorio: true };
    return { estado: "incerta", assinatura, motivo: `http_${r.status}` };
  }
  if (r.tipo === "erro_rpc") {
    if (r.code === 403 || r.code === 401) return { estado: "nao_enviada", assinatura, motivo: "proibido", transitorio: false };
    if (r.code === 429) return { estado: "nao_enviada", assinatura, motivo: "limite", transitorio: true };
    // -32002 preflight falhou · -32003 assinatura · -32602 parâmetros · -32005 nó atrasado:
    // o nó recusou ANTES de repassar — certo que não foi à rede.
    if (r.code === -32002) return { estado: "nao_enviada", assinatura, motivo: `simulacao: ${resumoSimulacao(r.data, r.mensagem)}`, transitorio: false };
    if (r.code === -32003 || r.code === -32602) return { estado: "nao_enviada", assinatura, motivo: "rejeitada_pelo_no", transitorio: false };
    if (r.code === -32005) return { estado: "nao_enviada", assinatura, motivo: "no_indisponivel", transitorio: true };
    return { estado: "incerta", assinatura, motivo: `rpc_${r.code ?? "?"}` };
  }
  if (r.tipo === "rede") return { estado: "incerta", assinatura, motivo: r.timeout ? "timeout" : "conexao" };
  return { estado: "incerta", assinatura, motivo: "resposta_ilegivel" };
}

function resumoSimulacao(data: unknown, mensagem: string): string {
  const err = (data as { err?: unknown })?.err;
  return (err ? JSON.stringify(err) : mensagem).slice(0, 120);
}

export type EstadoOnChain =
  | { estado: "confirmada"; slot: number; confirmacao: string }
  | { estado: "falhou_na_rede"; slot: number; erro: string }
  | { estado: "pendente"; alturaAtual: number | null }
  | { estado: "expirada"; alturaAtual: number }
  | { estado: "desconhecido"; motivo: string };

/**
 * Onde está a transação? ⚠️ "Confirmada" só com `err === null`; pousou com erro = falhou na rede.
 * Sem registro: se a altura de bloco já passou de `lastValidBlockHeight`, ela NÃO pode mais pousar
 * (expirada — seguro tentar de novo, com nova assinatura); senão ainda pode (pendente).
 */
export async function consultarStatus(assinatura: string, lastValidBlockHeight: number | null): Promise<EstadoOnChain> {
  const s = await rpc("getSignatureStatuses", [[assinatura], { searchTransactionHistory: true }], TIMEOUT_STATUS_MS);
  if (s.tipo !== "ok") return { estado: "desconhecido", motivo: s.tipo === "http" ? `http_${s.status}` : s.tipo === "rede" ? (s.timeout ? "timeout" : "conexao") : s.tipo };
  const v = (s.result as { value?: unknown[] })?.value?.[0] as { slot?: number; err?: unknown; confirmationStatus?: string | null } | null | undefined;
  if (v && typeof v.slot === "number") {
    if (v.err) return { estado: "falhou_na_rede", slot: v.slot, erro: JSON.stringify(v.err).slice(0, 160) };
    if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") {
      return { estado: "confirmada", slot: v.slot, confirmacao: v.confirmationStatus };
    }
    return { estado: "pendente", alturaAtual: null }; // "processed": ainda pode ser descartada
  }
  if (v !== null && v !== undefined) return { estado: "desconhecido", motivo: "resposta_ilegivel" };
  const h = await rpc("getBlockHeight", [{ commitment: "confirmed" }], TIMEOUT_STATUS_MS);
  if (h.tipo !== "ok" || typeof h.result !== "number") return { estado: "pendente", alturaAtual: null };
  if (lastValidBlockHeight !== null && h.result > lastValidBlockHeight) return { estado: "expirada", alturaAtual: h.result };
  return { estado: "pendente", alturaAtual: h.result };
}
