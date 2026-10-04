"use client";

import { useId } from "react";
import {
  Crown, Clock, Hourglass, ShieldCheck, ShieldX, ShieldQuestion, PauseCircle,
  PackageX, Flag, Loader2, Wallet, Send, CheckCircle2, XCircle, Sparkles, ClipboardList, Scale, Ban, Network,
  CircleDollarSign, ShieldAlert, HelpCircle,
} from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import type { EstadoUI, VisaoProgresso, VisaoAlocacao } from "@/lib/founders-sale/visao";
import { podeMintar } from "@/lib/founders-sale/visao";
import type { Contagem } from "@/lib/founders-sale/relogio";

/**
 * PAINEL DA VENDA FOUNDERS — só apresentação. Recebe o modelo de visão já
 * decidido (`src/lib/founders-sale/visao.ts`); não busca dados, não fala com
 * rede, não conhece chain, preço nem moeda (decisões do dono).
 *
 * Acessibilidade: região rotulada, estado em `role="status"` (aria-live),
 * contagem como <time> com rótulo completo (os dígitos são decorativos),
 * barra de progresso só com números honestos, botão de mint de verdade
 * desabilitado fora dos estados permitidos (com o motivo ligado por
 * aria-describedby), animação só com `motion-safe:` (respeita reduced motion).
 */
export interface FoundersSalePanelProps {
  estado:     EstadoUI;
  contagem:   Contagem;
  progresso:  VisaoProgresso;
  alocacao:   VisaoAlocacao;
  /** Referência curta da transação (nunca o endereço da carteira). */
  txRef?:     string | null;
  onMint?:    () => void;
  /** Rótulo extra para galerias de prévia. */
  rotulo?:    string;
}

const ICONE: Record<EstadoUI, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  COMING_SOON: Sparkles, APPLICATION_OPEN: ClipboardList, ELIGIBILITY_PENDING: Scale, WALLET_LIMIT_REACHED: Ban,
  WRONG_NETWORK: Network, PRICE_UNAVAILABLE: CircleDollarSign, CONFIG_INVALID: ShieldAlert, UNKNOWN_STATE: HelpCircle,
  ALLOWLIST_CHECK: ShieldQuestion, ELIGIBLE: ShieldCheck, NOT_ELIGIBLE: ShieldX,
  SALE_NOT_STARTED: Hourglass, SALE_ACTIVE: Crown, PAUSED: PauseCircle, SOLD_OUT: PackageX, ENDED: Flag,
  TRANSACTION_PREPARING: Loader2, WALLET_CONFIRMATION: Wallet, TRANSACTION_PENDING: Send,
  TRANSACTION_CONFIRMED: CheckCircle2, TRANSACTION_FAILED: XCircle,
};

type Tom = "gold" | "violet" | "cyan" | "green" | "red" | "ink";
const TOM: Record<EstadoUI, Tom> = {
  COMING_SOON: "violet", APPLICATION_OPEN: "violet", ELIGIBILITY_PENDING: "ink", WALLET_LIMIT_REACHED: "ink",
  WRONG_NETWORK: "red", PRICE_UNAVAILABLE: "red", CONFIG_INVALID: "red", UNKNOWN_STATE: "ink",
  ALLOWLIST_CHECK: "cyan", ELIGIBLE: "green", NOT_ELIGIBLE: "red",
  SALE_NOT_STARTED: "violet", SALE_ACTIVE: "gold", PAUSED: "ink", SOLD_OUT: "ink", ENDED: "ink",
  TRANSACTION_PREPARING: "cyan", WALLET_CONFIRMATION: "cyan", TRANSACTION_PENDING: "cyan",
  TRANSACTION_CONFIRMED: "green", TRANSACTION_FAILED: "red",
};
const TOM_CLASSES: Record<Tom, string> = {
  gold:   "border-gold/40 bg-gold/10 text-gold",
  violet: "border-violet/40 bg-violet/10 text-violet",
  cyan:   "border-cyan/40 bg-cyan/10 text-cyan",
  green:  "border-green/40 bg-green/10 text-green",
  red:    "border-red/40 bg-red/10 text-red",
  ink:    "border-border bg-bg-3 text-ink-2",
};
const GIRA: ReadonlySet<EstadoUI> = new Set(["TRANSACTION_PREPARING", "ALLOWLIST_CHECK"]);
const PULSA: ReadonlySet<EstadoUI> = new Set(["TRANSACTION_PENDING", "WALLET_CONFIRMATION"]);

export default function FoundersSalePanel({ estado, contagem, progresso, alocacao, txRef, onMint, rotulo }: FoundersSalePanelProps) {
  const t = useT();
  const id = useId();
  const Icone = ICONE[estado];
  const tom = TOM_CLASSES[TOM[estado]];
  const mint = podeMintar(estado);
  const titulo = t(`founders.st_${estado}` as MessageKey);

  return (
    <section
      aria-labelledby={`${id}-titulo`}
      data-estado={estado}
      className="rounded-3xl p-px bg-[linear-gradient(150deg,rgba(245,166,35,0.45),rgba(245,166,35,0.10)_45%,rgba(159,95,255,0.35))]"
    >
      <div className="rounded-[23px] bg-bg-1/90 backdrop-blur-xl p-5 sm:p-6 flex flex-col gap-5 h-full">
        <header className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center flex-shrink-0 ${tom}`}>
            <Icone
              aria-hidden
              className={`w-5 h-5 ${GIRA.has(estado) ? "motion-safe:animate-spin" : ""} ${PULSA.has(estado) ? "motion-safe:animate-pulse" : ""}`}
            />
          </div>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-widest uppercase text-ink-3">
              {rotulo ?? t("founders.title")}
            </p>
            <h2 id={`${id}-titulo`} className="font-display font-extrabold text-lg sm:text-xl text-ink mt-0.5">
              {titulo}
            </h2>
          </div>
        </header>

        <div role="status" aria-live="polite" className="font-sans text-sm text-ink-2 leading-relaxed">
          <span className="sr-only">{t("founders.statusLabel")}: {titulo}. </span>
          {t(`founders.ds_${estado}` as MessageKey)}
          {estado === "TRANSACTION_CONFIRMED" && txRef ? (
            <span className="block font-mono text-xs text-ink-3 mt-1 break-all">
              {t("founders.txReference")}: {txRef}
            </span>
          ) : null}
        </div>

        <Contador contagem={contagem} />
        <Progresso progresso={progresso} />
        <Alocacao alocacao={alocacao} />

        <div className="mt-auto">
          <button
            type="button"
            disabled={!mint}
            aria-describedby={mint ? undefined : `${id}-motivo`}
            onClick={mint ? onMint : undefined}
            className="w-full min-h-11 rounded-2xl px-4 py-3 font-display font-bold text-sm transition-colors
              bg-grad-gold text-bg disabled:bg-none disabled:bg-bg-3 disabled:text-ink-3 disabled:cursor-not-allowed
              focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {t("founders.mintAction")}
          </button>
          {!mint ? (
            <p id={`${id}-motivo`} className="font-mono text-[11px] text-ink-3 mt-2">
              {t("founders.mintUnavailable")}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Contador({ contagem }: { contagem: Contagem }) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-border-soft bg-bg-2/70 p-3">
      <p className="font-mono text-[10px] tracking-widest uppercase text-ink-3 flex items-center gap-1.5">
        <Clock aria-hidden className="w-3 h-3" /> {t("founders.countdownLabel")}
      </p>
      {contagem.tipo === "antes" ? (
        <p className="mt-1">
          <span className="sr-only">
            {t("founders.countdownAria", { d: contagem.d, h: contagem.h, m: contagem.m, s: contagem.s })}
          </span>
          <span aria-hidden className="grid grid-cols-4 gap-2 text-center">
            {([[contagem.d, "days"], [contagem.h, "hours"], [contagem.m, "minutes"], [contagem.s, "seconds"]] as const).map(([v, k]) => (
              <span key={k} className="flex flex-col">
                <span className="font-display font-extrabold text-xl text-ink tabular-nums">{String(v).padStart(2, "0")}</span>
                <span className="font-mono text-[10px] uppercase text-ink-3">{t(`founders.${k}` as MessageKey)}</span>
              </span>
            ))}
          </span>
        </p>
      ) : (
        <p className="font-sans text-sm text-ink-2 mt-1">
          {contagem.tipo === "sem_hora" ? t("founders.countdownUnknown")
            : contagem.tipo === "durante" ? t("founders.countdownLive")
            : t("founders.countdownEnded")}
        </p>
      )}
    </div>
  );
}

function Progresso({ progresso }: { progresso: VisaoProgresso }) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-border-soft bg-bg-2/70 p-3">
      <p className="font-mono text-[10px] tracking-widest uppercase text-ink-3">{t("founders.progressLabel")}</p>
      {progresso.tipo === "ok" ? (
        <>
          <div
            role="progressbar"
            aria-label={t("founders.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={progresso.supply}
            aria-valuenow={progresso.mintados}
            aria-valuetext={t("founders.progressAria", { minted: progresso.mintados, supply: progresso.supply })}
            className="mt-2 h-2 rounded-full bg-bg-4 overflow-hidden"
          >
            <div className="h-full bg-grad-gold" style={{ width: `${progresso.percentualMintado}%` }} />
          </div>
          <dl className="grid grid-cols-3 gap-2 mt-2 font-mono text-xs">
            <Par rotulo={t("founders.progressMinted")} valor={progresso.mintados} />
            <Par rotulo={t("founders.progressReserved")} valor={progresso.reservados} />
            <Par rotulo={t("founders.progressAvailable")} valor={progresso.disponiveis} />
          </dl>
        </>
      ) : (
        <p className="font-sans text-sm text-ink-2 mt-1">
          {progresso.tipo === "indisponivel" ? t("founders.progressUnavailable") : t("founders.progressInconsistent")}
        </p>
      )}
    </div>
  );
}

function Alocacao({ alocacao }: { alocacao: VisaoAlocacao }) {
  const t = useT();
  const desconhecido = t("founders.unknown");
  const num = (n: number | null) => (n === null ? desconhecido : n);
  return (
    <div className="rounded-2xl border border-border-soft bg-bg-2/70 p-3">
      <p className="font-mono text-[10px] tracking-widest uppercase text-ink-3">{t("founders.allocationLabel")}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 font-mono text-xs">
        <Par rotulo={t("founders.allocation")} valor={num(alocacao.alocacao)} />
        <Par rotulo={t("founders.used")} valor={num(alocacao.usado)} />
        <Par rotulo={t("founders.remaining")} valor={num(alocacao.restante)} />
        <Par rotulo={t("founders.eligibility")} valor={t(`founders.elig_${alocacao.elegibilidade}` as MessageKey)} />
        <Par rotulo={t("founders.proof")} valor={t(`founders.proof_${alocacao.prova}` as MessageKey)} />
      </dl>
    </div>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string | number }) {
  return (
    <div className="min-w-0">
      <dt className="text-ink-3 text-[10px] uppercase tracking-wider">{rotulo}</dt>
      <dd className="text-ink tabular-nums break-words">{valor}</dd>
    </div>
  );
}
