"use client";

import { useEffect, useMemo, useState } from "react";
import { Mail, Clock, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useT } from "@/lib/i18n";
import { useUI } from "@/lib/store/ui";
import { PAISES_ISO } from "@/lib/early-access/paises";

/**
 * Confirmação do email do early access (Fase 2, F-01).
 *
 * ⚠️ SEM IMPORT DE SERVIDOR (trava `nao-vaza-para-o-cliente`).
 *
 * ⚠️ O TOKEN É LIDO DO FRAGMENTO e o fragmento é APAGADO da barra de endereço
 * na hora (`history.replaceState`): não fica no histórico, num print, nem
 * numa cópia da URL. Ele não é guardado em storage nenhum.
 *
 * ⚠️ NADA ACONTECE SEM CLIQUE. Abrir a página só pede o preview (que não
 * consome o token nem estende o prazo). Confirmar e "não fui eu" são botões.
 *
 * D-6: só nome e país podem ser corrigidos aqui. O email não aparece e não é
 * editável — trocar de email exige nova prova de posse.
 *
 * EA2-A02 / EA2-IA06: a escolha de marketing é do TITULAR, feita AQUI, e é
 * TRI-ESTADO: "sim" (opt-in), "não" (opt-out) ou nenhuma (sem escolha). Nasce
 * SEM seleção, independe do que o formulário declarou (a declaração é só
 * provisória e nem chega a esta página), e só vai no corpo se ele escolheu.
 * Sem escolha = nenhuma permissão de marketing, registrada como 'sem_escolha'.
 *
 * EA2-IA05: o botão diz o que clicar significa (aceitar os Termos da versão
 * X; declarar ter recebido a Política da versão Y), e o POST devolve
 * EXATAMENTE essas versões — as da preview — para o banco conferir.
 */
type Preview = {
  display_name: string; country: string; terms_version: string; privacy_version: string;
};
type Estado =
  | { k: "carregando" } | { k: "invalido" } | { k: "erro" }
  | { k: "revisar"; p: Preview } | { k: "enviando"; p: Preview }
  | { k: "confirmado"; codigo: string | null } | { k: "ja_confirmado" } | { k: "recusado" };

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Lido UMA vez por carregamento e guardado no módulo: o fragmento é apagado
 * na primeira leitura, então uma segunda montagem (StrictMode, remount) tem
 * de reaproveitar o valor em vez de reler uma URL já limpa.
 */
let tokenDaPagina: string | null | undefined;
function obterToken(): string | null {
  if (tokenDaPagina === undefined) tokenDaPagina = lerTokenDoFragmento();
  return tokenDaPagina;
}

function lerTokenDoFragmento(): string | null {
  try {
    const m = /(?:^#|&)t=([^&]+)/.exec(window.location.hash);
    // apaga o fragmento ANTES de qualquer requisição
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const t = m ? decodeURIComponent(m[1]) : null;
    return t && TOKEN.test(t) ? t : null;
  } catch {
    return null;
  }
}

async function chamar(corpo: Record<string, unknown>): Promise<{ status: number; j: Record<string, unknown> }> {
  const res = await fetch("/api/early-access/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    cache: "no-store", credentials: "same-origin", referrerPolicy: "no-referrer",
  });
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, j };
}

export default function ConfirmView({ aberto }: { aberto: boolean }) {
  const t = useT();
  return (
    <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-gold">
          <Mail className="w-3 h-3" /> {t("earlyAccess.eyebrow")}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink leading-tight">{t("earlyAccess.confirmTitle")}</h1>
      </div>
      {aberto ? <Fluxo /> : (
        <div className="glass border border-gold/20 rounded-2xl p-5 space-y-2" role="status">
          <div className="flex items-center gap-2 font-display font-bold text-ink">
            <Clock className="w-4 h-4 text-gold" /> {t("earlyAccess.closedTitle")}
          </div>
          <p className="text-sm text-ink-2">{t("earlyAccess.closedBody")}</p>
        </div>
      )}
      <noscript><p className="text-sm text-ink-2">{t("earlyAccess.confirmNoJs")}</p></noscript>
    </div>
  );
}

function Fluxo() {
  const t = useT();
  const lang = useUI((s) => s.lang);
  // Servidor e primeira pintura do cliente rendem o MESMO "carregando" (sem
  // mismatch de hidratação); o token só é lido no efeito, no navegador.
  const [estado, setEstado] = useState<Estado>({ k: "carregando" });
  const [nome, setNome] = useState("");
  const [pais, setPais] = useState("");
  const [marketing, setMarketing] = useState<boolean | null>(null);

  // Só sistema externo aqui (a requisição); todo setState mora no callback.
  useEffect(() => {
    let vivo = true;
    const token = obterToken();
    (token ? chamar({ token, action: "preview" }) : Promise.resolve({ status: 400, j: {} as Record<string, unknown> }))
      .then(({ status, j }) => {
        if (!vivo) return;
        const p = j.preview as Preview | undefined;
        if (status === 200 && p) { setNome(p.display_name); setPais(p.country); setEstado({ k: "revisar", p }); }
        else setEstado(status === 400 ? { k: "invalido" } : { k: "erro" });
      })
      .catch(() => { if (vivo) setEstado({ k: "erro" }); });
    return () => { vivo = false; };
  }, []);

  const paises = useMemo(() => {
    let nomes: Intl.DisplayNames | null = null;
    try { nomes = new Intl.DisplayNames([lang], { type: "region" }); } catch { /* navegador antigo */ }
    return PAISES_ISO.map((c) => ({ c, n: nomes?.of(c) ?? c })).sort((a, b) => a.n.localeCompare(b.n, lang));
  }, [lang]);

  async function confirmar(p: Preview) {
    const token = obterToken();
    if (!token) return;
    setEstado({ k: "enviando", p });
    const corpo: Record<string, unknown> = {
      token, action: "confirm",
      // EA2-IA05: as versões que ESTA tela apresentou
      accept_terms_version: p.terms_version, acknowledge_privacy_version: p.privacy_version,
    };
    // EA2-IA06: sem escolha = campo omitido (nunca vira opt-out explícito)
    if (marketing !== null) corpo.marketing_opt_in = marketing;
    if (nome.trim() !== p.display_name) corpo.display_name = nome;
    if (pais !== p.country) corpo.country = pais;
    try {
      const { status, j } = await chamar(corpo);
      if (status === 200 && j.result === "confirmed") setEstado({ k: "confirmado", codigo: typeof j.referral_code === "string" ? j.referral_code : null });
      else if (status === 200 && j.result === "already_confirmed") setEstado({ k: "ja_confirmado" });
      else if (status === 400 && (j.error === "campo_invalido" || j.error === "versao_legal")) setEstado({ k: "revisar", p });
      else setEstado(status === 400 ? { k: "invalido" } : { k: "erro" });
    } catch {
      setEstado({ k: "erro" });
    }
  }

  async function recusar(p: Preview) {
    const token = obterToken();
    if (!token || !window.confirm(t("earlyAccess.confirmDeclineAsk"))) return;
    setEstado({ k: "enviando", p });
    try {
      const { status, j } = await chamar({ token, action: "decline" });
      if (status === 200 && j.result === "declined") setEstado({ k: "recusado" });
      else setEstado(status === 400 ? { k: "invalido" } : { k: "erro" });
    } catch {
      setEstado({ k: "erro" });
    }
  }

  const caixa = "glass border rounded-2xl p-5 space-y-3";
  if (estado.k === "carregando") {
    return <div className={`${caixa} border-white/10 text-sm text-ink-2 flex items-center gap-2`} role="status"><Loader2 className="w-4 h-4 animate-spin" /> {t("earlyAccess.confirmLoading")}</div>;
  }
  if (estado.k === "invalido" || estado.k === "erro") {
    return (
      <div className={`${caixa} border-red/20`} role="alert">
        <div className="flex items-center gap-2 font-display font-bold text-ink"><XCircle className="w-4 h-4 text-red" /> {t(estado.k === "invalido" ? "earlyAccess.confirmInvalid" : "earlyAccess.errGeneric")}</div>
      </div>
    );
  }
  if (estado.k === "confirmado" || estado.k === "ja_confirmado" || estado.k === "recusado") {
    const texto = estado.k === "confirmado" ? "earlyAccess.confirmDone" : estado.k === "ja_confirmado" ? "earlyAccess.confirmAlready" : "earlyAccess.confirmDeclined";
    return (
      <div className={`${caixa} border-cyan/20`} role="status">
        <div className="flex items-center gap-2 font-display font-bold text-ink"><CheckCircle2 className="w-4 h-4 text-cyan" /> {t(texto)}</div>
        {estado.k === "confirmado" && estado.codigo && (
          <p className="text-sm text-ink-2 font-mono">{t("earlyAccess.confirmReferral", { code: estado.codigo })}</p>
        )}
      </div>
    );
  }

  const p = estado.p;
  const ocupado = estado.k === "enviando";
  const campo = "w-full rounded-xl bg-bg-2 border border-white/10 px-3 py-2 text-sm text-ink";
  return (
    <div className={`${caixa} border-white/10`}>
      <p className="text-sm text-ink-2">{t("earlyAccess.confirmIntro")}</p>
      <p className="text-xs text-ink-3">{t("earlyAccess.confirmCorrect")}</p>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldName")} *
        <input className={campo} required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} disabled={ocupado} />
      </label>
      <label className="block text-xs text-ink-2">{t("earlyAccess.fieldCountry")} *
        <select className={campo} required value={pais} onChange={(e) => setPais(e.target.value)} disabled={ocupado}>
          {paises.map(({ c, n }) => <option key={c} value={c}>{n}</option>)}
        </select>
      </label>
      <fieldset className="space-y-1 text-xs text-ink-2" disabled={ocupado}>
        <legend>{t("earlyAccess.confirmMarketing")}</legend>
        <label className="flex gap-2">
          <input type="radio" name="ea-marketing" checked={marketing === true} onChange={() => setMarketing(true)} />
          {t("earlyAccess.confirmMarketingYes")}
        </label>
        <label className="flex gap-2">
          <input type="radio" name="ea-marketing" checked={marketing === false} onChange={() => setMarketing(false)} />
          {t("earlyAccess.confirmMarketingNo")}
        </label>
        <p className="text-ink-3">{t("earlyAccess.confirmMarketingHint")}</p>
      </fieldset>
      <p className="text-xs text-ink-2">{t("earlyAccess.confirmLegal", { terms: p.terms_version, privacy: p.privacy_version })}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => confirmar(p)} disabled={ocupado}
          className="flex-1 rounded-xl bg-gold/90 text-bg font-display font-bold py-2.5 disabled:opacity-60 inline-flex items-center justify-center gap-2">
          {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {t("earlyAccess.confirmButton")}
        </button>
        <button type="button" onClick={() => recusar(p)} disabled={ocupado}
          className="rounded-xl border border-white/15 text-ink-2 px-4 py-2.5 text-sm disabled:opacity-60">
          {t("earlyAccess.confirmDecline")}
        </button>
      </div>
    </div>
  );
}
