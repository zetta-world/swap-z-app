import { createClient } from "@supabase/supabase-js";
import type { ConfigCorp, Provedor } from "./config";

/**
 * CLIENTE DE AUTH DO LOGIN CORPORATIVO (R1, design §4.1–§4.3) — `supabase-js` PURO, no SERVIDOR.
 *
 * ⚠️ D-3/D-4: um cliente POR REQUISIÇÃO, armazenamento em MEMÓRIA (`Map`), PKCE. Os tokens do Supabase
 * nunca chegam ao navegador: o verificador PKCE viaja selado (`selo.ts`), e o refresh token fica
 * CIFRADO no banco (`admin_sessions.sb_refresh_token_enc`). O navegador só tem a sessão admin opaca.
 *
 * A interface é pequena de propósito: é o que os testes substituem (`definirFabricaAuth`) — nenhum
 * teste fala com um Supabase real.
 */
export interface UsuarioIdp {
  authUserId: string;
  /** Conta com mais de uma identidade (ou nenhuma do provedor pedido): recusada no vínculo. */
  multiplasIdentidades?: boolean;
  email: string | null;
  emailVerificado: boolean;
  provedor: string | null;
  sujeito: string | null;
  issuer: string | null;
  tenant: string | null;
}

export interface Tokens { accessToken: string; refreshToken: string }

export interface ClaimsMfa { aal: string | null; metodos: { metodo: string; quando: number | null }[]; sessionId: string | null }

export interface ClienteAuthCorp {
  iniciarOAuth(p: { provedor: Provedor; redirectTo: string; queryParams: Record<string, string> }): Promise<{ url: string; verificador: string } | null>;
  /**
   * ⚠️ O usuário só vale se o `auth.users` tiver EXATAMENTE uma identidade, e do `provedor` pedido
   * (revisão adversarial): com auto-link de e-mail, `identities[0]` podia ser outra (google) enquanto o
   * login veio do azure — e o `code_challenge` visível permitiria trocar o provedor no `/authorize`.
   */
  trocarCodigo(code: string, verificador: string, provedor: Provedor): Promise<{ tokens: Tokens; usuario: UsuarioIdp } | null>;
  restaurar(refreshToken: string): Promise<Tokens | null>;
  /** Exige `restaurar` antes (o cliente precisa estar com a sessão do usuário). */
  matricularTotp(nome: string): Promise<{ factorId: string; qrSvg: string; uri: string } | null>;
  desafiarEVerificar(factorId: string, codigo: string): Promise<Tokens | null>;
  claims(accessToken: string): Promise<ClaimsMfa | null>;
}

const STORAGE_KEY = "zswap-admin";
const CHAVE_VERIFICADOR = `${STORAGE_KEY}-code-verifier`;

function criarReal(cfg: ConfigCorp): ClienteAuthCorp {
  const memoria = new Map<string, string>();
  const cliente = createClient(cfg.supabaseUrl, cfg.anonKey, {
    auth: {
      flowType: "pkce", persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
      storageKey: STORAGE_KEY,
      storage: {
        getItem: (k: string) => memoria.get(k) ?? null,
        setItem: (k: string, v: string) => { memoria.set(k, v); },
        removeItem: (k: string) => { memoria.delete(k); },
      },
    },
  });
  const tokensDe = (s: { access_token?: string; refresh_token?: string } | null | undefined): Tokens | null =>
    s?.access_token && s?.refresh_token ? { accessToken: s.access_token, refreshToken: s.refresh_token } : null;

  return {
    async iniciarOAuth({ provedor, redirectTo, queryParams }) {
      const { data, error } = await cliente.auth.signInWithOAuth({
        provider: provedor,
        options: { redirectTo, scopes: "openid email profile", queryParams, skipBrowserRedirect: true },
      });
      const verificador = memoria.get(CHAVE_VERIFICADOR);
      if (error || !data?.url || !verificador) return null;
      return { url: data.url, verificador };
    },
    async trocarCodigo(code, verificador, provedor) {
      memoria.set(CHAVE_VERIFICADOR, verificador);
      const { data, error } = await cliente.auth.exchangeCodeForSession(code);
      const tokens = tokensDe(data?.session);
      const u = data?.user;
      if (error || !tokens || !u) return null;
      const todas = u.identities ?? [];
      const ident = todas.length === 1 && todas[0].provider === provedor ? todas[0] : undefined;
      const idData = (ident?.identity_data ?? {}) as Record<string, unknown>;
      return {
        tokens,
        usuario: {
          authUserId: u.id,
          multiplasIdentidades: todas.length !== 1,
          email: u.email ?? null,
          emailVerificado: Boolean(u.email_confirmed_at),
          provedor: ident?.provider ?? null,
          sujeito: typeof idData.sub === "string" ? idData.sub : typeof idData.provider_id === "string" ? idData.provider_id : null,
          issuer: typeof idData.iss === "string" ? idData.iss : null,
          tenant: typeof idData.hd === "string" ? idData.hd : typeof idData.tid === "string" ? idData.tid
            : typeof (idData.custom_claims as Record<string, unknown> | undefined)?.hd === "string"
              ? String((idData.custom_claims as Record<string, unknown>).hd) : null,
        },
      };
    },
    async restaurar(refreshToken) {
      const { data, error } = await cliente.auth.refreshSession({ refresh_token: refreshToken });
      return error ? null : tokensDe(data?.session);
    },
    async matricularTotp(nome) {
      // Nome ÚNICO por tentativa: o GoTrue recusa friendlyName repetido, e reabrir a tela de ativação
      // prendia a pessoa num fator não verificado (revisão adversarial).
      const { data, error } = await cliente.auth.mfa.enroll({ factorType: "totp", friendlyName: `${nome}-${Date.now().toString(36)}`, issuer: "Z-SWAP Admin" });
      if (error || !data || data.type !== "totp") return null;
      return { factorId: data.id, qrSvg: data.totp.qr_code, uri: data.totp.uri };
    },
    async desafiarEVerificar(factorId, codigo) {
      const { data, error } = await cliente.auth.mfa.challengeAndVerify({ factorId, code: codigo });
      return error ? null : tokensDe(data as { access_token?: string; refresh_token?: string });
    },
    async claims(accessToken) {
      const { data, error } = await cliente.auth.getClaims(accessToken);
      if (error || !data?.claims) return null;
      const c = data.claims as { aal?: string; amr?: unknown; session_id?: string };
      const amr = Array.isArray(c.amr) ? c.amr : [];
      return {
        aal: typeof c.aal === "string" ? c.aal : null,
        sessionId: typeof c.session_id === "string" ? c.session_id : null,
        metodos: amr.map((x) => typeof x === "string"
          ? { metodo: x, quando: null }
          : { metodo: String((x as { method?: unknown }).method ?? ""), quando: Number((x as { timestamp?: unknown }).timestamp) || null }),
      };
    },
  };
}

let fabrica: (cfg: ConfigCorp) => ClienteAuthCorp = criarReal;

export function clienteAuthCorp(cfg: ConfigCorp): ClienteAuthCorp {
  return fabrica(cfg);
}

/** Só para testes: troca o cliente real por um falso. */
export function definirFabricaAuth(f: ((cfg: ConfigCorp) => ClienteAuthCorp) | null): void {
  fabrica = f ?? criarReal;
}

/**
 * Prova de MFA aceita (design §4.3, D-5): `aal2` E um método TOTP com carimbo RECENTE no `amr`.
 * Nada vindo do navegador conta; as claims vêm do Supabase, conferidas no servidor (`getClaims`).
 */
export function provaDeMfa(c: ClaimsMfa | null, agoraS: number, janelaS = 300): { ok: true; quando: number } | { ok: false } {
  if (!c || c.aal !== "aal2") return { ok: false };
  const totp = c.metodos.filter((m) => m.metodo === "totp" || m.metodo === "mfa/totp");
  const quando = Math.max(...totp.map((m) => m.quando ?? 0), 0);
  if (!quando || agoraS - quando > janelaS || quando > agoraS + 60) return { ok: false };
  return { ok: true, quando };
}
