import { NextResponse, type NextRequest } from "next/server";
import { lerConfigCorp, FLUXO_TTL_S, PRE_MFA_TTL_S, type ConfigCorp } from "./config";
import { COOKIE_ADMIN } from "@/lib/admin/sessao-corporativa";

/**
 * Borda HTTP do login corporativo (R1). Rotas em `src/app/api/admin-auth/*`, FORA de `/admin`.
 *   · sem configuração R1 válida (inclui `ADMIN_AUTH_MODE` ausente = legacy) → 404, como se não existisse;
 *   · todo POST exige mesma origem + JSON (design §4.6) — recusa ANTES de qualquer efeito;
 *   · cookies `__Host-`: Secure, Path=/, sem Domain. O do Admin é `SameSite=Strict` e morre com o
 *     navegador; os de fluxo/pré-MFA são `Lax` porque chegam no redirect vindo do IdP (top-level GET).
 */
export const COOKIE_FLUXO = "__Host-zswap_admin_flow";
export const COOKIE_PRE = "__Host-zswap_admin_pre";
const SEM_CACHE = { "Cache-Control": "no-store" };

export function configOu404(): { ok: true; cfg: ConfigCorp } | { ok: false; resposta: NextResponse } {
  const c = lerConfigCorp();
  return c.ok ? { ok: true, cfg: c.cfg } : { ok: false, resposta: new NextResponse(null, { status: 404, headers: SEM_CACHE }) };
}

/** A-CSRF: `Origin` exata, `Sec-Fetch-Site` same-origin quando presente, corpo JSON. */
export function mesmaOrigem(req: NextRequest, cfg: ConfigCorp): boolean {
  const origin = req.headers.get("origin");
  if (!origin || origin !== cfg.origem) return false;
  const sfs = req.headers.get("sec-fetch-site");
  if (sfs && sfs !== "same-origin") return false;
  return (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json");
}

export const recusaCsrf = () => NextResponse.json({ ok: false, erro: "origem" }, { status: 403, headers: SEM_CACHE });
/** Mesma resposta para todo motivo (a auditoria guarda o código real). */
export const naoEntrou = (status = 401) => NextResponse.json({ ok: false, erro: "nao_foi_possivel_entrar" }, { status, headers: SEM_CACHE });

const base = { httpOnly: true, secure: true, path: "/" } as const;
export const cookieFluxo = (v: string) => ({ name: COOKIE_FLUXO, value: v, ...base, sameSite: "lax" as const, maxAge: FLUXO_TTL_S });
export const cookiePre = (v: string) => ({ name: COOKIE_PRE, value: v, ...base, sameSite: "lax" as const, maxAge: PRE_MFA_TTL_S });
/** Sem `maxAge`: cookie de sessão do navegador (design §4.4); a validade real é a da linha no banco. */
export const cookieAdmin = (v: string) => ({ name: COOKIE_ADMIN, value: v, ...base, sameSite: "strict" as const });
export const apagar = (nome: string) => ({ name: nome, value: "", ...base, sameSite: "lax" as const, maxAge: 0 });

export { SEM_CACHE };
