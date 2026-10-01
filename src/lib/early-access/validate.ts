/**
 * VALIDAÇÃO E NORMALIZAÇÃO DA INSCRIÇÃO DE EARLY ACCESS — módulo puro.
 *
 * Sem banco, sem rede, sem segredo: tudo aqui é testável com uma string.
 * Regras finais em docs/WHITELIST-FUNDRAISING-DISCOVERY.md §0 e §8.2.
 *
 * ⚠️ EMAIL: trim → NFC → minúsculas, ASCII, ≤254. SEM dot folding do Gmail,
 * SEM plus stripping, SEM canonicalização por provedor (correção D). Duas
 * grafias que o provedor entrega na mesma caixa são duas inscrições — e isso
 * é escolha consciente: "consertar" o email de alguém é adivinhar.
 *
 * ⚠️ CAMPO DESCONHECIDO É RECUSADO. Uma allowlist estrita impede que um campo
 * novo entre calado (ex.: `status: "approved"` no corpo) e um dia alguém o
 * repasse ao banco.
 *
 * ⚠️ CARTEIRA DECLARADA, NÃO PROVADA. A normalização é a mesma do login
 * (EIP-55 em EVM, base58 canônico em Solana) para que um dia a verificação por
 * assinatura case byte a byte — mas aqui ninguém assinou nada.
 */
import { normalizeEvmAddress } from "@/lib/auth/siwe";
import { normalizeSolanaAddress } from "@/lib/auth/siws";
import { paisValido } from "./paises";
import { TERMS_VERSION, PRIVACY_VERSION, versaoAprovada } from "./legal-versions";

export const LIMITE_CORPO_BYTES = 4096;
export const NOME_MIN = 2;
export const NOME_MAX = 80;
export const UTM_MAX = 100;
export const LANDING_MAX = 300;
export const REFERRER_MAX = 255;
export const HONEYPOT_MAX = 200;

/** Superfícies que podem coletar. Lista fechada; o banco confere o formato. */
export const SOURCES = ["early_access_page"] as const;
export type Source = (typeof SOURCES)[number];

const CAMPOS = new Set([
  "email", "display_name", "country",
  "wallet_address", "wallet_chain", "telegram", "x",
  "referral_code",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "landing_path", "referrer_host", "source",
  "accept_terms", "accept_privacy", "terms_version", "privacy_version", "marketing_opt_in",
  "website", "form_ms",
]);

export interface DadosInscricao {
  email:           string;
  displayName:     string;
  country:         string;
  walletAddress:   string | null;
  walletChain:     "evm" | "solana" | null;
  telegram:        string | null;
  x:               string | null;
  referralCode:    string | null;
  utmSource:       string | null;
  utmMedium:       string | null;
  utmCampaign:     string | null;
  utmContent:      string | null;
  utmTerm:         string | null;
  landingPath:     string | null;
  referrerHost:    string | null;
  source:          Source;
  termsVersion:    string;
  privacyVersion:  string;
  marketingOptIn:  boolean;
  /** Sinais anti-bot — não vão ao banco. */
  honeypot:        string;
  formMs:          number | null;
}

export type ErroValidacao =
  | "corpo_invalido" | "campo_desconhecido" | "campo_invalido"
  | "consentimento_ausente" | "versao_legal";

export type Resultado =
  | { ok: true; dados: DadosInscricao }
  | { ok: false; erro: ErroValidacao; campo?: string };

// ── caracteres proibidos em texto humano ───────────────────────────────────
// Controles C0/C1, separadores de linha/parágrafo, bidi overrides/isolates,
// zero-width e afins. ZWNJ/ZWJ (U+200C/U+200D) ficam de fora de propósito:
// são parte legítima de escrita persa/índica e de emoji.
const PROIBIDOS_EM_TEXTO =
  /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069\u200B\u200E\u200F\u2060-\u2064\uFEFF\u00AD\u180E\u061C]/u;
/** Outros "format" (Cf) fora os dois permitidos acima. */
const OUTROS_FORMAT = /[\p{Cf}]/u;
const ZW_PERMITIDOS = /[\u200C\u200D]/gu;

export function textoHumanoSeguro(s: string): boolean {
  if (PROIBIDOS_EM_TEXTO.test(s)) return false;
  return !OUTROS_FORMAT.test(s.replace(ZW_PERMITIDOS, ""));
}

// ── email ──────────────────────────────────────────────────────────────────
const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const ROTULO = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizarEmail(bruto: string): string | null {
  const s = bruto.trim().normalize("NFC").toLowerCase();
  if (s.length < 3 || s.length > 254) return null;
  // ⚠️ ASCII nesta fase: homoglifo (`а` cirílico) passaria por igual a `a`.
  if (!/^[\x21-\x7e]+$/.test(s)) return null;
  const arroba = s.lastIndexOf("@");
  if (arroba <= 0 || s.indexOf("@") !== arroba) return null;
  const local = s.slice(0, arroba);
  const dominio = s.slice(arroba + 1);
  if (local.length > 64 || !LOCAL.test(local)) return null;
  const rotulos = dominio.split(".");
  if (rotulos.length < 2 || !rotulos.every((r) => ROTULO.test(r))) return null;
  const tld = rotulos[rotulos.length - 1];
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  return s;
}

// ── nome de exibição ───────────────────────────────────────────────────────
export function normalizarNome(bruto: string): string | null {
  const s = bruto.normalize("NFC").trim();
  const n = [...s].length;
  if (n < NOME_MIN || n > NOME_MAX) return null;
  if (!textoHumanoSeguro(s)) return null;
  if (!/\p{L}/u.test(s)) return null;
  return s;
}

// ── país ───────────────────────────────────────────────────────────────────
export function normalizarPais(bruto: string): string | null {
  const s = bruto.trim();
  // Formato estrito ANTES da lista: "br" e "Br" são recusados, não corrigidos.
  if (!/^[A-Z]{2}$/.test(s)) return null;
  return paisValido(s) ? s : null;
}

// ── carteira ───────────────────────────────────────────────────────────────
export function normalizarCarteira(
  endereco: string, chain: string,
): { address: string; chain: "evm" | "solana" } | null {
  const a = endereco.trim();
  if (a.length === 0 || a.length > 64) return null;
  if (chain === "evm") {
    const n = normalizeEvmAddress(a);
    return n ? { address: n, chain: "evm" } : null;
  }
  if (chain === "solana") {
    // ⚠️ NUNCA lower(): base58 diferencia maiúscula de minúscula.
    const n = normalizeSolanaAddress(a);
    return n ? { address: n, chain: "solana" } : null;
  }
  return null;
}

// ── handles ────────────────────────────────────────────────────────────────
export function normalizarTelegram(bruto: string): string | null {
  const m = /^@?([A-Za-z0-9_]{5,32})$/.exec(bruto.trim());
  return m ? m[1] : null;
}

export function normalizarX(bruto: string): string | null {
  const m = /^@?([A-Za-z0-9_]{1,15})$/.exec(bruto.trim());
  return m ? m[1] : null;
}

// ── referral (entrada) ─────────────────────────────────────────────────────
export const REFERRAL_FORMATO = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/**
 * Código digitado pela pessoa. Formato inválido vira `null` EM SILÊNCIO: a
 * validade do código nunca é revelada, nem a do formato vira erro de campo.
 */
export function normalizarReferral(bruto: string): string | null {
  const s = bruto.trim().toUpperCase();
  return REFERRAL_FORMATO.test(s) ? s : null;
}

// ── atribuição ─────────────────────────────────────────────────────────────
export function normalizarUtm(bruto: string): string | null | false {
  const s = bruto.normalize("NFC").trim();
  if (s === "") return null;
  if ([...s].length > UTM_MAX) return false;
  if (!textoHumanoSeguro(s)) return false;
  return s;
}

export function normalizarLanding(bruto: string): string | null | false {
  const s = bruto.trim();
  if (s === "") return null;
  if (s.length > LANDING_MAX || !s.startsWith("/") || s.startsWith("//")) return false;
  if (!/^[\x21-\x7e]+$/.test(s)) return false;
  return s;
}

export function normalizarReferrerHost(bruto: string): string | null | false {
  const s = bruto.trim().toLowerCase();
  if (s === "") return null;
  if (s.length > REFERRER_MAX) return false;
  const rotulos = s.split(".");
  if (rotulos.length < 2 || !rotulos.every((r) => ROTULO.test(r))) return false;
  return s;
}

// ── corpo inteiro ──────────────────────────────────────────────────────────
type Bruto = Record<string, unknown>;

function strOpcional(o: Bruto, k: string): string | undefined | false {
  const v = o[k];
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : false;
}

export interface VersoesLegais { terms: string; privacy: string }

/**
 * Valida o corpo já parseado. Nunca lança.
 *
 * ⚠️ A versão legal é conferida AQUI também, não só no gate: se o gate algum
 * dia falhar aberto por defeito, uma inscrição com versão "UNAPPROVED" ou
 * desatualizada continua sendo recusada (e o banco recusa uma terceira vez).
 *
 * `versoes` existe para TESTE: em produção é sempre o par de
 * `legal-versions.ts`. "UNAPPROVED" é recusado venha de onde vier.
 */
export function validarInscricao(
  corpo: unknown,
  versoes: VersoesLegais = { terms: TERMS_VERSION, privacy: PRIVACY_VERSION },
): Resultado {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
    return { ok: false, erro: "corpo_invalido" };
  }
  const o = corpo as Bruto;
  for (const k of Object.keys(o)) {
    if (!CAMPOS.has(k)) return { ok: false, erro: "campo_desconhecido", campo: k.slice(0, 40) };
  }

  const invalido = (campo: string): Resultado => ({ ok: false, erro: "campo_invalido", campo });

  // obrigatórios
  if (typeof o.email !== "string") return invalido("email");
  const email = normalizarEmail(o.email);
  if (!email) return invalido("email");

  if (typeof o.display_name !== "string") return invalido("display_name");
  const displayName = normalizarNome(o.display_name);
  if (!displayName) return invalido("display_name");

  if (typeof o.country !== "string") return invalido("country");
  const country = normalizarPais(o.country);
  if (!country) return invalido("country");

  // consentimento: literalmente `true`, nada de "on"/"1"
  if (o.accept_terms !== true || o.accept_privacy !== true) {
    return { ok: false, erro: "consentimento_ausente" };
  }
  if (typeof o.terms_version !== "string" || typeof o.privacy_version !== "string") {
    return { ok: false, erro: "versao_legal" };
  }
  if (!versaoAprovada(versoes.terms) || !versaoAprovada(versoes.privacy)
      || o.terms_version !== versoes.terms || o.privacy_version !== versoes.privacy) {
    return { ok: false, erro: "versao_legal" };
  }

  // carteira: as duas metades ou nenhuma
  const wa = strOpcional(o, "wallet_address");
  const wc = strOpcional(o, "wallet_chain");
  if (wa === false) return invalido("wallet_address");
  if (wc === false) return invalido("wallet_chain");
  const temWa = wa !== undefined && wa.trim() !== "";
  const temWc = wc !== undefined && wc.trim() !== "";
  let walletAddress: string | null = null;
  let walletChain: "evm" | "solana" | null = null;
  if (temWa !== temWc) return invalido(temWa ? "wallet_chain" : "wallet_address");
  if (temWa && temWc) {
    const c = normalizarCarteira(wa as string, (wc as string).trim());
    if (!c) return invalido("wallet_address");
    walletAddress = c.address;
    walletChain = c.chain;
  }

  // handles
  let telegram: string | null = null;
  const tg = strOpcional(o, "telegram");
  if (tg === false) return invalido("telegram");
  if (tg !== undefined && tg.trim() !== "") {
    telegram = normalizarTelegram(tg);
    if (!telegram) return invalido("telegram");
  }
  let x: string | null = null;
  const xv = strOpcional(o, "x");
  if (xv === false) return invalido("x");
  if (xv !== undefined && xv.trim() !== "") {
    x = normalizarX(xv);
    if (!x) return invalido("x");
  }

  // referral: tipo errado é erro; formato errado é silêncio
  const rc = strOpcional(o, "referral_code");
  if (rc === false) return invalido("referral_code");
  const referralCode = rc === undefined ? null : normalizarReferral(rc);

  // atribuição
  const utm: Record<string, string | null> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = strOpcional(o, k);
    if (v === false) return invalido(k);
    if (v === undefined) { utm[k] = null; continue; }
    const n = normalizarUtm(v);
    if (n === false) return invalido(k);
    utm[k] = n;
  }
  const lp = strOpcional(o, "landing_path");
  if (lp === false) return invalido("landing_path");
  const landingPath = lp === undefined ? null : normalizarLanding(lp);
  if (landingPath === false) return invalido("landing_path");
  const rh = strOpcional(o, "referrer_host");
  if (rh === false) return invalido("referrer_host");
  const referrerHost = rh === undefined ? null : normalizarReferrerHost(rh);
  if (referrerHost === false) return invalido("referrer_host");

  const src = strOpcional(o, "source");
  if (src === false) return invalido("source");
  const source = (src ?? "early_access_page") as Source;
  if (!(SOURCES as readonly string[]).includes(source)) return invalido("source");

  if (o.marketing_opt_in !== undefined && typeof o.marketing_opt_in !== "boolean") {
    return invalido("marketing_opt_in");
  }

  // sinais anti-bot: tipo é validado; o JULGAMENTO fica com a rota
  const hp = strOpcional(o, "website");
  if (hp === false || (hp !== undefined && hp.length > HONEYPOT_MAX)) return invalido("website");
  let formMs: number | null = null;
  if (o.form_ms !== undefined) {
    if (typeof o.form_ms !== "number" || !Number.isInteger(o.form_ms) || o.form_ms < 0 || o.form_ms > 86_400_000) {
      return invalido("form_ms");
    }
    formMs = o.form_ms;
  }

  return {
    ok: true,
    dados: {
      email, displayName, country, walletAddress, walletChain, telegram, x, referralCode,
      utmSource: utm.utm_source, utmMedium: utm.utm_medium, utmCampaign: utm.utm_campaign,
      utmContent: utm.utm_content, utmTerm: utm.utm_term,
      landingPath, referrerHost, source,
      termsVersion: o.terms_version, privacyVersion: o.privacy_version,
      marketingOptIn: o.marketing_opt_in === true,
      honeypot: hp ?? "", formMs,
    },
  };
}

/** Tempo mínimo de preenchimento (ms). Abaixo disso é sinal de robô. */
export const TEMPO_MINIMO_MS = 2_000;

/**
 * O envio tem cara de robô? Honeypot preenchido ou rápido demais.
 *
 * ⚠️ SINAL, NÃO PROVA — e por isso a rota responde o MESMO 202 e só não grava.
 * Dizer ao robô que ele foi pego ensina o robô.
 */
export function pareceRobo(d: Pick<DadosInscricao, "honeypot" | "formMs">): boolean {
  if (d.honeypot.trim() !== "") return true;
  return d.formMs === null || d.formMs < TEMPO_MINIMO_MS;
}
