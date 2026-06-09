"use client";

import { useState } from "react";
import {
  Building2, Briefcase, Landmark, Boxes, ShieldCheck, ScanSearch,
  Languages, Send, CheckCircle2, Crown,
} from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";

const CONTACT_EMAIL = "contact@zettaword.global";

const USE_CASES: { Icon: React.ComponentType<{ className?: string }>; titleKey: MessageKey; bodyKey: MessageKey }[] = [
  { Icon: Briefcase, titleKey: "enterprise.useCase1Title", bodyKey: "enterprise.useCase1Body" },
  { Icon: Boxes,     titleKey: "enterprise.useCase2Title", bodyKey: "enterprise.useCase2Body" },
  { Icon: Landmark,  titleKey: "enterprise.useCase3Title", bodyKey: "enterprise.useCase3Body" },
];

const DIFFERENTIALS: { Icon: React.ComponentType<{ className?: string }>; titleKey: MessageKey; bodyKey: MessageKey }[] = [
  { Icon: Languages,  titleKey: "enterprise.diff1Title", bodyKey: "enterprise.diff1Body" },
  { Icon: ShieldCheck, titleKey: "enterprise.diff2Title", bodyKey: "enterprise.diff2Body" },
  { Icon: ScanSearch, titleKey: "enterprise.diff3Title", bodyKey: "enterprise.diff3Body" },
  { Icon: Languages,  titleKey: "enterprise.diff4Title", bodyKey: "enterprise.diff4Body" },
];

export default function EnterpriseView() {
  const t = useT();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !company.trim() || !email.trim()) return;
    const subject = `Z-SWAP Enterprise — ${company.trim()}`;
    const body =
      `Name: ${name.trim()}\n` +
      `Company: ${company.trim()}\n` +
      `Email: ${email.trim()}\n\n` +
      `${message.trim()}`;
    const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSent(true);
    // Open the user's mail client with the message pre-filled.
    window.location.href = mailto;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:py-10 space-y-10">

      {/* Hero */}
      <div className="space-y-3 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan/30 bg-cyan/[0.05] font-mono text-[10px] tracking-widest uppercase text-cyan">
          <Building2 className="w-3 h-3" /> {t("enterprise.eyebrow")}
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-4xl text-ink leading-tight">
          {t("enterprise.heroTitleA")} <span className="text-gradient-cyan">{t("enterprise.heroTitleHL")}</span>
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed">
          {t("enterprise.heroSub")}
        </p>
      </div>

      {/* Use cases */}
      <div>
        <h2 className="font-display font-bold text-lg text-ink mb-4">{t("enterprise.useCasesHeading")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {USE_CASES.map(({ Icon, titleKey, bodyKey }) => (
            <div key={titleKey} className="rounded-2xl border border-white/5 bg-bg-1/40 p-5">
              <div className="w-10 h-10 rounded-xl bg-cyan/10 border border-cyan/25 flex items-center justify-center mb-3">
                <Icon className="w-5 h-5 text-cyan" />
              </div>
              <h3 className="font-display font-bold text-sm text-ink">{t(titleKey)}</h3>
              <p className="font-sans text-[12px] text-ink-2 leading-relaxed mt-1.5">{t(bodyKey)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Differentials */}
      <div>
        <h2 className="font-display font-bold text-lg text-ink mb-4">{t("enterprise.diffHeading")}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {DIFFERENTIALS.map(({ Icon, titleKey, bodyKey }) => (
            <div key={titleKey} className="flex items-start gap-3 rounded-xl border border-white/5 bg-bg-1/40 p-4">
              <div className="w-8 h-8 rounded-lg bg-violet/10 border border-violet/25 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-violet" />
              </div>
              <div className="min-w-0">
                <div className="font-display font-bold text-[13px] text-ink">{t(titleKey)}</div>
                <p className="font-sans text-[11px] text-ink-3 leading-relaxed mt-1">{t(bodyKey)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pilot tier mention */}
      <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.05] to-violet/[0.03] p-6">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <Crown className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h2 className="font-display font-bold text-base text-ink">{t("enterprise.pilotHeading")}</h2>
            <p className="font-sans text-[13px] text-ink-2 leading-relaxed mt-1.5">{t("enterprise.pilotBody")}</p>
            <div className="inline-block mt-3 px-3 py-1 rounded-full border border-gold/30 bg-gold/[0.06] font-mono text-[10px] tracking-widest uppercase text-gold">
              {t("enterprise.pilotTierNote")}
            </div>
          </div>
        </div>
      </div>

      {/* Contact form */}
      <div className="rounded-2xl border border-cyan/20 bg-cyan/[0.03] p-6">
        <h2 className="font-display font-bold text-lg text-ink">{t("enterprise.formHeading")}</h2>
        <p className="font-sans text-[13px] text-ink-2 leading-relaxed mt-1">{t("enterprise.formSub")}</p>

        {sent ? (
          <div className="mt-4 rounded-lg border border-green/30 bg-green/[0.05] px-4 py-4 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">{t("enterprise.formDoneHL")}</b> {t("enterprise.formDoneBody")}
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t("enterprise.formName")} value={name} onChange={setName} required />
              <Field label={t("enterprise.formCompany")} value={company} onChange={setCompany} required />
            </div>
            <Field label={t("enterprise.formEmail")} value={email} onChange={setEmail} type="email" required />
            <div>
              <label className="font-mono text-[9px] tracking-widest uppercase text-ink-3">{t("enterprise.formMessage")}</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1200}
                className="mt-1 w-full rounded-lg border border-white/10 bg-bg-2 px-3 py-2.5 font-sans text-sm text-ink placeholder:text-ink-4 outline-none focus:border-cyan/40 resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={!name.trim() || !company.trim() || !email.trim()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan/40 bg-cyan/15 text-cyan px-5 py-2.5 font-mono text-[11px] tracking-widest uppercase hover:bg-cyan/25 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {t("enterprise.formSubmit")}
            </button>
          </form>
        )}
      </div>

      {/* Trust line */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">{t("enterprise.trustLine")}</p>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", required,
}: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="font-mono text-[9px] tracking-widest uppercase text-ink-3">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={160}
        required={required}
        className="mt-1 w-full rounded-lg border border-white/10 bg-bg-2 px-3 py-2.5 font-sans text-sm text-ink placeholder:text-ink-4 outline-none focus:border-cyan/40"
      />
    </div>
  );
}
