"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Pause, Play, Square, AlertTriangle } from "lucide-react";
import { lerCiclos, porCiclo, MAX_CICLOS } from "@/lib/orders/plano";
import { projetarTaxa, compararComRealizado, precoMedio } from "@/lib/dca/custo";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { CexCredentials, CexId } from "@/lib/cex/types";

/**
 * DCA NA CORRETORA — planos que rodam SEM o usuário.
 * (`docs/PLANO-DCA-AUTOMATICO.md` D6)
 *
 * ⚠️⚠️ ESTA TELA PEDE UMA COISA QUE O RESTO DO CONSOLE NÃO PEDE.
 *
 * O console de CEX guarda as credenciais NO NAVEGADOR, atrás de senha e com
 * auto-lock de 10 minutos. Um plano de DCA não pode viver assim: o cron roda
 * quando o usuário está dormindo. Criar um plano significa entregar ao
 * servidor uma cópia CIFRADA da chave.
 *
 * Isso é um consentimento, não um detalhe de implementação — e por isso o
 * aviso é a PRIMEIRA coisa da tela, não um asterisco no rodapé.
 *
 * ⚠️ E A TELA DIZ QUE O CRON NÃO ESTÁ AGENDADO. Enquanto o job não existir no
 * cron-job.org, o plano fica salvo e NADA roda. Deixar isso implícito seria a
 * interface afirmando o que o sistema não faz — o padrão que as auditorias de
 * 23–24/08 acharam dez vezes.
 */

type Plano = {
  id: string; symbol: string; intervalo: string; status: string;
  modo: "simulado" | "real";
  ciclos_total: number; ciclos_feitos: number; ciclos_pulados: number;
  orcamento_total_usd: number; por_ciclo_usd: number; gasto_acumulado_usd: number;
  next_run_at: string; encerrado_por: string | null;
};
type Ciclo = {
  ciclo_numero: number; status: string; motivo: string | null;
  agendado_para: string; executado_em: string | null;
  preco: number | null; quantidade: number | null; custo_usd: number | null;
  taxa_usd: number | null;
  simulado: boolean;
};

const INTERVALOS: { v: string; k: MessageKey }[] = [
  { v: "hourly",  k: "orders.freqHourly"  },
  { v: "daily",   k: "orders.freqDaily"   },
  { v: "weekly",  k: "orders.freqWeekly"  },
  { v: "monthly", k: "orders.freqMonthly" },
];

const COR_CICLO: Record<string, string> = {
  feito:     "text-green",
  pulado:    "text-gold",
  falhou:    "text-red",
  reservado: "text-cyan",
};

export default function DcaPanel({ exchangeId = "gateio", credentials = null }: {
  exchangeId?: CexId;
  /**
   * ⚠️⚠️ OPCIONAL — e este parâmetro é o conserto de uma contradição minha.
   *
   * Eu construí o modo simulado para o dono poder testar SEM chave e SEM saldo,
   * e depois pendurei a tela dentro do `CexConsole`, que começa com
   * `if (!creds) return <tela de desbloqueio>`. O modo que existia para
   * dispensar credencial ficou atrás de uma porta que exige credencial.
   *
   * Ele bateu nisso na primeira tentativa de usar: "essas duas não tenho saldo
   * para fazer".
   *
   * Sem credencial, este painel roda em SIMULADO e diz por que o real está
   * fechado. Com credencial, os dois modos.
   */
  credentials?: CexCredentials | null;
} = {}) {
  const t = useT();
  const [planos, setPlanos]   = useState<Plano[] | null>(null);
  /**
   * ⚠️ `undefined` = ainda não perguntei. `null` dentro = o cron NUNCA rodou.
   * Um número = minutos desde a última passada. Os três estados são
   * diferentes, e juntá-los faria a tela afirmar o que não sabe.
   */
  const [cron, setCron] = useState<{ haMinutos: number | null } | undefined>();
  const [ciclos, setCiclos]   = useState<Record<string, Ciclo[]>>({});
  const [aberto, setAberto]   = useState<string | null>(null);
  const [symbol, setSymbol]   = useState("BTC/USDT");
  const [orcamento, setOrcamento] = useState("");
  const [ciclosTxt, setCiclosTxt] = useState("12");
  const [intervalo, setIntervalo] = useState("daily");
  /**
   * ⚠️ NASCE SIMULADO. Trocar para dinheiro real é um clique deliberado, e o
   * servidor recusa qualquer valor que não seja exatamente "real" — campo
   * ausente ou typo não podem acabar comprando.
   */
  const [modo, setModo] = useState<"simulado" | "real">("simulado");
  /** Sem chave no cofre, o modo real não tem como existir. */
  const temChave = Boolean(credentials?.apiKey && credentials?.apiSecret);
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/dca/planos");
      const j = await r.json();
      setPlanos(r.ok && Array.isArray(j.planos) ? j.planos : []);
      if (r.ok && j.cron) setCron(j.cron);
    } catch {
      // ⚠️ `null` seguiria dizendo "carregando" para sempre; `[]` diria "não há
      // planos", que é AFIRMAR o que não se sabe. Um array vazio com erro na
      // tela é a única leitura honesta — e o toast é o erro.
      setPlanos([]);
      toast.error(t("common.error"));
    }
  }, [t]);

  useEffect(() => { void carregar(); }, [carregar]);

  const c = lerCiclos(ciclosTxt);
  const cada = c.ok ? porCiclo(orcamento, c.ciclos, 8) : null;
  /**
   * ⚠️ A projeção usa o MESMO `porCiclo` que a tela já mostra, e não uma conta
   * própria — duas aritméticas para o mesmo plano divergiriam no primeiro
   * arredondamento, e o dono veria uma taxa que não fecha com o valor exibido.
   */
  const projecao = c.ok && cada
    ? projetarTaxa({
        orcamentoTotalUsd: Number(orcamento),
        porCicloUsd:       Number(cada),
        ciclosTotal:       c.ciclos,
      })
    : null;
  const podeCriar = c.ok && Boolean(cada) && !criando;

  const motivoCiclos = (): string | null => {
    if (c.ok) return null;
    if (c.motivo === "vazio")        return t("orders.cyclesEmpty");
    if (c.motivo === "nao_inteiro")  return t("orders.cyclesNotInteger");
    if (c.motivo === "menor_que_um") return t("orders.cyclesTooSmall");
    return t("orders.cyclesTooMany", { max: String(MAX_CICLOS) });
  };

  const criar = async () => {
    if (!podeCriar) return;
    setCriando(true);
    try {
      const r = await fetch("/api/dca/planos", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          exchangeId, symbol, intervalo, modo,
          orcamentoTotalUsd: Number(orcamento), ciclosTotal: ciclosTxt,
          // ⚠️ A chave só viaja no modo REAL. No simulado o servidor nem a pede,
          // e mandar assim mesmo seria expor segredo sem necessidade.
          ...(modo === "real" && credentials ? { credentials: {
            apiKey: credentials.apiKey, apiSecret: credentials.apiSecret,
            passphrase: credentials.passphrase,
          } } : {}),
        }),
      });
      const j = await r.json();
      // ⚠️ Confere o corpo, não só o status: a rota devolve `ok:false` com 400
      // e 500, e tratar como sucesso deixaria o dono achando que criou.
      if (!r.ok || !j.ok) throw new Error(String(j.error ?? r.status));
      toast.success(modo === "real" ? t("cex.dcaCreated") : t("cex.dcaSimCreated"));
      setOrcamento("");
      await carregar();
    } catch (e) {
      toast.error(`${t("cex.dcaFailed")}: ${String(e).slice(0, 80)}`);
    } finally {
      setCriando(false);
    }
  };

  const agir = async (id: string, acao: string) => {
    if (acao === "encerrar" && !window.confirm(t("cex.dcaEndConfirm"))) return;
    try {
      const r = await fetch("/api/dca/planos", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, acao }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(String(j.error ?? r.status));
      await carregar();
    } catch (e) {
      toast.error(String(e).slice(0, 100));
    }
  };

  const verExtrato = async (id: string) => {
    if (aberto === id) { setAberto(null); return; }
    setAberto(id);
    if (ciclos[id]) return;
    try {
      const r = await fetch(`/api/dca/planos?plano=${encodeURIComponent(id)}`);
      const j = await r.json();
      if (r.ok && Array.isArray(j.ciclos)) setCiclos((m) => ({ ...m, [id]: j.ciclos }));
    } catch { toast.error(t("common.error")); }
  };

  return (
    <div className="space-y-4">
      {/**
        * ⚠️⚠️ O ESTADO DO CRON VEM PRIMEIRO, E É MEDIDO — não afirmado.
        *
        * Aqui havia uma faixa fixa dizendo "o cron ainda não está agendado".
        * Era verdade quando foi escrita e virou mentira no minuto em que o dono
        * criou o job. Aviso codificado à mão envelhece sozinho: ou mente, ou
        * vira ruído que se aprende a ignorar.
        *
        * Agora lê o heartbeat que o próprio cron grava. Se ele parar, a tela
        * volta a avisar sozinha.
        */}
      {cron && (cron.haMinutos === null || cron.haMinutos > 20 ? (
        <div className="rounded-xl border border-red/25 bg-red/[0.05] px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
            {cron.haMinutos === null
              ? t("cex.dcaCronNunca")
              : t("cex.dcaCronParado", { min: String(cron.haMinutos) })}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-green/20 bg-green/[0.04] px-3 py-2 flex items-center gap-2">
          <CalendarClock className="w-3.5 h-3.5 text-green flex-shrink-0" />
          <p className="font-mono text-[10px] text-ink-3">
            {t("cex.dcaCronVivo", { min: String(cron.haMinutos) })}
          </p>
        </div>
      ))}

      {/* ⚠️ O CONSENTIMENTO SÓ APARECE NO MODO REAL — porque só ali ele é
          verdade. Mostrá-lo no simulado seria pedir permissão para algo que
          não vai acontecer, e avisos que não se aplicam ensinam a ignorar
          avisos. */}
      {modo === "real" && (
        <div className="rounded-xl border border-gold/25 bg-gold/[0.05] p-3">
          <div className="font-display font-bold text-xs text-gold mb-1">{t("cex.dcaConsentTitle")}</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">{t("cex.dcaConsentBody")}</p>
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-bg-2/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-violet" />
          <span className="font-display font-bold text-sm text-ink">{t("cex.dcaTitle")}</span>
        </div>

        {/* ⚠️ O MODO VEM PRIMEIRO, antes de qualquer número. É a decisão que
            muda o significado de todo o resto do formulário. */}
        <Campo label={t("cex.dcaMode")}>
          <div className="grid grid-cols-2 gap-1.5">
            {(["simulado", "real"] as const).map((m) => {
              // ⚠️ O botão do real fica DESABILITADO sem chave, não escondido.
              // Escondê-lo faria o recurso parecer inexistente; desabilitado com
              // motivo diz o que falta para destravá-lo.
              const bloqueado = m === "real" && !temChave;
              return (
                <button key={m} type="button" disabled={bloqueado}
                  onClick={() => !bloqueado && setModo(m)}
                  title={bloqueado ? t("cex.dcaRealPrecisaChave") : undefined}
                  className={cn(
                    "px-3 py-2 rounded-lg border font-mono text-[11px] tracking-widest uppercase transition-colors",
                    bloqueado ? "border-white/5 text-ink-4/40 cursor-not-allowed"
                    : modo === m
                      ? (m === "real" ? "border-red/40 bg-red/[0.08] text-red" : "border-cyan/40 bg-cyan/[0.08] text-cyan")
                      : "border-white/10 text-ink-4 hover:text-ink-3",
                  )}>
                  {t(m === "real" ? "cex.dcaModeReal" : "cex.dcaModeSim")}
                </button>
              );
            })}
          </div>
          <p className="font-sans text-[10px] text-ink-3 leading-relaxed mt-1.5">
            {t(modo === "real" ? "cex.dcaModeRealHelp" : "cex.dcaModeSimHelp")}
          </p>
          {!temChave && (
            <p className="font-sans text-[10px] text-gold/80 leading-relaxed mt-1">
              {t("cex.dcaRealPrecisaChave")}
            </p>
          )}
        </Campo>

        <div className="grid grid-cols-2 gap-2">
          <Campo label={t("cex.dcaPair")}>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-violet/30" />
          </Campo>
          <Campo label={t("cex.dcaEvery")}>
            <select value={intervalo} onChange={(e) => setIntervalo(e.target.value)}
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 uppercase tracking-widest">
              {INTERVALOS.map((i) => <option key={i.v} value={i.v}>{t(i.k)}</option>)}
            </select>
          </Campo>
          <Campo label={t("cex.dcaBudget")}>
            <input inputMode="decimal" value={orcamento} onChange={(e) => setOrcamento(e.target.value)}
              placeholder="0.00"
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-violet/30" />
          </Campo>
          <Campo label={t("cex.dcaCycles")}>
            {/* ⚠️ min/step presentes — a ausência deles foi um dos achados da
                auditoria de hoje na aba /orders. */}
            <input type="number" min={1} max={MAX_CICLOS} step={1} value={ciclosTxt}
              onChange={(e) => setCiclosTxt(e.target.value)}
              className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink outline-none focus:border-violet/30" />
          </Campo>
        </div>

        {!c.ok && (
          <div className="rounded-lg border border-gold/25 bg-gold/[0.05] px-3 py-2 font-mono text-[11px] text-gold">
            {motivoCiclos()}
          </div>
        )}
        {cada && (
          <div className="font-mono text-[11px] text-violet">
            {t("cex.dcaPerCycle", { value: cada })}
          </div>
        )}

        {/* ⚠️ A TAXA APARECE ANTES DE CRIAR, não depois de pagar (26/08).
            Num plano de $10 x 90 ciclos a 0,2% por ordem são $1,80 — 1,8% do
            orçamento que a tela nunca escrevia em lugar nenhum. E o que faz
            decidir é a PORCENTAGEM, não o valor: "$1,80" não diz nada sozinho.
            O aviso do que a estimativa NÃO cobre vai junto, porque derrapagem
            não foi medida para estes pares e omiti-la deixaria o número
            parecendo mais exato do que é. */}
        {projecao?.ok && (
          <div className="rounded-lg border border-white/10 bg-bg-2/40 px-3 py-2 space-y-0.5">
            <div className="font-mono text-[11px] text-ink-2">
              {t("cex.dcaFeeEstimate", {
                usd: projecao.taxaTotalUsd.toFixed(2),
                pct: projecao.pctDoOrcamento.toFixed(2),
                rate: String(projecao.taxaPct),
              })}
            </div>
            {/* ⚠️ Quando o orçamento acaba antes da contagem, o plano roda
                MENOS ciclos do que o dono pediu. Dizer isso aqui evita a
                surpresa de um plano que se encerra "cedo" sem explicação. */}
            {c.ok && projecao.ciclosQueVaoRodar !== c.ciclos && (
              <div className="font-mono text-[10px] text-gold">
                {t("cex.dcaFeeCycles", { n: String(projecao.ciclosQueVaoRodar) })}
              </div>
            )}
            <div className="font-mono text-[10px] text-ink-4">{t("cex.dcaFeeExcludes")}</div>
          </div>
        )}

        <button onClick={criar} disabled={!podeCriar}
          className="w-full btn btn-primary py-3 text-sm tracking-widest disabled:opacity-40">
          {t("cex.dcaCreate")}
        </button>
      </div>

      {/* ── os planos ─────────────────────────────────────────────── */}
      {planos === null ? (
        <div className="font-mono text-[11px] text-ink-4">…</div>
      ) : planos.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-bg-2/30 p-4">
          <div className="font-display font-bold text-xs text-ink-2">{t("cex.dcaNone")}</div>
          {/* ⚠️ Invariante nº 33: vazio-por-ausência tem de ser distinguível de
              vazio-por-falha, e a tela DIZ qual dos dois é. */}
          <p className="font-mono text-[10px] text-ink-4 mt-1">{t("cex.dcaNoneHint")}</p>
        </div>
      ) : planos.map((p) => (
        <div key={p.id} className="rounded-xl border border-white/10 bg-bg-2/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-sm text-ink">{p.symbol}</span>
              {/* ⚠️ O SELO É PERMANENTE. O modo não muda depois de criado, então
                  ninguém confunde extrato simulado com compra que houve. */}
              <span className={cn("font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded border",
                p.modo === "real"
                  ? "text-red border-red/30 bg-red/5"
                  : "text-cyan border-cyan/30 bg-cyan/5")}>
                {t(p.modo === "real" ? "cex.dcaModeReal" : "cex.dcaModeSim")}
              </span>
            </div>
            <span className={cn("font-mono text-[9px] tracking-widest uppercase px-1.5 py-0.5 rounded border",
              p.status === "ativo"    ? "text-green border-green/30 bg-green/5"
              : p.status === "pausado" ? "text-gold border-gold/30 bg-gold/5"
              : "text-ink-3 border-white/10")}>
              {p.status}{p.encerrado_por ? ` · ${p.encerrado_por}` : ""}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-ink-3">
            <span>{t("cex.dcaDone", { done: String(p.ciclos_feitos), total: String(p.ciclos_total) })}</span>
            {/* ⚠️ PULADOS APARECEM SEMPRE que houver — somar com "feitos" daria
                um plano "completo" que comprou metade. */}
            {p.ciclos_pulados > 0 && (
              <span className="text-gold">{t("cex.dcaSkipped", { n: String(p.ciclos_pulados) })}</span>
            )}
            {/* ⚠️ "gastos" e "simulados" são frases DIFERENTES. Um plano
                simulado que dissesse "gastos" seria a tela afirmando uma
                compra que não houve. */}
            <span className={p.modo === "simulado" ? "text-cyan" : undefined}>
              {t(p.modo === "real" ? "cex.dcaSpent" : "cex.dcaSpentSim", {
                spent:  Number(p.gasto_acumulado_usd).toFixed(2),
                budget: Number(p.orcamento_total_usd).toFixed(2),
              })}
            </span>
            {p.status === "ativo" && (
              <span>{t("cex.dcaNext", { when: new Date(p.next_run_at).toLocaleString() })}</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {p.status === "ativo" && (
              <Acao onClick={() => agir(p.id, "pausar")} Icon={Pause} label={t("cex.dcaPause")} />
            )}
            {p.status === "pausado" && (
              <Acao onClick={() => agir(p.id, "retomar")} Icon={Play} label={t("cex.dcaResume")} />
            )}
            {(p.status === "ativo" || p.status === "pausado") && (
              <Acao onClick={() => agir(p.id, "encerrar")} Icon={Square} label={t("cex.dcaEnd")} tone="red" />
            )}
            <button onClick={() => verExtrato(p.id)}
              className="px-2 py-1 rounded-md border border-white/10 text-ink-3 hover:text-ink-2 font-mono text-[10px] tracking-widest uppercase">
              {t("cex.dcaStatement")}
            </button>
          </div>

          {aberto === p.id && (
            <div className="border-t border-white/5 pt-2 space-y-1 max-h-56 overflow-y-auto">
              <ResumoDoExtrato plano={p} ciclos={ciclos[p.id] ?? []} t={t} />
              {(ciclos[p.id] ?? []).length === 0 ? (
                <div className="font-mono text-[10px] text-ink-4">{t("cex.dcaNoneHint")}</div>
              ) : ciclos[p.id].map((cy) => (
                <div key={cy.ciclo_numero} className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-ink-4 w-8">#{cy.ciclo_numero}</span>
                  <span className={cn("w-20", COR_CICLO[cy.status] ?? "text-ink-3")}>
                    {t(`cex.dcaCycle${cy.status === "feito" ? "Done" : cy.status === "pulado" ? "Skipped" : cy.status === "falhou" ? "Failed" : "Reserved"}` as MessageKey)}
                  </span>
                  {cy.simulado && (
                    <span className="text-cyan text-[9px] tracking-widest uppercase">sim</span>
                  )}
                  <span className="text-ink-3 flex-1 truncate">
                    {cy.status === "feito" && cy.custo_usd != null
                      ? `${Number(cy.quantidade ?? 0)} @ ${Number(cy.preco ?? 0)} = $${Number(cy.custo_usd).toFixed(2)}`
                        // ⚠️ Taxa ausente NÃO vira "$0.00" — some da linha. Um
                        // zero aqui afirmaria que a corretora não cobrou nada.
                        + (cy.taxa_usd != null ? ` · ${t("cex.dcaFeeShort")} $${Number(cy.taxa_usd).toFixed(4)}` : "")
                      : cy.motivo ?? new Date(cy.agendado_para).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * O CABEÇALHO DO EXTRATO — preço médio e a aferição da taxa.
 *
 * ⚠️ POR QUE A TAXA APARECE COMO ALÍQUOTA, e não como total (26/08).
 *
 * Um plano no ciclo 3 de 90 pagou $0,06 de uma projeção de $1,80. Mostrar
 * "projetado $1,80 · real $0,06" leria como economia de 97%, quando não é nada
 * — é só um plano no começo. A pergunta que a aferição responde é "a alíquota
 * que assumimos é a que estão cobrando?", e essa não depende de quantos ciclos
 * já rodaram.
 *
 * ⚠️ E OS CICLOS SEM REGISTRO APARECEM. Plano simulado não paga taxa e grava
 * `null`; ciclo anterior à migration 0034 também. Sem esse contador, uma
 * medição feita sobre 1 de 40 ciclos teria a mesma cara da medição do plano
 * inteiro — a armadilha de sempre, vazio-por-ausência com cara de vazio-por-
 * medição.
 */
function ResumoDoExtrato({ plano, ciclos, t }: {
  plano: Plano; ciclos: Ciclo[];
  t: (k: MessageKey, v?: Record<string, string>) => string;
}) {
  const linhas = ciclos.map((c) => ({ custoUsd: c.custo_usd, taxaUsd: c.taxa_usd, quantidade: c.quantidade }));
  const media  = precoMedio(linhas);
  const proj   = projetarTaxa({
    orcamentoTotalUsd: Number(plano.orcamento_total_usd),
    porCicloUsd:       Number(plano.por_ciclo_usd),
    ciclosTotal:       plano.ciclos_total,
  });
  const afer = proj.ok ? compararComRealizado(linhas, proj) : null;

  if (media.ciclosContados === 0 && !afer) return null;

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pb-1.5 mb-1 border-b border-white/5 font-mono text-[10px]">
      {/* ⚠️ `null` vira travessão, nunca zero. Preço médio zero é uma afirmação. */}
      <span className="text-ink-3">
        {t("cex.dcaAvgPrice", {
          price: media.precoMedioUsd == null ? "—" : media.precoMedioUsd.toFixed(6),
          qty:   String(Number(media.quantidadeTotal.toFixed(8))),
        })}
      </span>
      {afer && afer.taxaRealPct != null && (
        <span className={Math.abs(afer.desvioPontos ?? 0) > 0.05 ? "text-gold" : "text-ink-3"}>
          {t("cex.dcaFeeActual", {
            actual: afer.taxaRealPct.toFixed(3),
            est:    String(proj.ok ? proj.taxaPct : 0),
            usd:    afer.taxaRealUsd.toFixed(4),
          })}
        </span>
      )}
      {afer && afer.ciclosSemRegistro > 0 && (
        <span className="text-ink-4">
          {t("cex.dcaFeeUnmeasured", { n: String(afer.ciclosSemRegistro) })}
        </span>
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">{label}</div>
      {children}
    </div>
  );
}

function Acao({ onClick, Icon, label, tone }: {
  onClick: () => void; Icon: React.ComponentType<{ className?: string }>; label: string; tone?: "red";
}) {
  return (
    <button onClick={onClick} className={cn(
      "inline-flex items-center gap-1 px-2 py-1 rounded-md border font-mono text-[10px] tracking-widest uppercase",
      tone === "red" ? "border-red/30 text-red hover:bg-red/[0.06]" : "border-cyan/30 text-cyan hover:bg-cyan/[0.06]",
    )}>
      <Icon className="w-3 h-3" />{label}
    </button>
  );
}
