"use client";

/**
 * A BANCADA — a tela do cliente.
 *
 * ⚠️⚠️ ELA NÃO É O NOSSO LABORATÓRIO COM OUTRA PINTURA. O `/admin` tem 29 mesas,
 * seis a nove colunas por painel e três avisos em âmbar; funciona para quem
 * construiu. Aqui a régua é outra: **uma pergunta por vez, e o custo sempre à
 * vista**.
 *
 * ⚠️ O BLOCO DO PEDÁGIO APARECE ANTES DO BOTÃO e reage a cada tecla. Quem
 * digitar alvo de 0,6% lê *"você precisaria acertar 83%"* sem gastar rodada
 * nenhuma. Metade das ideias ruins morre ali, de graça — e é o melhor negócio
 * possível para os dois lados: ele não perde dinheiro e nós não gastamos CPU.
 *
 * ⚠️ E O VEREDITO VEM ANTES DO PLACAR. Número grande primeiro faz retorno
 * parecer aprovação: foi assim que a grade apareceu VERDE tendo perdido metade
 * do capital.
 */

import { useState, useMemo } from "react";
import { Loader2, AlertTriangle, Info } from "lucide-react";
import { useT } from "@/lib/i18n";
import { oPedagioAntesDeRodar } from "@/lib/bancada/custo";
import { PRACAS, rotuloDaPraca, type EstrategiaDoCliente, type Praca, type Papel } from "@/lib/bancada/vocabulario";
import { classificarResultado } from "@/lib/admin/cor-resultado";
import { corDoNumero } from "@/components/bancada/CorDoCliente";
import type { ChaveNaoMedido } from "@/lib/bancada/veredito";
import { ESTRATEGIAS_DA_CASA, type EstrategiaDaCasa } from "@/lib/bancada/casa";
import type { MessageKey } from "@/lib/i18n";

const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC"];
const INTERVALOS = ["1h", "4h", "1d"];

interface Resposta {
  ok: boolean;
  error?: string;
  porque?: string;
  restamHoje?: number;
  upgradeUrl?: string;
  veredito?: {
    veredito: "perdeu" | "ganhou" | "ganhou_perdendo_do_indice" | "ruido";
    pinta: boolean;
    competidorPct: number | null;
    equilibrioPct: number | null;
    naoMedidoChaves: ChaveNaoMedido[];
  };
  resumo?: {
    n: number; acertos: number; acertoPct: number | null;
    brutoPct: number; taxaPct: number; liquidoCompostoPct: number;
  };
}

export default function Bancada() {
  const t = useT();

  const [capital, setCapital] = useState(1000);
  const [simbolos, setSimbolos] = useState<string[]>(["BTC"]);
  const [tipo, setTipo] = useState<"media" | "canal" | "rsi">("media");
  const [n, setN] = useState(20);
  const [nivel, setNivel] = useState(30);
  const [direcao, setDirecao] = useState<"compra" | "venda">("compra");
  const [alvoPct, setAlvo] = useState(2.5);
  const [stopPct, setStop] = useState(2.5);
  const [horasLimite, setHoras] = useState(48);
  const [praca, setPraca] = useState<Praca>("spot_gate");
  const [papel, setPapel] = useState<Papel>("taker");
  const [intervalo, setIntervalo] = useState("1d");
  const [janelaDias, setJanela] = useState(365);

  const [rodando, setRodando] = useState(false);
  const [r, setR] = useState<Resposta | null>(null);

  /**
   * ⚠️ CARREGAR UMA DA CASA É SÓ PREENCHER O FORMULÁRIO — nada roda sozinho.
   *
   * O cliente vê os parâmetros mudarem, o bloco do pedágio reagir na hora, e
   * decide. Se o botão disparasse a rodada, a estratégia morta gastaria cota
   * para ensinar o que o portão ensina de graça.
   */
  function carregar(e: EstrategiaDaCasa) {
    setTipo(e.params.entrada.tipo);
    setN(e.params.entrada.n);
    if (e.params.entrada.tipo === "rsi") setNivel(e.params.entrada.nivel);
    setDirecao(e.params.direcao);
    setAlvo(e.params.alvoPct);
    setStop(e.params.stopPct);
    setHoras(e.params.horasLimite);
    setPraca(e.params.praca);
    setPapel(e.params.papel);
    setR(null);
  }

  const estrategia: EstrategiaDoCliente = useMemo(() => ({
    entrada: tipo === "rsi" ? { tipo, n, nivel } : { tipo, n },
    direcao, alvoPct, stopPct, horasLimite, praca, papel,
  }), [tipo, n, nivel, direcao, alvoPct, stopPct, horasLimite, praca, papel]);

  /**
   * ⚠️ O PEDÁGIO É CALCULADO AQUI, NO CLIENTE, pela MESMA função do servidor —
   * a tabela de taxas é literal e idêntica dos dois lados. O que NÃO se decide
   * aqui é a recusa: quem tem a palavra final é a rota, e a resposta dela é que
   * vira mensagem. Uma UI que negasse por conta própria poderia divergir do
   * servidor sem ninguém perceber.
   */
  const pedagio = useMemo(() => oPedagioAntesDeRodar(estrategia), [estrategia]);

  async function rodar() {
    setRodando(true); setR(null);
    try {
      const res = await fetch("/api/bancada/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estrategia, simbolos, intervalo, capitalUsd: capital, janelaDias }),
      });
      setR(await res.json());
    } catch {
      setR({ ok: false, error: "rede", porque: "" });
    } finally {
      setRodando(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">{t("bancada.title")}</h1>
        <p className="mt-1 text-sm text-ink-3">{t("bancada.subtitle")}</p>
      </header>

      {/* ── AS ESTRATÉGIAS DA CASA, INCLUSIVE AS MORTAS ─────────────── */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5">
        <p className="text-sm font-medium text-ink">{t("bancada.casaTitulo")}</p>
        <p className="mt-0.5 text-xs text-ink-3">{t("bancada.casaSub")}</p>
        <ul className="mt-3 space-y-2">
          {ESTRATEGIAS_DA_CASA.map((e) => (
            <li key={e.id} className="rounded-xl border border-white/5 bg-bg-0/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink">
                    {t(e.nomeKey as MessageKey)}{" "}
                    {/* ⚠️ A morta NÃO some e NÃO fica vermelha: ela é o material
                        didático mais barato que temos. Cinza + rótulo. */}
                    <span className={`ml-1 rounded border px-1.5 py-0.5 text-[10px] ${
                      e.viva ? "border-cyan/30 text-cyan" : "border-white/10 text-ink-3"}`}>
                      {e.viva ? t("bancada.casaViva") : t("bancada.casaMorta")}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-ink-3">{t(e.comoFuncionaKey as MessageKey)}</p>
                  {e.medicao && (
                    <p className="mt-1.5 text-xs text-gold/90">
                      {/* ⚠️ O NÚMERO NUNCA SAI SEM A JANELA. Medição sem data é
                          propaganda, e o resultado da casa não é previsão para
                          a janela do cliente. */}
                      <span className="font-medium">{e.medicao.resultado}</span>
                      <span className="text-ink-4"> · </span>
                      <span className="text-ink-3">{t("bancada.casaMedidoEm", { quando: e.medicao.quando })}</span>
                      <br />
                      <span className="text-ink-3">{t(e.medicao.porqueKey as MessageKey)}</span>
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => carregar(e)}
                  className="flex-shrink-0 rounded-lg border border-white/10 px-2.5 py-1 text-xs text-ink-2 hover:border-cyan/40 hover:text-cyan transition">
                  {t("bancada.casaUsar")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── MONTE SEU TESTE ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 space-y-4">
        <Campo rotulo={t("bancada.capital")}>
          <input type="number" min={1} value={capital} onChange={(e) => setCapital(Number(e.target.value))}
            className={INPUT} />
        </Campo>

        <Campo rotulo={t("bancada.symbols")}>
          <div className="flex flex-wrap gap-1.5">
            {SIMBOLOS.map((s) => (
              <button key={s} type="button"
                onClick={() => setSimbolos((atual) => atual.includes(s) ? atual.filter((x) => x !== s) : [...atual, s])}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  simbolos.includes(s) ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/5 text-ink-3 hover:border-white/15"}`}>
                {s}
              </button>
            ))}
          </div>
        </Campo>

        <Campo rotulo={t("bancada.trigger")}>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {(["media", "canal", "rsi"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTipo(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    tipo === k ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/5 text-ink-3 hover:border-white/15"}`}>
                  {k === "media" ? t("bancada.triggerMedia", { n }) : k === "canal" ? t("bancada.triggerCanal", { n }) : t("bancada.triggerRsi", { n, nivel })}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Mini rotulo={t("bancada.period")} valor={n} set={setN} min={2} max={400} />
              {tipo === "rsi" && <Mini rotulo={t("bancada.level")} valor={nivel} set={setNivel} min={5} max={95} />}
            </div>
          </div>
        </Campo>

        <Campo rotulo={t("bancada.direction")}>
          <div className="flex gap-1.5">
            {(["compra", "venda"] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDirecao(d)}
                className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                  direcao === d ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/5 text-ink-3 hover:border-white/15"}`}>
                {d === "compra" ? t("bancada.buy") : t("bancada.sell")}
              </button>
            ))}
          </div>
        </Campo>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Mini rotulo={`${t("bancada.target")} %`} valor={alvoPct} set={setAlvo} min={0.05} max={100} passo={0.1} />
          <Mini rotulo={`${t("bancada.stop")} %`} valor={stopPct} set={setStop} min={0.05} max={100} passo={0.1} />
          <Mini rotulo={`${t("bancada.horizon")} (${t("bancada.hours")})`} valor={horasLimite} set={setHoras} min={1} max={2160} />
        </div>

        <Campo rotulo={t("bancada.venue")}>
          <div className="flex flex-wrap gap-1.5">
            {PRACAS.flatMap((p) => (["maker", "taker"] as const).map((pa) => (
              <button key={`${p}-${pa}`} type="button" onClick={() => { setPraca(p); setPapel(pa); }}
                className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                  praca === p && papel === pa ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/5 text-ink-3 hover:border-white/15"}`}>
                {rotuloDaPraca(p)} · {pa}
              </button>
            )))}
          </div>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo={t("bancada.window")}>
            <div className="flex gap-1.5">
              {[90, 365, 730].map((d) => (
                <button key={d} type="button" onClick={() => setJanela(d)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    janelaDias === d ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/5 text-ink-3 hover:border-white/15"}`}>
                  {d} {t("bancada.days")}
                </button>
              ))}
            </div>
          </Campo>
          <Campo rotulo="—">
            <div className="flex gap-1.5">
              {INTERVALOS.map((i) => (
                <button key={i} type="button" onClick={() => setIntervalo(i)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    intervalo === i ? "border-cyan/40 bg-cyan/10 text-cyan" : "border-white/5 text-ink-3 hover:border-white/15"}`}>
                  {i}
                </button>
              ))}
            </div>
          </Campo>
        </div>
      </section>

      {/* ── O PEDÁGIO, ANTES DO BOTÃO ───────────────────────────────── */}
      <section className={`rounded-2xl border p-5 ${
        pedagio.severidade === "grave" ? "border-red/30 bg-red/5"
        : pedagio.severidade === "atencao" ? "border-gold/30 bg-gold/5"
        : "border-white/5 bg-bg-1/40"}`}>
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide text-ink-2">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t("bancada.tollTitle")}
        </div>
        <p className="mt-2 text-sm text-ink">
          {t("bancada.tollRoundTrip", {
            pct: pedagio.idaEVoltaPct.toFixed(3),
            fatia: pedagio.fatiaDoAlvo == null ? "—" : (pedagio.fatiaDoAlvo * 100).toFixed(0),
          })}
        </p>
        {pedagio.equilibrio && (
          <p className={`mt-1 text-sm ${pedagio.equilibrio.alcancavel ? "text-ink-2" : "text-red"}`}>
            {pedagio.equilibrio.alcancavel
              ? t("bancada.tollBreakeven", { pct: pedagio.equilibrio.acertoParaEmpatarPct.toFixed(1) })
              : t("bancada.tollImpossible")}
          </p>
        )}

        <button type="button" onClick={rodar} disabled={rodando || simbolos.length === 0}
          className="mt-4 w-full rounded-xl bg-grad-cyan px-4 py-2.5 text-sm font-medium text-bg-0 disabled:opacity-40">
          {rodando ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t("bancada.running")}</span> : t("bancada.run")}
        </button>
        {r?.ok && typeof r.restamHoje === "number" && (
          <p className="mt-2 text-center text-xs text-ink-3">{t("bancada.quotaLeft", { n: r.restamHoje })}</p>
        )}
      </section>

      {/* ── O VEREDITO, ANTES DO PLACAR ─────────────────────────────── */}
      {r && !r.ok && (
        <section className="rounded-2xl border border-gold/30 bg-gold/5 p-5">
          <p className="text-sm font-medium text-gold">{t("bancada.errorTitle")}</p>
          {/* ⚠️ O motivo vem do SERVIDOR e é mostrado como veio: ele carrega o
              número exato (o alvo mínimo, o teto do plano) que uma tradução
              genérica apagaria. */}
          {r.porque && <p className="mt-1 text-sm text-ink-2">{r.porque}</p>}
          {r.upgradeUrl && (
            <a href={r.upgradeUrl} className="mt-3 inline-block text-xs text-cyan underline">{t("bancada.upgrade")}</a>
          )}
        </section>
      )}

      {r?.ok && r.veredito && r.resumo && <Veredito r={r} />}
    </div>
  );
}

function Veredito({ r }: { r: Resposta }) {
  const t = useT();
  const v = r.veredito!;
  const s = r.resumo!;

  const titulo =
    s.n === 0 ? t("bancada.verdictNoTrades")
    : v.veredito === "perdeu" ? t("bancada.verdictLost")
    : v.veredito === "ganhou" ? t("bancada.verdictWon")
    : v.veredito === "ganhou_perdendo_do_indice" ? t("bancada.verdictBehind")
    : t("bancada.verdictNoise");

  /**
   * ⚠️ A CLASSIFICAÇÃO VEM DA REGRA DO ADMIN (`classificarResultado`), a COR vem
   * da paleta do cliente. É a regra que atravessa, nunca o CSS.
   */
  const classe = classificarResultado(
    s.n > 0 ? s.liquidoCompostoPct : null,
    v.competidorPct == null ? null : s.liquidoCompostoPct - v.competidorPct,
  );
  const cor = corDoNumero(classe, v.pinta);

  const NM: Record<ChaveNaoMedido, string> = {
    derrapagem: t("bancada.nmSlippage"),
    gas:        t("bancada.nmGas"),
    liquidez:   t("bancada.nmLiquidity"),
    competidor: t("bancada.nmCompetitor"),
  };

  return (
    <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 space-y-4">
      <p className={`text-lg font-semibold ${cor}`}>{titulo}</p>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <Numero rotulo={t("bancada.gross")} valor={s.brutoPct} />
        <Numero rotulo={t("bancada.fees")} valor={s.taxaPct} />
        <Numero rotulo={t("bancada.net")} valor={s.liquidoCompostoPct} destaque cor={cor} />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        <span>{t("bancada.sample", { n: s.n })}</span>
        {s.acertoPct != null && v.equilibrioPct != null && (
          <span>{t("bancada.hitRate", { pct: s.acertoPct.toFixed(0), alvo: v.equilibrioPct.toFixed(1) })}</span>
        )}
        {/* ⚠️ `null` é CINZA e diz "—", nunca 0%: não medimos ≠ ficou parado. */}
        <span>{t("bancada.holding")}: {v.competidorPct == null ? "—" : `${v.competidorPct.toFixed(2)}%`}</span>
      </div>

      <div className="rounded-xl border border-white/5 bg-bg-0/40 p-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
          <Info className="h-3 w-3" />
          {t("bancada.notMeasured")}
        </div>
        <ul className="mt-1.5 space-y-1 text-xs text-ink-3">
          {v.naoMedidoChaves.map((k) => <li key={k}>· {NM[k]}</li>)}
        </ul>
      </div>
    </section>
  );
}

const INPUT = "w-full rounded-lg border border-white/5 bg-bg-0/60 px-3 py-2 text-sm text-ink outline-none focus:border-cyan/40";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-ink-3">{rotulo}</span>
      {children}
    </label>
  );
}

function Mini({ rotulo, valor, set, min, max, passo = 1 }: {
  rotulo: string; valor: number; set: (n: number) => void; min: number; max: number; passo?: number;
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1 block text-[11px] text-ink-3">{rotulo}</span>
      <input type="number" value={valor} min={min} max={max} step={passo}
        onChange={(e) => set(Number(e.target.value))} className={INPUT} />
    </label>
  );
}

function Numero({ rotulo, valor, destaque = false, cor }: {
  rotulo: string; valor: number; destaque?: boolean; cor?: string;
}) {
  return (
    <div>
      <span className="block text-[11px] text-ink-3">{rotulo}</span>
      <span className={`${destaque ? `text-base font-semibold ${cor ?? "text-ink"}` : "text-ink-2"}`}>
        {valor >= 0 ? "+" : ""}{valor.toFixed(2)}%
      </span>
    </div>
  );
}
