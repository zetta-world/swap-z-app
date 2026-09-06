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

import { useState, useMemo, useEffect, useCallback } from "react";
import { Loader2, AlertTriangle, Info, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { oPedagioAntesDeRodar } from "@/lib/bancada/custo";
import { PRACAS, rotuloDaPraca, type EstrategiaDoCliente, type Praca, type Papel } from "@/lib/bancada/vocabulario";
import { classificarResultado } from "@/lib/admin/cor-resultado";
import { corDoNumero } from "@/components/bancada/CorDoCliente";
import type { ChaveNaoMedido } from "@/lib/bancada/veredito";
import { ESTRATEGIAS_DA_CASA, type EstrategiaDaCasa } from "@/lib/bancada/casa";
import type { CartaoDaMesa } from "@/lib/bancada/mesas-da-casa";
import type { MessageKey } from "@/lib/i18n";

const SIMBOLOS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOT", "MATIC"];
const INTERVALOS = ["1h", "4h", "1d"];

interface Salva {
  id: string; nome: string; arquivada: boolean;
  papelAdiante: boolean; papelDesde: string | null;
}

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

  const [verCasa, setVerCasa] = useState(false);
  const [mesas, setMesas] = useState<CartaoDaMesa[]>([]);
  const [nome, setNome] = useState("");
  const [salvas, setSalvas] = useState<Salva[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [avisoSalvar, setAviso] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const res = await fetch("/api/bancada/estrategias");
      const j = await res.json();
      if (j?.ok) setSalvas(j.estrategias ?? []);
    } catch { /* melhor-esforço: a bancada funciona sem a lista */ }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  useEffect(() => {
    // ⚠️ Melhor-esforço: a bancada funciona sem a vitrine. Falhar aqui não
    // pode impedir alguém de rodar um teste.
    (async () => {
      try {
        const res = await fetch("/api/bancada/mesas-da-casa");
        const j = await res.json();
        if (j?.ok && Array.isArray(j.cartoes)) setMesas(j.cartoes);
      } catch { /* silêncio: a seção some, o resto fica */ }
    })();
  }, []);

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

  async function salvar() {
    setOcupado(true); setAviso(null);
    try {
      const res = await fetch("/api/bancada/estrategias", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estrategia, nome, simbolos, intervalo }),
      });
      const j = await res.json();
      // ⚠️ O motivo vem do SERVIDOR como veio: ele carrega o número exato (o
      // teto do plano, o alvo mínimo) que uma frase genérica apagaria.
      if (!j?.ok) setAviso(j?.porque ?? t("bancada.errorTitle"));
      else { setNome(""); await recarregar(); }
    } catch { setAviso(t("bancada.errorTitle")); }
    finally { setOcupado(false); }
  }

  async function alternarPapel(e: Salva) {
    setOcupado(true); setAviso(null);
    try {
      const res = await fetch("/api/bancada/estrategias", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, papelAdiante: !e.papelAdiante }),
      });
      const j = await res.json();
      if (!j?.ok) setAviso(j?.porque ?? t("bancada.papelSo"));
      await recarregar();
    } catch { setAviso(t("bancada.errorTitle")); }
    finally { setOcupado(false); }
  }

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

      {/* ── O QUE A CASA DE FATO RODA ──────────────────────────────── */}
      {/* ⚠️⚠️ VITRINE, NÃO CLONE — e a diferença é honestidade, não preguiça.
          Estas mesas usam bracket por VOLATILIDADE (stop = ATR×1,5, alvo
          limitado a ATR×√horas×2) e escolhem entre 10 playbooks por regime de
          mercado. O formulário abaixo fala `média|canal|RSI` com percentual
          fixo. Aproximar uma mesa nisso e pôr o nome dela em cima seria o
          cliente rodando uma coisa achando que é outra — com a nossa marca, e
          com números que vieram da regra REAL, não da aproximação. */}
      {mesas.length > 0 && (
        <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5">
          <p className="text-sm font-medium text-ink">{t("bancada.mesasTitulo")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{t("bancada.mesasSub")}</p>
          <ul className="mt-3 space-y-2">
            {mesas.map((m) => <MesaDaCasa key={m.source} m={m} />)}
          </ul>
        </section>
      )}

      {/* ── AS ESTRATÉGIAS DA CASA, INCLUSIVE AS MORTAS ─────────────── */}
      {/* ⚠️ RECOLHIDA POR PADRÃO. Sete entradas com descrição e lápide somam
          uma tela inteira, e no celular empurravam a FERRAMENTA para fora da
          primeira dobra — quem chega via um catálogo, não uma bancada. Ela
          continua a um toque, e o rótulo diz quantas são. */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40">
        <button type="button" onClick={() => setVerCasa((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
          <span>
            <span className="block text-sm font-medium text-ink">
              {t("bancada.casaVer", { n: ESTRATEGIAS_DA_CASA.length })}
            </span>
            <span className="mt-0.5 block text-xs text-ink-3">{t("bancada.casaSub")}</span>
          </span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-ink-3 transition-transform ${verCasa ? "rotate-180" : ""}`} />
        </button>

        {verCasa && (
          <ul className="space-y-2 px-5 pb-5">
            {ESTRATEGIAS_DA_CASA.map((e) => (
              <li key={e.id} className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">
                      {t(e.nomeKey as MessageKey)}{" "}
                      {/* ⚠️ A morta NÃO some e NÃO fica vermelha: ela é o material
                          didático mais barato que temos. Cinza + rótulo. */}
                      <span className={`ml-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] ${
                        e.viva ? "border-cyan/30 text-cyan" : "border-white/10 text-ink-3"}`}>
                        {e.viva ? t("bancada.casaViva") : t("bancada.casaMorta")}
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-3">{t(e.comoFuncionaKey as MessageKey)}</p>
                    {e.medicao && (
                      <p className="mt-1.5 text-xs leading-relaxed">
                        {/* ⚠️ O NÚMERO NUNCA SAI SEM A JANELA. Medição sem data é
                            propaganda, e o resultado da casa não é previsão para
                            a janela do cliente. */}
                        <span className="font-medium text-gold">{e.medicao.resultado}</span>
                        <span className="text-ink-4"> · </span>
                        <span className="text-ink-4">{t("bancada.casaMedidoEm", { quando: e.medicao.quando })}</span>
                        <br />
                        <span className="text-ink-3">{t(e.medicao.porqueKey as MessageKey)}</span>
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => carregar(e)}
                    className={`flex-shrink-0 ${CHIP} ${CHIP_OFF}`}>
                    {t("bancada.casaUsar")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── MONTE SEU TESTE ─────────────────────────────────────────── */}
      {/* ⚠️ AGRUPADO, e não um campo por bloco. A versão anterior dava uma
          linha inteira a cada pergunta: no celular virava uma coluna de
          rolagem sem hierarquia, em que "capital" e "intervalo da vela" tinham
          o mesmo peso visual. §2.4 do plano pede UMA PERGUNTA POR VEZ — o que
          não é o mesmo que um campo por tela. */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 space-y-5">

        {/* dinheiro e janela: os três números que emolduram o teste */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="col-span-2 block sm:col-span-2">
            <span className="mb-1 block text-[11px] text-ink-3">{t("bancada.capital")}</span>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-4">$</span>
              <input type="number" min={1} value={capital} onChange={(e) => setCapital(Number(e.target.value))}
                className={`${INPUT} pl-7`} />
            </div>
          </label>
          <Escolha rotulo={t("bancada.window")} valor={janelaDias} set={setJanela}
            opcoes={[90, 365, 730].map((d) => ({ v: d, r: `${d}${t("bancada.days").slice(0, 1)}` }))} />
          <Escolha rotulo="—" valor={intervalo} set={setIntervalo}
            opcoes={INTERVALOS.map((i) => ({ v: i, r: i }))} />
        </div>

        <Campo rotulo={t("bancada.symbols")}>
          <div className="flex flex-wrap gap-1.5">
            {SIMBOLOS.map((sim) => (
              <button key={sim} type="button"
                onClick={() => setSimbolos((atual) => atual.includes(sim) ? atual.filter((x) => x !== sim) : [...atual, sim])}
                className={`${CHIP} ${simbolos.includes(sim) ? CHIP_ON : CHIP_OFF}`}>
                {sim}
              </button>
            ))}
          </div>
        </Campo>

        {/* ⚠️ O GATILHO EM TRÊS FICHAS CURTAS, com a frase inteira EMBAIXO.
            Antes cada opção era um botão de largura total com a frase dentro
            ("Fechamento cruza a média de 20 períodos"), e três parágrafos
            empilhados não se leem como um seletor — se leem como uma lista. */}
        <Campo rotulo={t("bancada.trigger")}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex gap-1.5">
              {(["media", "canal", "rsi"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setTipo(k)}
                  className={`${CHIP} ${tipo === k ? CHIP_ON : CHIP_OFF}`}>
                  {k === "media" ? t("bancada.triggerMediaCurto")
                    : k === "canal" ? t("bancada.triggerCanalCurto") : t("bancada.triggerRsiCurto")}
                </button>
              ))}
            </div>
            <Mini rotulo={t("bancada.period")} valor={n} set={setN} min={2} max={400} estreito />
            {tipo === "rsi" && <Mini rotulo={t("bancada.level")} valor={nivel} set={setNivel} min={5} max={95} estreito />}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ink-4">
            {tipo === "media" ? t("bancada.triggerMedia", { n })
              : tipo === "canal" ? t("bancada.triggerCanal", { n }) : t("bancada.triggerRsi", { n, nivel })}
          </p>
        </Campo>

        {/* direção, alvo, stop e tempo: as quatro que definem a operação */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Campo rotulo={t("bancada.direction")}>
            <div className="flex gap-1.5">
              {(["compra", "venda"] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDirecao(d)}
                  className={`${CHIP} flex-1 ${direcao === d ? CHIP_ON : CHIP_OFF}`}>
                  {d === "compra" ? t("bancada.buy") : t("bancada.sell")}
                </button>
              ))}
            </div>
          </Campo>
          <Mini rotulo={`${t("bancada.target")} %`} valor={alvoPct} set={setAlvo} min={0.05} max={100} passo={0.1} />
          <Mini rotulo={`${t("bancada.stop")} %`} valor={stopPct} set={setStop} min={0.05} max={100} passo={0.1} />
          <Mini rotulo={`${t("bancada.horizon")} · h`} valor={horasLimite} set={setHoras} min={1} max={2160} />
        </div>

        {/* ⚠️ PRAÇA E PAPEL SEPARADOS. Como seis botões combinados eles
            quebravam em três linhas, e o cliente tinha de procurar a
            combinação certa em vez de escolher duas coisas. */}
        <Campo rotulo={t("bancada.venue")}>
          <div className="flex flex-wrap items-center gap-1.5">
            {PRACAS.map((pr) => (
              <button key={pr} type="button" onClick={() => setPraca(pr)}
                className={`${CHIP} ${praca === pr ? CHIP_ON : CHIP_OFF}`}>
                {rotuloDaPraca(pr)}
              </button>
            ))}
            <span className="mx-1 text-ink-5">·</span>
            {(["maker", "taker"] as const).map((pa) => (
              <button key={pa} type="button" onClick={() => setPapel(pa)}
                className={`${CHIP} ${papel === pa ? CHIP_ON : CHIP_OFF}`}>
                {pa}
              </button>
            ))}
          </div>
        </Campo>
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
          className="mt-4 w-full rounded-xl bg-grad-cyan px-4 py-2.5 text-sm font-medium text-bg disabled:opacity-40">
          {rodando ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t("bancada.running")}</span> : t("bancada.run")}
        </button>
        {r?.ok && typeof r.restamHoje === "number" && (
          <p className="mt-2 text-center text-xs text-ink-3">{t("bancada.quotaLeft", { n: r.restamHoje })}</p>
        )}
      </section>

      {/* ── SALVAR, E AS MESAS VIVAS ────────────────────────────────── */}
      <section className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 space-y-3">
        <div className="flex gap-2">
          <input value={nome} onChange={(e) => setNome(e.target.value)}
            placeholder={t("bancada.nomePlaceholder")} className={INPUT} />
          <button type="button" onClick={salvar} disabled={ocupado}
            className="flex-shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-ink-2 hover:border-cyan/40 hover:text-cyan transition disabled:opacity-40">
            {t("bancada.salvar")}
          </button>
        </div>
        {avisoSalvar && <p className="text-xs text-gold">{avisoSalvar}</p>}

        <div>
          <p className="text-xs text-ink-3">{t("bancada.minhasTitulo")}</p>
          {salvas.length === 0 ? (
            <p className="mt-1 text-xs text-ink-4">{t("bancada.minhasVazio")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {salvas.filter((e) => !e.arquivada).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-bg-2/60 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{e.nome}</p>
                    {/* ⚠️ A mesa viva mostra DESDE QUANDO: resultado de papel
                        adiante sem o tempo decorrido é número sem amostra. */}
                    {e.papelAdiante && e.papelDesde && (
                      <p className="text-[11px] text-green">
                        {t("bancada.papelLigado", { desde: e.papelDesde.slice(0, 10) })}
                      </p>
                    )}
                  </div>
                  <button type="button" onClick={() => alternarPapel(e)} disabled={ocupado}
                    className={`flex-shrink-0 rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-40 ${
                      e.papelAdiante ? "border-green/30 text-green" : "border-white/10 text-ink-3 hover:border-cyan/40 hover:text-cyan"}`}>
                    {e.papelAdiante ? t("bancada.papelDesligar") : t("bancada.papelLigar")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
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

      <div className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
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

/**
 * ⚠️⚠️ `bg-bg-2`, NUNCA `bg-bg-0` — o defeito que o dono viu na tela (06/09).
 *
 * A escala de fundo do tema é `bg` (DEFAULT), `bg-1`…`bg-4`. **`bg-0` não
 * existe.** Uma classe do Tailwind que não resolve simplesmente não vira CSS —
 * ela não avisa, não quebra o build e não aparece em teste nenhum. O `<input>`
 * então caiu no branco padrão do navegador, e a tela inteira ficou com quatro
 * retângulos brancos gritando contra o tema escuro.
 *
 * ⚠️ É a mesma família de "duas fontes, uma silenciosa" que esta base persegue:
 * o token existia na minha cabeça e não no `tailwind.config.ts`.
 */
/** Um cartão de mesa da casa: o que ela é, o que mediu, e o que o número NÃO prova. */
function MesaDaCasa({ m }: { m: CartaoDaMesa }) {
  const t = useT();
  /**
   * ⚠️ A REGRA DE COR É A DO ADMIN, e a amostra tem precedência: abaixo de 100
   * decididas o número sai SEM cor de veredito, por mais bonito que seja.
   */
  const classe = classificarResultado(m.liquidoPorOpPct);
  const cor = corDoNumero(classe, m.sustentacao === "sustenta");

  return (
    <li className="rounded-xl border border-white/5 bg-bg-2/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-ink">
            <span className="mr-1.5 text-ink-3">{m.sigilo}</span>{m.nome}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">{m.subtitulo}</p>
          <p className="mt-1 text-xs italic leading-relaxed text-ink-4">{m.testa}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          {m.liquidoPorOpPct == null ? (
            <span className="text-xs text-ink-4">{t("bancada.mesasSemMedida")}</span>
          ) : (
            <>
              <span className={`block text-base font-semibold ${cor}`}>
                {m.liquidoPorOpPct >= 0 ? "+" : ""}{m.liquidoPorOpPct.toFixed(2)}%
              </span>
              <span className="block text-[10px] text-ink-4">{t("bancada.mesasPorOp")}</span>
            </>
          )}
        </div>
      </div>

      {m.medicao && m.acertoPct != null && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
          <span>{t("bancada.mesasAcerto", { pct: m.acertoPct.toFixed(0), n: m.medicao.decididos })}</span>
          {/* ⚠️ Expirada aparece SEMPRE que existe: ela não é ganho nem perda,
              e uma mesa que expira mais do que decide é outra coisa. */}
          {m.medicao.expiradas > 0 && <span>{t("bancada.mesasExpiradas", { n: m.medicao.expiradas })}</span>}
          <span>{t("bancada.mesasJanela", {
            simbolos: m.medicao.simbolos, dias: m.medicao.dias,
            de: m.medicao.primeiroDia, ate: m.medicao.ultimoDia,
          })}</span>
        </div>
      )}

      {/* ⚠️⚠️ AS RESSALVAS VIAJAM COM O NÚMERO. Publicar "+4,34% por operação"
          sozinho é propaganda; publicá-lo com o que ele NÃO prova é medição — e
          é o que separa esta bancada de um backtester que vende esperança. */}
      {m.ressalvas.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
          {m.ressalvas.map((r) => (
            <li key={r} className="text-[11px] leading-relaxed text-ink-4">· {t(r as MessageKey)}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

const INPUT = "w-full rounded-lg border border-white/10 bg-bg-2/80 px-3 py-2 text-sm text-ink placeholder:text-ink-4 outline-none focus:border-cyan/40";
const CHIP = "rounded-lg border px-2.5 py-1.5 text-xs transition";
const CHIP_ON = "border-cyan/40 bg-cyan/10 text-cyan";
const CHIP_OFF = "border-white/10 text-ink-3 hover:border-white/25 hover:text-ink-2";

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-ink-3">{rotulo}</span>
      {children}
    </label>
  );
}

function Mini({ rotulo, valor, set, min, max, passo = 1, estreito = false }: {
  rotulo: string; valor: number; set: (n: number) => void;
  min: number; max: number; passo?: number; estreito?: boolean;
}) {
  return (
    <label className={estreito ? "block w-20" : "block"}>
      <span className="mb-1 block text-[11px] text-ink-3">{rotulo}</span>
      <input type="number" value={valor} min={min} max={max} step={passo}
        onChange={(e) => set(Number(e.target.value))} className={INPUT} />
    </label>
  );
}

/** Um seletor curto de valor fixo — janela e intervalo, que só têm 3 opções. */
function Escolha<T extends string | number>({ rotulo, valor, set, opcoes }: {
  rotulo: string; valor: T; set: (v: T) => void; opcoes: Array<{ v: T; r: string }>;
}) {
  return (
    <div>
      <span className="mb-1 block text-[11px] text-ink-3">{rotulo}</span>
      <div className="flex gap-1">
        {opcoes.map((o) => (
          <button key={String(o.v)} type="button" onClick={() => set(o.v)}
            className={`${CHIP} flex-1 px-1.5 ${valor === o.v ? CHIP_ON : CHIP_OFF}`}>
            {o.r}
          </button>
        ))}
      </div>
    </div>
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
