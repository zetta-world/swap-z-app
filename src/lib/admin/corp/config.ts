import { lerModoAuth, type ModoAuth } from "@/lib/admin/authz-modo";

/**
 * CONFIGURAÇÃO DO LOGIN CORPORATIVO (R1, Admin CC 2.0) — `docs/ADMIN-SSO-MFA-RBAC-DESIGN.md` §9.4.
 *
 * ⚠️ DESLIGADO POR PADRÃO (D-10): ausência de configuração = comportamento atual. O login corporativo
 * só existe com `ADMIN_AUTH_MODE` = `dual`|`corp` E todas as peças abaixo válidas. Faltou uma → as
 * rotas `/admin-acesso` e `/api/admin-auth/*` respondem 404, e em `corp` o Admin fica fechado (alerta).
 *
 *   · `ADMIN_SESSION_ENC_KEY` — 32 bytes em base64: sela o cookie do fluxo PKCE e cifra o refresh token;
 *   · `ADMIN_ORIGIN` (ou `NEXT_PUBLIC_SITE_URL`) — origem canônica (redirect e checagem de `Origin`);
 *   · `SUPABASE_URL` + `SUPABASE_ANON_KEY` — cliente de Auth (a service key fica no `getSupabaseAdmin`);
 *   · `ADMIN_IDP_PROVIDERS` — `google,azure` (padrão: os dois; só os habilitados no Supabase funcionam).
 */
export type Provedor = "google" | "azure";
const PROVEDORES: readonly Provedor[] = ["google", "azure"];

export interface ConfigCorp {
  modo: ModoAuth;
  chave: Buffer;
  origem: string;
  supabaseUrl: string;
  anonKey: string;
  provedores: Provedor[];
}

export type LeituraConfig = { ok: true; cfg: ConfigCorp } | { ok: false; motivo: string };

export function lerConfigCorp(env: Record<string, string | undefined> = process.env): LeituraConfig {
  const modo = lerModoAuth(env);
  if (!modo.ok) return { ok: false, motivo: "modo_invalido" };
  if (modo.modo === "legacy") return { ok: false, motivo: "modo_legacy" };
  const bruta = (env.ADMIN_SESSION_ENC_KEY ?? "").trim();
  let chave: Buffer;
  try { chave = Buffer.from(bruta, "base64"); } catch { return { ok: false, motivo: "chave_invalida" }; }
  if (chave.length !== 32) return { ok: false, motivo: "chave_invalida" };
  const origemBruta = (env.ADMIN_ORIGIN ?? env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  let origem: string;
  try {
    const u = new URL(origemBruta);
    if (u.protocol !== "https:" && !(u.hostname === "localhost" || u.hostname === "127.0.0.1")) return { ok: false, motivo: "origem_invalida" };
    origem = u.origin;
  } catch { return { ok: false, motivo: "origem_invalida" }; }
  const supabaseUrl = (env.SUPABASE_URL ?? "").trim();
  const anonKey = (env.SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrl || !anonKey) return { ok: false, motivo: "supabase_ausente" };
  const pedidos = (env.ADMIN_IDP_PROVIDERS ?? "google,azure").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (pedidos.length === 0 || pedidos.some((p) => !PROVEDORES.includes(p as Provedor))) return { ok: false, motivo: "provedores_invalidos" };
  return { ok: true, cfg: { modo: modo.modo, chave, origem, supabaseUrl, anonKey, provedores: pedidos as Provedor[] } };
}

/** Janelas do desenho §4.4 (D-ttl). */
export const FLUXO_TTL_S = 10 * 60;
export const PRE_MFA_TTL_S = 10 * 60;
export const MAX_SESSOES_ATIVAS = 3;
export const MAX_FALHAS_MFA = 5;
export const BLOQUEIO_MFA_S = 15 * 60;
export const BREAKGLASS_MAX_S = 60 * 60;
