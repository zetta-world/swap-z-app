import { createHmac } from "node:crypto";

/**
 * PSEUDÔNIMOS DO EARLY ACCESS — HMAC-SHA256 com segredo de servidor.
 *
 * ⚠️ POR QUE NÃO SHA-256 PURO (como o `cid` do beacon). Um SHA-256 sem segredo
 * de um IPv4 se desfaz por força bruta: são 2³² entradas, uma GPU varre em
 * minutos. Com HMAC, quem tiver o banco e não tiver o segredo não reverte nada.
 *
 * ⚠️ E POR QUE NÃO `prefixo:${getClientId(...)}`. É o padrão das outras rotas,
 * e ele grava o IP LITERAL em `rate_limits.bucket` (achado lateral do
 * discovery, §8.3). Aqui o IP nunca chega ao banco — nem no bucket, nem na
 * linha da inscrição.
 *
 * Separação de domínio: o HMAC do IP e o do email usam prefixos diferentes,
 * para que um valor nunca colida com o outro nem possa ser trocado de lugar.
 *
 * Sem segredo VÁLIDO configurado → `null`, e quem chama NÃO aceita a inscrição.
 */
/** Bytes mínimos DEPOIS de decodificar o base64. */
export const SEGREDO_MIN_BYTES = 32;
/** Bytes distintos mínimos: barra segredo "longo" mas trivial (ex.: "a"×44). */
export const SEGREDO_MIN_DISTINTOS = 16;

/**
 * F-10 da auditoria adversarial: "32 caracteres" aceitava `"a".repeat(32)`.
 *
 * FORMATO OPERACIONAL ÚNICO: `EARLY_ACCESS_HMAC_SECRET` é **base64 padrão
 * canônico** de pelo menos 32 bytes aleatórios — gerado com
 * `openssl rand -base64 48` (docs/RUNBOOK.md). Recusa:
 *   · o que não é base64 válido (ou não volta igual ao recodificar);
 *   · menos de 32 bytes decodificados;
 *   · bytes com variedade trivial (< 16 valores distintos).
 *
 * A CHAVE do HMAC são os bytes decodificados, não o texto.
 */
export function decodificarSegredo(s: string | undefined | null): Buffer | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (t.length === 0 || t.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(t)) return null;
  const bytes = Buffer.from(t, "base64");
  // canônico: decodificar e recodificar devolve o mesmo texto
  if (bytes.toString("base64") !== t) return null;
  if (bytes.length < SEGREDO_MIN_BYTES) return null;
  if (new Set(bytes).size < SEGREDO_MIN_DISTINTOS) return null;
  return bytes;
}

function segredo(): Buffer | null {
  return decodificarSegredo(process.env.EARLY_ACCESS_HMAC_SECRET);
}

export function segredoConfigurado(): boolean {
  return segredo() !== null;
}

/** Hex de 32 caracteres (128 bits) — o formato que o CHECK de 0068 exige. */
function hmac(dominio: "ip" | "email", valor: string): string | null {
  const s = segredo();
  if (!s) return null;
  return createHmac("sha256", s).update(`zswap-ea:${dominio}\u0000${valor}`).digest("hex").slice(0, 32);
}

export function ipHmac(ip: string): string | null {
  return hmac("ip", ip);
}

/** Recebe o email JÁ normalizado. */
export function emailHmac(emailNormalizado: string): string | null {
  return hmac("email", emailNormalizado);
}
