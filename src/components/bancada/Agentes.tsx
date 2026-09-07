"use client";

/**
 * OS AGENTES DO INVESTIDOR — a instância dele, e o número DELE.
 *
 * ⚠️⚠️ ESTA TELA EXISTE POR UMA FRASE (07/09): *"apenas estamos pegando os
 * resultados das mesas do painel e Admin e repetindo para o investidor... eu
 * falei que tinha que ser isolado... o investidor roda estratégia/agente e o
 * mesmo começa a trabalhar e gerar resultado dali"*.
 *
 * ⚠️ NENHUM NÚMERO DAQUI VEM DO LIVRO DA CASA. `/api/bancada/agentes` lê
 * `bancada_posicao` do dono, da instância dele, e agrega em `desempenho.ts`. O
 * placar da nossa mesa continua existindo — no card DELA, rotulado como nosso.
 *
 * ⚠️ E O VAZIO É UMA RESPOSTA. Quem contratou hoje vê "ainda sem nada decidido",
 * com a explicação de que ficar de fora é a decisão na maior parte do tempo.
 * Preencher esse vazio com a nossa amostra seria vender a nossa credibilidade
 * como se fosse o desempenho dele — que é exatamente o que estava acontecendo.
 */

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronDown } from "lucide-react";
import { useT } from "@/lib/i18n";
import { classificarResultado } from "@/lib/admin/cor-resultado";
import { corDoNumero } from "@/components/bancada/CorDoCliente";
import { rotuloDaPraca, type Praca, type Papel } from "@/lib/bancada/vocabulario";

/** O desempenho como a rota o devolve — espelho de `desempenho.ts`. */
interface Desempenho {
  desdeMs: number | null;
  horasRodando: number | null;
  decididas: number; alvo: number; stop: number; expiradas: number; abertas: number;
  acertoPct: number | null;
  liquidoPorOpPct: number | null;
  liquidoComExpiradasPct: number | null;
  pinta: boolean;
  porPlaybook: Record<string, number>;
  simbolos: number;
}

interface Operacao {
  id: string; simbolo: string; lado: "long" | "short";
  entrada: number; saida: number | null;
  alvoPct: number | null; stopPct: number | null;
  status: "aberta" | "ganhou" | "perdeu" | "expirada";
  resultadoPct: number | null;
  playbook: string | null;
  abertaEm: string; fechadaEm: string | null; expiraEm: string | null;
}

export interface Agente {
  id: string; mesa: string; nome: string;
  sigilo: string | null; subtitulo: string | null;
  simbolos: string[]; intervalo: string;
  praca: Praca; papel: Papel;
  ligada: boolean; desde: string | null;
  desempenho: Desempenho;
  operacoes: Operacao[];
}

const CHIP = "rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-40";
const CHIP_OFF = "border-white/10 text-ink-3 hover:border-cyan/40 hover:text-cyan";

export default function Agentes({ recarregar }: { recarregar: number }) {
  const t = useT();
  const [agentes, setAgentes] = useState<Agente[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/bancada/agentes");
      const j = await res.json();
      // ⚠️ Falha vira `[]`? Não: `null` mantém a seção calada em vez de afirmar
      // "você não tem agente nenhum" para quem tem três.
      setAgentes(j?.ok && Array.isArray(j.agentes) ? j.agentes : null);
    } catch { setAgentes(null); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar, recarregar]);

  async function mexer(id: string, corpo: Record<string, unknown>) {
    setOcupado(id);
    try {
      await fetch("/api/bancada/agentes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...corpo }),
      });
      await carregar();
    } finally { setOcupado(null); }
  }

  // ⚠️ Enquanto não sabemos, não afirmamos nada — nem vazio, nem cheio.
  if (agentes == null) return null;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm font-medium text-ink">{t("bancada.agTitulo")}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{t("bancada.agSub")}</p>
      </div>

      {agentes.length === 0 ? (
        <p className="rounded-2xl border border-white/5 bg-bg-1/40 p-5 text-xs leading-relaxed text-ink-3">
          {t("bancada.agVazio")}
        </p>
      ) : (
        <>
          {agentes.map((a) => (
            <CartaoDoAgente key={a.id} a={a} ocupado={ocupado === a.id}
              onPausar={() => void mexer(a.id, { ligada: !a.ligada })}
              onDispensar={() => void mexer(a.id, { dispensar: true })} />
          ))}
          {/* ⚠️ A CADÊNCIA É DITA. Chamar de "tempo real" o que anda de meia em
              meia hora cria a expectativa errada — e "papel" precisa estar
              escrito, não subentendido. */}
          <p className="text-[11px] leading-relaxed text-ink-4">{t("bancada.agCadencia")}</p>
        </>
      )}
    </section>
  );
}

function CartaoDoAgente({ a, ocupado, onPausar, onDispensar }: {
  a: Agente; ocupado: boolean; onPausar: () => void; onDispensar: () => void;
}) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const d = a.desempenho;

  /**
   * ⚠️⚠️ A COR SÓ EXISTE SE A AMOSTRA SUSTENTA. `d.pinta` vem de
   * `shouldTint(decididas)` no servidor: um `+12%` de UMA operação sai cinza,
   * de propósito. É a mesma disciplina que faltou no painel do Valhalla.
   */
  const classe = classificarResultado(d.decididas > 0 ? d.liquidoPorOpPct : null);
  const cor = corDoNumero(classe, d.pinta);

  const regras = Object.entries(d.porPlaybook).sort((x, y) => y[1] - x[1]);

  return (
    <article className={`overflow-hidden rounded-2xl border bg-bg-1/40 ${a.ligada ? "border-green/20" : "border-white/5"}`}>
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
              a.ligada ? "border-green/30 text-green" : "border-white/10 text-ink-4"}`}>
              {a.ligada ? t("bancada.agLigada") : t("bancada.agPausada")}
            </span>
            {/* ⚠️ HÁ QUANTO TEMPO — um resultado de papel adiante sem o tempo
                decorrido é o mesmo defeito do número sem amostra. */}
            {d.horasRodando != null && (
              <span className="text-[10px] text-ink-4">
                {t("bancada.agDesde", { horas: Math.floor(d.horasRodando) })}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] font-medium text-ink">
            {a.sigilo && <span className="mr-1.5 text-ink-3">{a.sigilo}</span>}{a.nome}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-4">
            {a.simbolos.join(" · ") || "—"} · {a.intervalo} · {rotuloDaPraca(a.praca)} {a.papel}
          </p>
        </div>

        <div className="flex-shrink-0 text-right">
          {/* ⚠️⚠️ ZERO DECIDIDAS NÃO MOSTRA NÚMERO NENHUM — nem 0%. É o coração
              do isolamento: o vazio dele é dele, e a nossa amostra não o
              preenche. */}
          {d.decididas === 0 || d.liquidoPorOpPct == null ? (
            <span className="text-xs text-ink-4">{t("bancada.agAguardando")}</span>
          ) : (
            <>
              <span className={`block text-xl font-semibold tabular-nums ${cor}`}>
                {d.liquidoPorOpPct >= 0 ? "+" : ""}{d.liquidoPorOpPct.toFixed(2)}%
              </span>
              <span className="block text-[10px] text-ink-4">{t("bancada.agPorOp")}</span>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3 px-5 pb-5">
        {d.decididas === 0 ? (
          <p className="text-xs leading-relaxed text-ink-3">{t("bancada.agAindaNada")}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
              <span>{d.decididas === 1 ? t("bancada.agDecididaUma") : t("bancada.agDecididas", { n: d.decididas })}</span>
              {d.acertoPct != null && <span>{t("bancada.agAcerto", { pct: d.acertoPct.toFixed(0) })}</span>}
              {/* ⚠️ EXPIRADA APARECE. Uma instância que expira mais do que
                  decide morre de relógio, não de tese. */}
              {d.expiradas > 0 && (
                <span>{d.expiradas === 1 ? t("bancada.agExpiradaUma") : t("bancada.agExpiradasN", { n: d.expiradas })}</span>
              )}
              {d.abertas > 0 && (
                <span>{d.abertas === 1 ? t("bancada.agAbertaUma") : t("bancada.agAbertasN", { n: d.abertas })}</span>
              )}
            </div>
            {/* ⚠️ A SEGUNDA MÉDIA, com as expiradas dentro: a primeira diz se a
                TESE paga, esta diz o que o período REALMENTE rendeu. Publicar
                só a primeira numa mesa que expira metade dos sinais é escolher
                o número bonito. */}
            {d.liquidoComExpiradasPct != null && d.expiradas > 0 && (
              <p className="text-[11px] text-ink-4">
                {t("bancada.agComExpiradas", { pct: d.liquidoComExpiradasPct.toFixed(2) })}
              </p>
            )}
            {regras.length > 0 && (
              <p className="text-[11px] text-ink-4">
                {t("bancada.agRegras")}: {regras.map(([k, n]) => `${k} (${n})`).join(" · ")}
              </p>
            )}
          </>
        )}

        <p className="rounded-xl border border-white/5 bg-bg-2/60 p-3 text-[11px] leading-relaxed text-ink-3">
          {t("bancada.agNaoEmprestamos")}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onPausar} disabled={ocupado} className={`${CHIP} ${CHIP_OFF}`}>
            {ocupado ? <Loader2 className="h-3 w-3 animate-spin" />
              : a.ligada ? t("bancada.agDesligar") : t("bancada.agLigar")}
          </button>
          <button type="button" onClick={onDispensar} disabled={ocupado}
            className={`${CHIP} border-white/10 text-ink-4 hover:border-red/40 hover:text-red`}>
            {t("bancada.agDispensar")}
          </button>
          {a.operacoes.length > 0 && (
            <button type="button" onClick={() => setAberto((v) => !v)}
              className={`${CHIP} ${CHIP_OFF} ml-auto inline-flex items-center gap-1`}>
              {t("bancada.agOperacoes")}
              <ChevronDown className={`h-3 w-3 transition-transform ${aberto ? "rotate-180" : ""}`} />
            </button>
          )}
        </div>

        {aberto && (
          a.operacoes.length === 0 ? (
            <p className="text-xs text-ink-3">{t("bancada.agSemOperacoes")}</p>
          ) : (
            <ul className="space-y-1.5">
              {a.operacoes.map((o) => <Linha key={o.id} o={o} />)}
            </ul>
          )
        )}
      </div>
    </article>
  );
}

/** Uma operação da instância — quando entrou, a que preço, por que saiu. */
function Linha({ o }: { o: Operacao }) {
  const t = useT();
  const dia = (iso: string) => iso.slice(0, 10);
  const cor = o.status === "ganhou" ? "text-green"
    : o.status === "perdeu" ? "text-red"
    // ⚠️ Expirada é CINZA nos dois sentidos: ela não é vitória nem derrota,
    // mesmo fechando no lucro.
    : "text-ink-4";

  return (
    <li className="rounded-lg border border-white/5 bg-bg-2/60 px-2.5 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink">{o.simbolo}</span>
        <span className={`text-xs tabular-nums ${cor}`}>
          {o.status === "aberta" || o.resultadoPct == null
            ? t("bancada.agAguardando")
            : `${o.resultadoPct >= 0 ? "+" : ""}${o.resultadoPct.toFixed(2)}%`}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-ink-4">
        <span>{dia(o.abertaEm)} · {t("bancada.opsEntrada")} {o.entrada.toFixed(4)}</span>
        {o.saida != null && <span>{t("bancada.opsSaida")} {o.saida.toFixed(4)}</span>}
        {o.alvoPct != null && o.stopPct != null && (
          <span>{t("bancada.opsAlvo")} {o.alvoPct.toFixed(1)}% · {t("bancada.opsStop")} {o.stopPct.toFixed(1)}%</span>
        )}
        {o.playbook && <span>{t("bancada.opsPorPlaybook", { playbook: o.playbook })}</span>}
      </div>
    </li>
  );
}
