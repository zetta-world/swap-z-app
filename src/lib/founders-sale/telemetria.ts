import { ESTADOS_UI } from "./visao";
/**
 * ESQUEMA DE TELEMETRIA DA VENDA — sem PII, sem segredo.
 *
 * Cada evento tem uma lista FECHADA de campos permitidos com tipo. Campo
 * desconhecido é recusado (não ignorado): é assim que um endereço de carteira,
 * email ou assinatura não escorrega para a telemetria por engano. Carteira só
 * entra como `carteira_hash` (hash com sal do servidor, gerado fora daqui).
 */
export const EVENTOS = [
  "founders_page_view", "tier_view", "whitelist_start", "whitelist_complete", "email_verified",
  "wallet_connected", "wallet_signed", "eligibility_checked", "tier_preference_selected", "sale_status_view",
  "purchase_intent", "wallet_prompt", "tx_submitted", "tx_confirmed", "tx_failed", "sold_out_view",
  "post_purchase_onboarding",
  // operacionais (já existiam)
  "allowlist_verified", "admin_pause_requested",
] as const;
export type NomeEvento = (typeof EVENTOS)[number];

type TipoCampo = "string_curta" | "inteiro" | "booleano" | "hash" | "enum_estado" | "tier";
const COMUNS: Record<string, TipoCampo> = { sessao: "hash", em_ms: "inteiro" };
/**
 * Identificadores são PSEUDÔNIMOS: `carteira_hash`, `inscricao_hash`, `intencao_hash` = hash com sal do servidor
 * (gerado fora daqui). E-mail e endereço crus são recusados pelo filtro de PII.
 */
const CAMPOS: Record<NomeEvento, Record<string, TipoCampo>> = {
  founders_page_view:       { pagina: "string_curta", idioma: "string_curta", origem: "string_curta" },
  tier_view:                { tier: "tier" },
  whitelist_start:          { origem: "string_curta" },
  whitelist_complete:       { inscricao_hash: "hash", tier: "tier", intencao_nao_vinculante: "string_curta" },
  email_verified:           { inscricao_hash: "hash" },
  wallet_connected:         { carteira_hash: "hash", tipo_carteira: "string_curta", rede_ok: "booleano" },
  wallet_signed:            { carteira_hash: "hash", inscricao_hash: "hash" },
  eligibility_checked:      { carteira_hash: "hash", resultado: "string_curta", snapshot_id: "hash" },
  tier_preference_selected: { inscricao_hash: "hash", tier: "tier" },
  sale_status_view:         { estado_ui: "enum_estado" },
  purchase_intent:          { carteira_hash: "hash", tier: "tier", unidades: "inteiro", intencao_hash: "hash" },
  wallet_prompt:            { intencao_hash: "hash" },
  tx_submitted:             { intencao_hash: "hash", tx_hash_ref: "hash" },
  tx_confirmed:             { intencao_hash: "hash", tx_hash_ref: "hash", duracao_ms: "inteiro" },
  tx_failed:                { intencao_hash: "hash", codigo: "string_curta" },
  sold_out_view:            { estado_ui: "enum_estado" },
  post_purchase_onboarding: { tier: "tier", etapa: "string_curta" },
  allowlist_verified:       { carteira_hash: "hash", prova_valida: "booleano", versao_prova: "inteiro" },
  admin_pause_requested:    { pedido_id: "hash" },
};

const ESTADOS_UI_SET = new Set<string>(ESTADOS_UI);
const TIERS_SET = new Set(["PRO", "TRADER", "PILOT"]);

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
    if (t === "enum_estado" && !(typeof v === "string" && ESTADOS_UI_SET.has(v))) return { ok: false, erro: `tipo:${k}` };
    if (t === "string_curta" && !(typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v))) return { ok: false, erro: `tipo:${k}` };
    if (t === "tier" && !(typeof v === "string" && TIERS_SET.has(v))) return { ok: false, erro: `tipo:${k}` };
    if (typeof v === "string" && PII.some((r) => r.test(v)) && t !== "hash") return { ok: false, erro: `pii:${k}` };
  }
  return { ok: true, evento: o as EventoTelemetria };
}
