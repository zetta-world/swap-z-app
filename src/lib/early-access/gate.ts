import { getSupabaseAdmin } from "@/lib/supabase/server";
import { TERMS_VERSION, PRIVACY_VERSION, versaoAprovada } from "./legal-versions";
import { segredoConfigurado } from "./hmac";
import { emailConfigurado } from "./email/config";

/**
 * O PORTÃO DO EARLY ACCESS — fail-closed em TODAS as direções.
 *
 * ⚠️⚠️ POR QUE NÃO `src/lib/admin/kill-switches.ts`. Aquele módulo decide a
 * direção de falha POR ROTA, e uma das duas (`usuario_confirma`) falha ABERTA
 * de propósito: cotação de swap não pode cair junto com o Postgres. Coletar
 * dado pessoal é o oposto — sem saber se pode, não coleta. Reaproveitar o
 * leitor de lá traria o `TUDO_ABERTO` como default de leitura falha, e
 * bastaria um chamador escolher o tipo errado.
 *
 * ABERTO só quando as CINCO condições valem ao mesmo tempo:
 *
 *   1. `admin_kv.disable_early_access` foi LIDO e vale exatamente "false";
 *   2. `TERMS_VERSION`  ≠ "UNAPPROVED";
 *   3. `PRIVACY_VERSION` ≠ "UNAPPROVED";
 *   4. `EARLY_ACCESS_HMAC_SECRET` configurado (≥ 32 caracteres);
 *   5. (Fase 2, F-01) envio de email configurado e válido (`email/config.ts`):
 *      sem como mandar o link de confirmação, não se coleta email nenhum.
 *
 * Linha ausente, banco ausente, erro de leitura, exceção, valor diferente de
 * "false" (inclusive "False", "0", "") → FECHADO.
 *
 * A Fase 1 termina FECHADA de propósito: a 0068 semeia "true", as versões são
 * "UNAPPROVED" e o segredo não existe em ambiente nenhum. A Fase 2 também
 * termina fechada: nenhum provider de email está configurado em ambiente nenhum.
 */
export const CHAVE_GATE = "disable_early_access";

export type MotivoFechado =
  | "kv_ausente" | "kv_leitura_falhou" | "kv_valor_invalido" | "kv_fechado"
  | "termos_nao_aprovados" | "privacidade_nao_aprovada" | "segredo_ausente" | "email_nao_configurado";

export type LeituraKv =
  | { lido: true; valor: string | null }   // null = linha ausente
  | { lido: false };

export interface EstadoGate {
  aberto:  boolean;
  motivos: MotivoFechado[];
}

/** Decisão pura. Todos os motivos são listados, não só o primeiro. */
export function decidirGate(e: {
  kv: LeituraKv; terms: string; privacy: string; segredo: boolean; email: boolean;
}): EstadoGate {
  const motivos: MotivoFechado[] = [];
  if (!e.kv.lido) motivos.push("kv_leitura_falhou");
  else if (e.kv.valor === null) motivos.push("kv_ausente");
  else if (e.kv.valor === "true") motivos.push("kv_fechado");
  else if (e.kv.valor !== "false") motivos.push("kv_valor_invalido");
  if (!versaoAprovada(e.terms)) motivos.push("termos_nao_aprovados");
  if (!versaoAprovada(e.privacy)) motivos.push("privacidade_nao_aprovada");
  if (!e.segredo) motivos.push("segredo_ausente");
  if (e.email !== true) motivos.push("email_nao_configurado");
  return { aberto: motivos.length === 0, motivos };
}

/** Lê a chave. Nunca lança; qualquer falha é `lido: false`. */
export async function lerChaveGate(): Promise<LeituraKv> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return { lido: false };
    const { data, error } = await db
      .from("admin_kv").select("value").eq("key", CHAVE_GATE).maybeSingle();
    if (error) return { lido: false };
    if (!data) return { lido: true, valor: null };
    return { lido: true, valor: typeof data.value === "string" ? data.value : "" };
  } catch {
    return { lido: false };
  }
}

export async function lerGateEarlyAccess(): Promise<EstadoGate> {
  return decidirGate({
    kv:      await lerChaveGate(),
    terms:   TERMS_VERSION,
    privacy: PRIVACY_VERSION,
    segredo: segredoConfigurado(),
    email:   emailConfigurado(),
  });
}
