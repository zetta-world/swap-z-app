"use client";

/**
 * O PAINEL DOS AGENTES DO INVESTIDOR.
 *
 * ⚠️⚠️ ESTA TELA FOI REESCRITA POR UMA FRASE (07/09): *"ao contratar o agente
 * deveria aparecer aí no próprio agente, as informações e resultados em tempo
 * real"* — seguida de *"está uma bagunça horrível... jogando informações em
 * cima de informações"*.
 *
 * A versão anterior gastava quase toda a altura do card com o que NÃO muda (um
 * parágrafo explicativo e uma caixa de aviso repetida em cada agente) e
 * escondia o que muda: a posição aberta ficava atrás de `decididas === 0`, de
 * modo que quem tinha três posições vivas e nada fechado lia *"contratado,
 * ainda sem nada decidido"* — o texto afirmando o contrário do que acontecia.
 * E isso empurrava a informação para a seção "Rodando agora", 500 linhas
 * abaixo, criando a duplicação de que o dono reclamou.
 *
 * A ORDEM AQUI É A CORREÇÃO, e ela é: o que ele ACABOU DE FAZER → o que está
 * ABERTO agora → o que ele JÁ MEDIU → o extrato. Do mais volátil ao mais
 * estável; o que muda a cada 30 minutos fica no topo.
 *
 * ⚠️ NENHUM NÚMERO DAQUI VEM DO LIVRO DA CASA — ver `/api/bancada/agentes`.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, ChevronDown, AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";
import { classificarResultado } from "@/lib/admin/cor-resultado";
import { corDoNumero } from "@/components/bancada/CorDoCliente";
import { rotuloDaPraca, type Praca, type Papel } from "@/lib/bancada/vocabulario";
import type { MotivoDeNaoAbrir, Saude } from "@/lib/bancada/ultimo-tique";

interface Desempenho {
  desdeMs: number | null; horasRodando: number | null;
  decididas: number; alvo: number; stop: number; expiradas: number; abertas: number;
  acertoPct: number | null;
  liquidoPorOpPct: number | null;
  liquidoComExpiradasPct: number | null;
  pinta: boolean;
  porPlaybook: Record<string, number>;
  simbolos: number;
}

interface Distancia { alvoPct: number | null; stopPct: number | null; abertoPct: number | null }

interface Operacao {
  id: string; simbolo: string; lado: "long" | "short";
  entrada: number; saida: number | null;
  alvoPct: number | null; stopPct: number | null;
  status: "aberta" | "ganhou" | "perdeu" | "expirada";
  resultadoPct: number | null;
  playbook: string | null;
  abertaEm: string; fechadaEm: string | null; expiraEm: string | null;
  /** ⚠️ Só em posição ABERTA — o que o tique viu, e a distância até o alvo. */
  precoVisto?: number | null;
  distancia?: Distancia | null;
}

interface VistoNoSimbolo {
  preco: number | null;
  velaEm: number | null;
  /** ⚠️ É DAQUI que sai a idade — nunca de `velaEm`. Ver `ultimo-tique.ts`. */
  velaFechaEm: number | null;
  regime: string | null;
  motivo: MotivoDeNaoAbrir | null;
  detalhe: string | null;
  abriu: boolean;
}

export interface Agente {
  id: string; mesa: string; nome: string;
  sigilo: string | null; subtitulo: string | null;
  simbolos: string[]; intervalo: string;
  praca: Praca; papel: Papel;
  ligada: boolean; desde: string | null;
  desempenho: Desempenho;
  operacoes: Operacao[];
  /** ⚠️ `null` = NUNCA foi verificada. Estado legítimo nos primeiros 30 min. */
  tique: { em: number; simbolos: Record<string, VistoNoSimbolo> } | null;
  saude: Saude;
  cadenciaMs: number;
}

const CHIP = "rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-40";
const CHIP_OFF = "border-white/10 text-ink-3 hover:border-cyan/40 hover:text-cyan";
const M = 60_000;

export default function Agentes({ recarregar, onMesas }: {
  recarregar: number;
  /**
   * ⚠️ QUAIS MESAS JÁ TÊM INSTÂNCIA — para a vitrine não oferecer "Contratar"
   * de novo e criar uma gêmea indistinguível. UMA fonte: a que o servidor
   * devolveu aqui, nunca uma segunda busca da vitrine.
   */
  onMesas?: (mesas: string[]) => void;
}) {
  const t = useT();
  const [agentes, setAgentes] = useState<Agente[] | null>(null);
  const [pausadoPelaCasa, setPausado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  /**
   * ⚠️⚠️ `onMesas` VIVE NUM REF, E ISSO É CORREÇÃO DE LAÇO INFINITO (14/09).
   *
   * ACHADO DA AUDITORIA, por duas lentes independentes, pelas duas pontas.
   * `carregar` tinha `[onMesas]` nas dependências, e o pai passava uma arrow
   * ANÔNIMA (`onMesas={(m) => { setJaContratadas(m); ... }}`), recriada a cada
   * render. O ciclo fechava sozinho:
   *
   *   fetch resolve → `onMesas(lista.map(…))` → `setJaContratadas(ARRAY NOVO)`
   *   → o pai re-renderiza (dois arrays nunca são `Object.is`-iguais, então
   *   não há bail-out) → nova arrow → novo `carregar` → as deps do efeito
   *   mudaram → fetch de novo → …
   *
   * Sem ponto de parada, contra a rota MAIS CARA da bancada (uma consulta de
   * posições por instância). E o laço existia só no caminho FELIZ: numa falha
   * `lista` é `null`, `onMesas` não é chamado, e a página ficava quieta — o
   * defeito aparecia exatamente quando tudo dava certo.
   *
   * ⚠️ De quebra, o `setInterval` de 60s abaixo NUNCA chegava aos 60s: ele
   * também dependia de `carregar`, então era destruído e recriado a cada volta.
   * A recarga "em tempo real" que o bloco abaixo documenta era código morto —
   * quem recarregava era o laço.
   *
   * O ref quebra a corrente sem tirar o aviso do pai: ele continua sendo
   * chamado a cada leitura, só não participa mais da identidade de `carregar`.
   */
  const onMesasRef = useRef(onMesas);
  useEffect(() => { onMesasRef.current = onMesas; });

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/bancada/agentes");
      const j = await res.json();
      // ⚠️ Falha vira `null`, não `[]`: `[]` afirmaria "você não tem agente
      // nenhum" para quem tem três.
      const lista = j?.ok && Array.isArray(j.agentes) ? (j.agentes as Agente[]) : null;
      setAgentes(lista);
      setPausado(j?.pausadoPelaCasa === true);
      // ⚠️ Só avisa quando a leitura DEU CERTO: numa falha, dizer "nenhuma
      // contratada" reabriria o botão e convidaria à gêmea.
      if (lista) onMesasRef.current?.(lista.map((x) => x.mesa));
    } catch { setAgentes(null); }
    // ⚠️ DEPS VAZIAS DE PROPÓSITO — ver a nota acima. `carregar` tem de ter
    // identidade ESTÁVEL, senão o efeito que o dispara vira um laço.
  }, []);
  useEffect(() => { void carregar(); }, [carregar, recarregar]);

  /**
   * ⚠️⚠️ A SEÇÃO PEDIDA "EM TEMPO REAL" ERA A ÚNICA SEM RECARGA — e a duplicata
   * que ela gerou é que recarregava. O cron anda de 30 em 30 minutos; recarregar
   * a cada minuto é barato e garante que o card reflita a passagem assim que
   * ela acontece, em vez de exigir um F5 do investidor.
   */
  useEffect(() => {
    const id = setInterval(() => { void carregar(); }, 60_000);
    return () => clearInterval(id);
  }, [carregar]);

  async function mexer(id: string, corpo: Record<string, unknown>) {
    setOcupado(id);
    try {
      await fetch("/api/bancada/agentes", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
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

      {/* ⚠️⚠️ UM ESTADO NOSSO NÃO PODE CHEGAR DISFARÇADO DE DEFEITO DELE. Sem
          esta faixa, uma pausa da casa desenha agentes "ligados" que viram
          "atrasado" 60 min depois, sem causa visível. */}
      {pausadoPelaCasa && (
        <p className="flex items-start gap-2 rounded-2xl border border-gold/30 bg-gold/5 p-4 text-xs leading-relaxed text-gold">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {t("bancada.agPausadoCasa")}
        </p>
      )}

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
          {/* ⚠️ A CADÊNCIA É DITA UMA VEZ, NO RODAPÉ DA SEÇÃO — não uma caixa
              por card. Repetir a mesma ressalva em cada agente ensina o leitor
              a pular a borda cinza inteira, inclusive nos cards em que ela
              muda. É a nota da seção, e é aqui que ela pertence. */}
          <p className="text-[11px] leading-relaxed text-ink-4">
            {t("bancada.agCadencia")} {t("bancada.agNaoEmprestamos")}
          </p>
        </>
      )}
    </section>
  );
}

/** Há quantos minutos, arredondado para baixo. `null` sem carimbo. */
function minutosAtras(ms: number | null | undefined, agora: number): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((agora - ms) / M));
}

function CartaoDoAgente({ a, ocupado, onPausar, onDispensar }: {
  a: Agente; ocupado: boolean; onPausar: () => void; onDispensar: () => void;
}) {
  const t = useT();
  const [aberto, setAberto] = useState(false);
  const d = a.desempenho;

  /**
   * ⚠️ `agora` é lido UMA VEZ por render. Chamar `Date.now()` em cada linha
   * faria dois símbolos do mesmo card serem datados contra relógios diferentes.
   */
  const agora = Date.now();

  const classe = classificarResultado(d.decididas > 0 ? d.liquidoPorOpPct : null);
  const cor = corDoNumero(classe, d.pinta);

  /**
   * ⚠️ O REGIME, TRADUZIDO. Vocabulário fechado de quatro valores, então ele
   * cabe nos quatro idiomas — ao contrário da prosa do seletor.
   */
  const REGIMES: Record<string, string> = {
    TRENDING_UP:   t("bancada.agRegimeSubindo"),
    TRENDING_DOWN: t("bancada.agRegimeCaindo"),
    RANGING:       t("bancada.agRegimeLateral"),
    TRANSITIONING: t("bancada.agRegimeTransicao"),
  };

  const MOTIVOS: Record<MotivoDeNaoAbrir, string> = {
    ja_tem_posicao: t("bancada.agMotivoJaTemPos"),
    aquecendo:      t("bancada.agMotivoAquecendo"),
    sem_vela_nova:  t("bancada.agMotivoSemVela"),
    sem_dado:       t("bancada.agMotivoSemDado"),
    sem_setup:      t("bancada.agMotivoSemSetup"),
    outro:          t("bancada.agMotivoOutro"),
  };

  const abertas = a.operacoes.filter((o) => o.status === "aberta");
  const minDoTique = minutosAtras(a.tique?.em, agora);

  /**
   * ⚠️⚠️ QUATRO ESTADOS DE SAÚDE, E OS QUATRO DIZEM COISAS DIFERENTES.
   * `adiado` e `atrasado` são os dois em que a culpa é NOSSA, e a frase diz
   * isso — o investidor não pode ler uma limitação nossa como defeito do agente
   * que ele pagou.
   */
  const linhaDeSaude =
    a.saude === "nunca_verificado" ? { texto: t("bancada.agNuncaVerificado"), cor: "text-ink-4" }
    : a.saude === "adiado"   ? { texto: t("bancada.agAdiado"), cor: "text-ink-4" }
    : a.saude === "atrasado" ? { texto: t("bancada.agAtrasado"), cor: "text-gold" }
    : {
        texto: minDoTique != null && minDoTique < 1
          ? t("bancada.agVerificadoAgora")
          : t("bancada.agVerificado", { min: minDoTique ?? 0 }),
        cor: "text-ink-3",
      };

  return (
    <article className={`overflow-hidden rounded-2xl border bg-bg-1/40 ${a.ligada ? "border-green/20" : "border-white/5"}`}>
      {/* ── QUEM É, E COMO ESTÁ ─────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${
              a.ligada ? "border-green/30 text-green" : "border-white/10 text-ink-4"}`}>
              {a.ligada ? t("bancada.agLigada") : t("bancada.agPausada")}
            </span>
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
          {/* ⚠️ ZERO DECIDIDAS NÃO MOSTRA NÚMERO — nem 0%. O vazio dele é dele,
              e a nossa amostra não o preenche. */}
          {d.decididas === 0 || d.liquidoPorOpPct == null ? (
            <span className="text-xs text-ink-4">—</span>
          ) : (
            <>
              <span className={`block text-xl font-semibold tabular-nums ${cor}`}>
                {d.liquidoPorOpPct >= 0 ? "+" : ""}{d.liquidoPorOpPct.toFixed(2)}%
              </span>
              <span className="block text-[10px] text-ink-4">{t("bancada.mesasPorOp")}</span>
            </>
          )}
        </div>
      </div>

      <div className="space-y-3 px-5 pb-5">
        {/* ── 1. O QUE ELE ACABOU DE FAZER ─────────────────────────── */}
        {/* ⚠️ NO TOPO porque é o que muda a cada 30 minutos, e era o que estava
            faltando: "esperando setup" não separava "verificou e ficou de fora"
            de "ainda não verificou" de "parou de verificar". */}
        <p className={`text-[11px] leading-relaxed ${linhaDeSaude.cor}`}>{linhaDeSaude.texto}</p>

        {a.tique != null && a.saude !== "atrasado" && (
          <ul className="space-y-1">
            {a.simbolos.map((sim) => {
              const v = a.tique!.simbolos[sim];
              /**
               * ⚠️⚠️ A IDADE SAI DO FECHAMENTO DA VELA (08/09), não da abertura
               * e não da passagem do cron.
               *
               * O card dizia "vela de 104 min atrás" sobre uma vela de 1h
               * aberta às 07:00 e lida às 08:44 — mas ela FECHOU às 08:00, e o
               * dado tinha 44 minutos. Envelhecer o preço em uma duração de
               * intervalo inteira fazia o agente parecer cego estando em dia, e
               * "idade errada declarada é pior que idade nenhuma".
               */
              const minVela = minutosAtras(v?.velaFechaEm, agora);
              const regime = v?.regime ? REGIMES[v.regime] : null;
              return (
                <li key={sim} className="text-[11px]">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-ink-2">{sim}</span>
                    <span className="tabular-nums text-ink-4">
                      {v?.preco != null && minVela != null
                        ? t("bancada.agPrecoVisto", { preco: v.preco.toFixed(4), min: minVela })
                        : t("bancada.agSemPreco")}
                    </span>
                    {/* ⚠️ O REGIME É O "ONDE ELE ACHA QUE ESTÁ" — quatro valores
                        fechados, traduzíveis, e a metade da resposta ao *"não dá
                        pra saber o que o agente está fazendo"*. */}
                    {regime && <span className="text-cyan/70">· {regime}</span>}
                    {v?.motivo && <span className="text-ink-4">· {MOTIVOS[v.motivo]}</span>}
                  </div>
                  {/**
                    * ⚠️⚠️ A LEITURA CRUA DA MESA — a outra metade da resposta, e
                    * ela estava gravada no banco sendo jogada fora pela tela.
                    *
                    * "queda sem divergência de exaustão — faca caindo" diz o que
                    * o agente está FAZENDO; "olhou e não achou setup" não diz
                    * nada. Ela vem do seletor da casa e NÃO é tradução nossa —
                    * por isso entra rotulada como leitura DELA, em vez de
                    * fingir que é texto do produto.
                    */}
                  {v?.detalhe && v.motivo === "sem_setup" && (
                    <p className="mt-0.5 pl-1 text-[10px] leading-relaxed text-ink-4">
                      <span className="text-ink-3">{t("bancada.agLeituraDaMesa")}:</span> {v.detalhe}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* ── 2. O QUE ESTÁ ABERTO AGORA ───────────────────────────── */}
        {/* ⚠️⚠️ FORA do ramo `decididas === 0`. Era ali que ele vivia, e por isso
            quem tinha três posições vivas e nada fechado lia "ainda sem nada
            decidido" — o texto afirmando o contrário do que acontecia. */}
        {abertas.length > 0 && (
          <ul className="space-y-1.5">
            {abertas.map((o) => <PosicaoViva key={o.id} o={o} agora={agora} />)}
          </ul>
        )}

        {/* ── 3. O QUE ELE JÁ MEDIU ────────────────────────────────── */}
        {d.decididas === 0 ? (
          /**
           * ⚠️ O PARÁGRAFO GENÉRICO SÓ APARECE QUANDO NÃO HÁ LEITURA REAL.
           *
           * "Contratado, ainda sem nada decidido. Ele só abre quando a regra
           * dele acha setup" impresso ABAIXO de "mercado em queda · faca
           * caindo" é a mesma frase duas vezes, e a segunda é a que não
           * informa. Com o tique lido, a explicação vira ruído.
           */
          abertas.length === 0 && a.tique == null && (
            <p className="text-xs leading-relaxed text-ink-3">{t("bancada.agAindaNada")}</p>
          )
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
              <span>{d.decididas === 1 ? t("bancada.agDecididaUma") : t("bancada.agDecididas", { n: d.decididas })}</span>
              {d.acertoPct != null && <span>{t("bancada.agAcerto", { pct: d.acertoPct.toFixed(0) })}</span>}
              {/* ⚠️ Uma instância que expira mais do que decide morre de
                  relógio, não de tese. */}
              {d.expiradas > 0 && (
                <span>{d.expiradas === 1 ? t("bancada.agExpiradaUma") : t("bancada.agExpiradasN", { n: d.expiradas })}</span>
              )}
            </div>
            {/* ⚠️ As duas médias contam histórias diferentes: a primeira diz se
                a TESE paga, esta diz o que o período REALMENTE rendeu. */}
            {d.liquidoComExpiradasPct != null && d.expiradas > 0 && (
              <p className="text-[11px] text-ink-4">
                {t("bancada.agComExpiradas", { pct: d.liquidoComExpiradasPct.toFixed(2) })}
              </p>
            )}
          </>
        )}

        {/* ── 4. OS CONTROLES, E O EXTRATO SOB DEMANDA ─────────────── */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
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
          <>
            {Object.keys(d.porPlaybook).length > 0 && (
              <p className="text-[11px] text-ink-4">
                {t("bancada.agRegras")}: {Object.entries(d.porPlaybook)
                  .sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} (${n})`).join(" · ")}
              </p>
            )}
            <ul className="space-y-1.5">
              {a.operacoes.filter((o) => o.status !== "aberta").map((o) => <Linha key={o.id} o={o} />)}
            </ul>
          </>
        )}
      </div>
    </article>
  );
}

/**
 * UMA POSIÇÃO VIVA — e o único número desta tela que é sobre AGORA.
 *
 * ⚠️⚠️ A DISTÂNCIA ATÉ O ALVO É CALCULADA NO SERVIDOR e era jogada fora pelo
 * card. O investidor com posição aberta lia o preço de entrada ao lado de
 * "esperando setup" e não sabia se estava ganhando ou perdendo — tendo os
 * quatro números na resposta HTTP para somar de cabeça.
 */
function PosicaoViva({ o, agora }: { o: Operacao; agora: number }) {
  const t = useT();
  const dist = o.distancia ?? null;
  const aberto = dist?.abertoPct ?? null;

  // ⚠️ Verde/vermelho aqui é o não-realizado de UMA posição, não um veredito de
  // amostra: ele não passa por `shouldTint` porque não é média de nada.
  const cor = aberto == null ? "text-ink-4" : aberto >= 0 ? "text-green" : "text-red";
  const expiraMin = o.expiraEm ? Math.round((Date.parse(o.expiraEm) - agora) / M) : null;

  return (
    <li className="rounded-xl border border-cyan/20 bg-cyan/5 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink">
          <span className="mr-1.5 rounded border border-cyan/30 px-1 py-0.5 text-[9px] text-cyan">
            {t("bancada.agAberta")}
          </span>
          {o.simbolo}
        </span>
        <span className={`text-xs tabular-nums ${cor}`}>
          {aberto == null ? "—"
            : aberto >= 0 ? t("bancada.agNoAzul", { pct: aberto.toFixed(2) })
            : t("bancada.agNoVermelho", { pct: Math.abs(aberto).toFixed(2) })}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-4">
        <span>{t("bancada.opsEntrada")} {o.entrada.toFixed(4)}</span>
        {o.precoVisto != null && <span>→ {o.precoVisto.toFixed(4)}</span>}
        {/* ⚠️ `null` some, nunca vira 0 — zero diria "chegou no alvo". */}
        {dist?.alvoPct != null && <span>{t("bancada.agFaltaAlvo", { pct: dist.alvoPct.toFixed(2) })}</span>}
        {dist?.stopPct != null && <span>{t("bancada.agFaltaStop", { pct: dist.stopPct.toFixed(2) })}</span>}
        {expiraMin != null && expiraMin > 0 && (
          <span>{t("bancada.vivoExpira", { quando: `${Math.floor(expiraMin / 60)}h` })}</span>
        )}
        {o.playbook && <span>{t("bancada.opsPorPlaybook", { playbook: o.playbook })}</span>}
      </div>
    </li>
  );
}

/** Uma operação já FECHADA — o extrato que sustenta o número. */
function Linha({ o }: { o: Operacao }) {
  const t = useT();
  const cor = o.status === "ganhou" ? "text-green"
    : o.status === "perdeu" ? "text-red"
    // ⚠️ Expirada é CINZA nos dois sentidos: não é vitória nem derrota, mesmo
    // fechando no lucro.
    : "text-ink-4";

  return (
    <li className="rounded-lg border border-white/5 bg-bg-2/60 px-2.5 py-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-ink">{o.simbolo}</span>
        <span className={`text-xs tabular-nums ${cor}`}>
          {o.resultadoPct == null ? "—"
            : `${o.resultadoPct >= 0 ? "+" : ""}${o.resultadoPct.toFixed(2)}%`}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[10px] text-ink-4">
        <span>{o.abertaEm.slice(0, 10)} · {t("bancada.opsEntrada")} {o.entrada.toFixed(4)}</span>
        {o.saida != null && <span>{t("bancada.opsSaida")} {o.saida.toFixed(4)}</span>}
        {o.playbook && <span>{t("bancada.opsPorPlaybook", { playbook: o.playbook })}</span>}
      </div>
    </li>
  );
}
