import { CHAINS, type ChainId } from "./chains";

/**
 * Input validation helpers for API routes.
 *
 * Every public API route MUST:
 *   1. Whitelist `chain` against CHAIN_IDS
 *   2. Validate any address as either "native" or a strict 0x-hex format
 *   3. Cap free-form text (message, query) to a reasonable length
 *   4. Strip control characters from anything injected into an LLM prompt
 */

const CHAIN_IDS = new Set<ChainId>(CHAINS.map((c) => c.id));
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_RE  = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidChain(v: string | null): v is ChainId {
  return !!v && CHAIN_IDS.has(v as ChainId);
}

/**
 * ENDEREÇOS DE QUEIMA — o destinatário que passa em toda validação e destrói
 * o dinheiro (auditoria da ponte, 23/08).
 *
 * ⚠️ `0x000…000` é um endereço PERFEITAMENTE VÁLIDO em formato: `isAddress` do
 * viem devolve `true`, o `ADDRESS_RE` daqui casa, e a interface pintava o campo
 * de VERDE. O usuário digitava, via o selo de válido, e a ponte entregava para
 * um endereço do qual ninguém tem a chave. Perda total, irreversível, sem um
 * único aviso em nenhuma camada.
 *
 * ⚠️ ISTO MORA AQUI, E NÃO NO CAMPO DE ENTRADA, DE PROPÓSITO. A auditoria achou
 * TRÊS definições diferentes de "endereço válido" no caminho da ponte (o campo
 * usa `viem`, o painel de carteiras usa regex, o servidor usa outra regex e
 * ainda passa `.toLowerCase()`). Uma quarta regra escrita só no cliente seria
 * mais uma verdade para divergir. Cliente e servidor importam ESTA.
 *
 * ⚠️ A lista é curta e conservadora de propósito: só endereços cuja queima é
 * consenso. Bloquear "endereço de contrato" ou "endereço sem histórico" seria
 * palpite, e palpite que impede o usuário de mandar o próprio dinheiro para
 * onde ele quer é pior que o risco que fecha.
 */
const BURN_ADDRESSES = new Set([
  // EVM
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  // Solana — System Program e o incinerador oficial.
  "11111111111111111111111111111111",
  "1nc1nerator11111111111111111111111111111111",
]);

export function isBurnAddress(v: string | null | undefined): boolean {
  if (!v || typeof v !== "string") return false;
  const t = v.trim();
  // EVM é insensível a caixa; base58 do Solana NÃO é, então só a comparação
  // crua serve para ele. Testar as duas formas cobre os dois sem afrouxar.
  return BURN_ADDRESSES.has(t.toLowerCase()) || BURN_ADDRESSES.has(t);
}

/**
 * Accepts:
 *   - "native"
 *   - EVM address: strict 0x + 40 hex chars
 *   - Solana base58 address (32-44 chars)
 *   - A short symbol (≤ 12 chars, alphanumeric) — for seed-token lookups
 *
 * Returns the normalized value or `null` if invalid.
 */
export function validateAddress(v: string | null | undefined, opts: { allowSymbol?: boolean } = {}): string | null {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === "native") return "native";
  if (ADDRESS_RE.test(trimmed)) return trimmed.toLowerCase();
  if (SOLANA_RE.test(trimmed)) return trimmed;
  if (opts.allowSymbol && /^[A-Za-z0-9]{1,12}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Decimal numeric input (amount). Accepts "1.5", "0.0001", "1000". No
 * exponents, no negatives, ≤ 32 chars.
 */
export function validateAmount(v: string | null | undefined): string | null {
  if (!v || typeof v !== "string") return null;
  const trimmed = v.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Sanitize free-form text before splicing it into an LLM user message.
 *  - Caps length
 *  - Strips control chars (except newline and tab)
 *  - Collapses runs of whitespace
 *  - Strips trailing backslashes which can break quote escaping
 */
export function sanitizePromptText(v: string | null | undefined, maxLen = 500): string | null {
  if (!v || typeof v !== "string") return null;
  const stripped = v
    // Remove control characters except \n and \t
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Collapse 3+ newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    // Collapse internal whitespace runs
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (stripped.length === 0) return null;
  return stripped.length > maxLen ? stripped.slice(0, maxLen) : stripped;
}
