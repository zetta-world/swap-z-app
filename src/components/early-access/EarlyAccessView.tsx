"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, Clock, CheckCircle2, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useUI } from "@/lib/store/ui";
import { PAISES_ISO } from "@/lib/early-access/paises";

/**
 * /early-access — lista PÚBLICA de interessados.
 *
 * ⚠️ SEM IMPORT DE SERVIDOR. Gate, segredo e banco ficam do lado da página
 * (server component); aqui chegam só `aberto` e as versões.
 *
 * ⚠️ FECHADO = SEM FORMULÁRIO. Na Fase 1 o gate está fechado e esta tela diz
 * isso; o formulário existe para quando abrir, e nunca aparece prometendo uma
 * inscrição que a rota recusaria.
 *
 * ⚠️ NÃO MEXE nos formulários `localStorage` de `TeaserShell`/`PricingView`
 * (correção F do discovery) e não lê nada deles.
 */
interface Props {
  aberto:         boolean;
  termsVersion:   string;
  privacyVersion: string;
}

export default function EarlyAccessView({ aberto, termsVersion, privacyVersion }: Props) {
  const t = useT();
  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-gold">
          <Mail className="w-3 h-3" /> {t("earlyAccess.eyebrow")}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink leading-tight">{t("earlyAccess.title")}</h1>
        <p className="text-sm text-ink-2">{t("earlyAccess.subtitle")}</p>
      </div>
      {aberto
        ? <Formulario termsVersion={termsVersion} privacyVersion={privacyVersion} />
        : (
          <div className="glass border border-gold/20 rounded-2xl p-5 space-y-2" role="status">
            <div className="flex items-center gap-2 font-display font-bold text-ink">
              <Clock className="w-4 h-4 text-gold" /> {t("earlyAccess.closedTitle")}
            </div>
            <p className="text-sm text-ink-2">{t("earlyAccess.closedBody")}</p>
          </div>
        )}
    </div>
  );
}

// ── atribuição first-touch ─────────────────────────────────────────────────
const CHAVE_ATRIB = "zswap_ea_first_touch";
const UTMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
type Atribuicao = Partial<Record<(typeof UTMS)[number] | "landing_path" | "referrer_host", string>>;

/**
 * Primeira visita da sessão grava; as seguintes não sobrescrevem
 * (first-touch). `sessionStorage`, não cookie novo — e falha em silêncio.
 */
function capturarAtribuicao(): Atribuicao {
  try {
    const salvo = window.sessionStorage.getItem(CHAVE_ATRIB);
    if (salvo) return JSON.parse(salvo) as Atribuicao;
    const u = new URL(window.location.href);
    const a: Atribuicao = {};
    for (const k of UTMS) {
      const v = u.searchParams.get(k);
      if (v) a[k] = v.slice(0, 100);
    }
    a.landing_path = u.pathname.slice(0, 300);
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.host !== u.host) a.referrer_host = r.hostname.slice(0, 255);
    }
    window.sessionStorage.setItem(CHAVE_ATRIB, JSON.stringify(a));
    return a;
  } catch {
    return {};
  }
}

/** `?ref=` da URL, lido no envio quando o campo ficou vazio. */
function codigoDaUrl(): string {
  try { return (new URL(window.location.href).searchParams.get("ref") ?? "").slice(0, 20); } catch { return ""; }
}

function Formulario({ termsVersion, privacyVersion }: { termsVersion: string; privacyVersion: string }) {
  const t = useT();
  const lang = useUI((s) => s.lang);
  const inicio = useRef<number>(0);
  const [f, setF] = useState({
    email: "", display_name: "", country: "", wallet_address: "", wallet_chain: "",
    telegram: "", x: "", referral_code: "", website: "",
  });
  const [termos, setTermos] = useState(false);
  const [privacidade, setPrivacidade] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [estado, setEstado] = useState<"livre" | "enviando" | "feito">("livre");
  const [erro, setErro] = useState<string | null>(null);

  // Só sistemas externos aqui: o relógio do formulário e o first-touch no
  // sessionStorage. Nada de estado React — a atribuição é lida no envio.
  useEffect(() => {
    inicio.current = Date.now();
    capturarAtribuicao();
  }, []);

  const paises = useMemo(() => {
    let nomes: Intl.DisplayNames | null = null;
    try { nomes = new Intl.DisplayNames([lang], { type: "region" }); } catch { /* navegador antigo */ }
    return PAISES_ISO.map((c) => ({ c, n: nomes?.of(c) ?? c })).sort((a, b) => a.n.localeCompare(b.n, lang));
  }, [lang]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!termos || !privacidade) { setErro(t("earlyAccess.errInvalid")); return; }
    setEstado("enviando"); setErro(null);
    const corpo: Record<string, unknown> = {
      email: f.email, display_name: f.display_name, country: f.country,
      accept_terms: true, accept_privacy: true,
      terms_version: termsVersion, privacy_version: privacyVersion,
      marketing_opt_in: marketing, source: "early_access_page",
      website: f.website, form_ms: inicio.current > 0 ? Date.now() - inicio.current : 0,
      ...capturarAtribuicao(),
    };
    if (f.wallet_address.trim()) { corpo.wallet_address = f.wallet_address; corpo.wallet_chain = f.wallet_chain; }
    if (f.telegram.trim()) corpo.telegram = f.telegram;
    if (f.x.trim()) corpo.x = f.x;
    const ref = f.referral_code.trim() || codigoDaUrl();
    if (ref) corpo.referral_code = ref;
    try {
      const res = await fetch("/api/early-access", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      });
      if (res.status === 202) { setEstado("feito"); return; }
      setErro(
        res.status === 400 ? t("earlyAccess.errInvalid")
        : res.status === 429 ? t("earlyAccess.errRate")
        : res.status === 503 ? t("earlyAccess.errClosed")
        : t("earlyAccess.errGeneric"),
      );
    } catch {
      setErro(t("earlyAccess.errGeneric"));
    }
    setEstado("livre");
  }

  if (estado === "feito") {
    return (
      <div className="glass border border-cyan/20 rounded-2xl p-5 space-y-1" role="status">
        <div className="flex items-center gap-2 font-display font-bold text-ink">
          <CheckCircle2 className="w-4 h-4 text-cyan" /> {t("earlyAccess.doneTitle")}
        </div>
        <p className="text-sm text-ink-2">{t("earlyAccess.doneBody")}</p>
      </div>
    );
  }

  const campo = "w-full rounded-xl bg-bg-2 border border-white/10 px-3 py-2 text-sm text-ink";
  const opc = <span className="text-ink-3"> ({t("earlyAccess.optional")})</span>;
  return (
    <form onSubmit={enviar} className="glass border border-white/10 rounded-2xl p-5 space-y-3" noValidate>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldEmail")} *
        <input className={campo} type="email" autoComplete="email" required maxLength={254} value={f.email} onChange={set("email")} />
      </label>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldName")} *
        <input className={campo} required maxLength={80} value={f.display_name} onChange={set("display_name")} />
      </label>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldCountry")} *
        <select className={campo} required value={f.country} onChange={set("country")}>
          <option value="">{t("earlyAccess.countryPlaceholder")}</option>
          {paises.map(({ c, n }) => <option key={c} value={c}>{n}</option>)}
        </select>
      </label>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldWallet")}{opc}
        <input className={campo} maxLength={64} value={f.wallet_address} onChange={set("wallet_address")} spellCheck={false} />
      </label>
      {f.wallet_address.trim() !== "" && (
        <label className="block text-xs text-ink-2">{t("earlyAccess.fieldChain")} *
          <select className={campo} required value={f.wallet_chain} onChange={set("wallet_chain")}>
            <option value="" />
            <option value="evm">{t("earlyAccess.chainEvm")}</option>
            <option value="solana">{t("earlyAccess.chainSolana")}</option>
          </select>
        </label>
      )}
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldTelegram")}{opc}
        <input className={campo} maxLength={33} value={f.telegram} onChange={set("telegram")} />
      </label>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldX")}{opc}
        <input className={campo} maxLength={16} value={f.x} onChange={set("x")} />
      </label>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldReferral")}{opc}
        <input className={campo} maxLength={20} value={f.referral_code} onChange={set("referral_code")} />
      </label>
      {/* honeypot: invisível para gente, irresistível para robô */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <input tabIndex={-1} autoComplete="off" name="website" value={f.website} onChange={set("website")} />
      </div>
      <label className="flex gap-2 text-xs text-ink-2">
        <input type="checkbox" checked={termos} onChange={(e) => setTermos(e.target.checked)} />
        {t("earlyAccess.acceptTerms", { version: termsVersion })} *
      </label>
      <label className="flex gap-2 text-xs text-ink-2">
        <input type="checkbox" checked={privacidade} onChange={(e) => setPrivacidade(e.target.checked)} />
        {t("earlyAccess.acceptPrivacy", { version: privacyVersion })} *
      </label>
      <label className="flex gap-2 text-xs text-ink-2">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        {t("earlyAccess.acceptMarketing")}
      </label>
      {erro && <p className="text-xs text-red" role="alert">{erro}</p>}
      <button type="submit" disabled={estado === "enviando"}
        className="w-full rounded-xl bg-gold/90 text-bg font-display font-bold py-2.5 disabled:opacity-60 inline-flex items-center justify-center gap-2">
        {estado === "enviando" ? <><Loader2 className="w-4 h-4 animate-spin" /> {t("earlyAccess.submitting")}</> : t("earlyAccess.submit")}
      </button>
    </form>
  );
}
