/**
 * ESQUEMA DE TELEMETRIA DA VENDA — sem PII, sem segredo.
 *
 * Cada evento tem uma lista FECHADA de campos permitidos com tipo. Campo
 * desconhecido é recusado (não ignorado): é assim que um endereço de carteira,
 * email ou assinatura não escorrega para a telemetria por engano. Carteira só
 * entra como `carteira_hash` (hash com sal do servidor, gerado fora daqui).
 */
export const EVENTOS = [
  "wallet_connected", "eligibility_checked", "allowlist_verified", "sale_state_viewed",
  "mint_intent_created", "wallet_prompted", "tx_submitted", "tx_confirmed", "tx_failed",
  "sold_out_seen", "admin_pause_requested",
] as const;
export type NomeEvento = (typeof EVENTOS)[number];

type TipoCampo = "string_curta" | "inteiro" | "booleano" | "hash" | "enum_estado";
const COMUNS: Record<string, TipoCampo> = { sessao: "hash", em_ms: "inteiro" };
const CAMPOS: Record<NomeEvento, Record<string, TipoCampo>> = {
  wallet_connected:      { carteira_hash: "hash", tipo_carteira: "string_curta" },
  eligibility_checked:   { carteira_hash: "hash", resultado: "string_curta", snapshot_id: "hash" },
  allowlist_verified:    { carteira_hash: "hash", prova_valida: "booleano", versao_prova: "inteiro" },
  sale_state_viewed:     { estado_ui: "enum_estado" },
  mint_intent_created:   { carteira_hash: "hash", unidades: "inteiro", intencao_hash: "hash" },
  wallet_prompted:       { intencao_hash: "hash" },
  tx_submitted:          { intencao_hash: "hash", tx_hash_ref: "hash" },
  tx_confirmed:          { intencao_hash: "hash", tx_hash_ref: "hash", duracao_ms: "inteiro" },
  tx_failed:             { intencao_hash: "hash", codigo: "string_curta" },
  sold_out_seen:         { estado_ui: "enum_estado" },
  admin_pause_requested: { pedido_id: "hash" },
};

const ESTADOS_UI = new Set([
  "COMING_SOON", "ALLOWLIST_CHECK", "ELIGIBLE", "NOT_ELIGIBLE", "SALE_NOT_STARTED", "SALE_ACTIVE",
  "PAUSED", "SOLD_OUT", "ENDED", "TRANSACTION_PREPARING", "WALLET_CONFIRMATION",
  "TRANSACTION_PENDING", "TRANSACTION_CONFIRMED", "TRANSACTION_FAILED",
]);

/** Padrões que NUNCA podem aparecer como valor: email, endereço EVM, base58 longo, chaves. */
const PII = [
  /[^\s@]+@[^\s@]+\.[^\s@]+/,           // email
  /\b0x[0-9a-fA-F]{40}\b/,               // endereço EVM
  /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,     // base58 (endereço/assinatura Solana)
  /\b(sk|re|whsec|eyJ)[_A-Za-z0-9-]{10,}/, // segredos/JWT
];

export type EventoTelemetria = { nome: NomeEvento } & Record<string, string | number | boolean>;

export function validarEvento(e: unknown): { ok: true; evento: EventoTelemetria } | { ok: false; erro: string } {
  if (!e || typeof e !== "object") return { ok: false, erro: "nao_objeto" };
  const o = e as Record<string, unknown>;
  const nome = o.nome;
  if (typeof nome !== "string" || !(EVENTOS as readonly string[]).includes(nome)) return { ok: false, erro: "evento_desconhecido" };
  const permitidos = { ...COMUNS, ...CAMPOS[nome as NomeEvento] };
  for (const [k, v] of Object.entries(o)) {
    if (k === "nome") continue;
    const t = permitidos[k];
    if (!t) return { ok: false, erro: `campo_nao_permitido:${k}` };
    if (t === "inteiro" && !(Number.isInteger(v) && (v as number) >= 0)) return { ok: false, erro: `tipo:${k}` };
    if (t === "booleano" && typeof v !== "boolean") return { ok: false, erro: `tipo:${k}` };
    if (t === "hash" && !(typeof v === "string" && /^([0-9a-f]{16}|[0-9a-f]{64})$/.test(v))) return { ok: false, erro: `tipo:${k}` };
    if (t === "enum_estado" && !(typeof v === "string" && ESTADOS_UI.has(v))) return { ok: false, erro: `tipo:${k}` };
    if (t === "string_curta" && !(typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v))) return { ok: false, erro: `tipo:${k}` };
    if (typeof v === "string" && PII.some((r) => r.test(v)) && t !== "hash") return { ok: false, erro: `pii:${k}` };
  }
  return { ok: true, evento: o as EventoTelemetria };
}
