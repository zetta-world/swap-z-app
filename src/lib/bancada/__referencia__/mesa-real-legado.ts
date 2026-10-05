/**
 * ⚠️ REFERÊNCIA CONGELADA — `rodarMesa` como estava em `bancada/mesa-real.ts`
 * na base `0afa841`, sobre a cópia congelada de `computeIndicators`.
 *
 * NÃO É USADO EM PRODUÇÃO. Existe para o teste diferencial e o benchmark do
 * modo mesa (CE-02). Diferenças da base: `rodarMesa` → `rodarMesaLegado`,
 * `computeIndicators` → `computeIndicatorsLegado`, e `agregar`/`paraCandle`/
 * `ateOInstante`/`MAX_BARRAS_AVALIADAS` vêm do módulo oficial (não mudaram).
 */
import { computeIndicatorsLegado as computeIndicators } from "@/lib/bancada/__referencia__/indicadores-legado";
import type { Candle } from "@/lib/api/market-indicators";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { computeExitPath } from "@/lib/paper/saida";
import type { VelaComTempo } from "@/lib/mercado/velas";
import type { Operacao } from "@/lib/bancada/motor";
import { paraCandle, MAX_BARRAS_AVALIADAS, type VelasDaMesa, type RodadaDaMesa } from "@/lib/bancada/mesa-real";

const BARRAS_DE_AQUECIMENTO = 200;
function exigirOrdemCronologica(nome: keyof VelasDaMesa, velas: ReadonlyArray<VelaComTempo>): void {
  for (let i = 1; i < velas.length; i++) {
    if (velas[i].t < velas[i - 1].t) {
      throw new Error(
        `mesa_real_serie_fora_de_ordem:${nome}:indice=${i}:anterior=${velas[i - 1].t}:atual=${velas[i].t}`,
      );
    }
  }
}

/**
 * Roda o seletor da casa barra a barra.
 *
 * ⚠️⚠️ SEM LOOKAHEAD, POR CONSTRUÇÃO. Em cada barra `i` os indicadores são
 * recalculados sobre as velas **até `i`, inclusive** — e nunca além. É por isso
 * que o custo é o que é: reaproveitar um cálculo feito com a série inteira
 * daria a cada decisão um pedaço do futuro, e transformaria qualquer regra em
 * ouro.
 *
 * ⚠️ UMA POSIÇÃO POR VEZ, como no motor do cliente: deixar o sinal reabrir com
 * posição aberta empilharia o mesmo movimento e o `n` contaria repetição como
 * evidência.
 */
export function rodarMesaLegado(
  velas: VelasDaMesa,
  simbolo: string,
  custoIdaEVoltaPct: number,
): RodadaDaMesa {
  exigirOrdemCronologica("h1", velas.h1);
  exigirOrdemCronologica("h4", velas.h4);
  exigirOrdemCronologica("d1", velas.d1);
  exigirOrdemCronologica("w1", velas.w1);

  const h1 = velas.h1;
  const operacoes: Operacao[] = [];
  const porPlaybook: Record<string, number> = {};
  const porQueNaoAbriu: Record<string, number> = {};
  let aindaAbertas = 0;

  const primeira = BARRAS_DE_AQUECIMENTO;
  const total = Math.max(0, h1.length - primeira);
  const cortadaPeloTeto = total > MAX_BARRAS_AVALIADAS;
  const ultima = cortadaPeloTeto ? primeira + MAX_BARRAS_AVALIADAS : h1.length;

  // Converta cada série uma única vez. A versão anterior remapeava todo o
  // histórico já visto em cada barra e voltava a filtrar integralmente os três
  // prazos maiores. Isso não mudava o retrato, mas acrescentava trabalho
  // quadrático antes mesmo de os indicadores começarem a calcular.
  const h1Candles = paraCandle(h1);
  const h4Candles = paraCandle(velas.h4);
  const d1Candles = paraCandle(velas.d1);
  const w1Candles = paraCandle(velas.w1);
  const h1Saida = h1.map((x) => ({ t: x.t, high: x.high, low: x.low, close: x.close }));
  const h1Ate: Candle[] = h1Candles.slice(0, primeira);
  const h4AteCandles: Candle[] = [];
  const d1AteCandles: Candle[] = [];
  const w1AteCandles: Candle[] = [];
  let h4Ate = 0;
  let d1Ate = 0;
  let w1Ate = 0;

  let livreApartirDe = primeira;
  let barrasAvaliadas = 0;

  for (let i = primeira; i < ultima; i++) {
    barrasAvaliadas++;
    h1Ate.push(h1Candles[i]);
    if (i < livreApartirDe) continue;

    const t = h1[i].t;
    while (h4Ate < velas.h4.length && velas.h4[h4Ate].t <= t) h4AteCandles.push(h4Candles[h4Ate++]);
    while (d1Ate < velas.d1.length && velas.d1[d1Ate].t <= t) d1AteCandles.push(d1Candles[d1Ate++]);
    while (w1Ate < velas.w1.length && velas.w1[w1Ate].t <= t) w1AteCandles.push(w1Candles[w1Ate++]);
    const ind = computeIndicators(
      simbolo,
      h1Ate,
      h4AteCandles,
      d1AteCandles,
      w1AteCandles,
    );

    const tentativas = candidateAttempts(ind);
    const comPlano = tentativas.find((a) => a.plan !== null);
    if (!comPlano || !comPlano.plan) {
      // ⚠️ O MOTIVO DA RECUSA É CONTADO. Uma mesa parada é indistinguível de uma
      // mesa quebrada se só o que operou for registrado — é a mesma razão pela
      // qual `candidateAttempts` devolve o `reason` em vez de só o plano.
      const motivo = tentativas[0]?.reason ?? "sem candidato no regime";
      porQueNaoAbriu[motivo] = (porQueNaoAbriu[motivo] ?? 0) + 1;
      continue;
    }

    const plano = comPlano.plan;
    const abertaEm = t + 1;
    const expiraEm = abertaEm + plano.horizonHours * 3_600_000;
    const ate = Math.min(h1[h1.length - 1].t, expiraEm);

    const v = computeExitPath(
      {
        side: "buy",           // ⚠️ estas mesas são long-only, por construção
        entry_price: plano.entry,
        cost_usd: 1,
        target_price: plano.target,
        stop_price: plano.stop,
        opened_at: new Date(abertaEm).toISOString(),
        horizon_hours: plano.horizonHours,
      },
      h1Saida.slice(i + 1),
      undefined,
      ate,
      custoIdaEVoltaPct,
    );

    if (!v) {
      // A posição chegou viva ao fim da janela: ela ocupa a mesa até lá.
      aindaAbertas++;
      livreApartirDe = h1.length;
      continue;
    }

    porPlaybook[plano.playbook] = (porPlaybook[plano.playbook] ?? 0) + 1;
    operacoes.push({
      abriuEm: t,
      fechouEm: ate,
      entrada: plano.entry,
      saida: v.exit,
      desfecho: v.reason === "target" ? "alvo" : v.reason === "stop" ? "stop" : "expirada",
      brutoPct: v.netPct + custoIdaEVoltaPct,
      liquidoPct: v.netPct,
      playbook: plano.playbook,
      simbolo,
    });

    // A próxima entrada só nasce depois desta fechar.
    const iFechou = h1.findIndex((x) => x.t > ate);
    livreApartirDe = iFechou < 0 ? h1.length : Math.max(i + 1, iFechou);
  }

  return { operacoes, barrasAvaliadas, cortadaPeloTeto, aindaAbertas, porPlaybook, porQueNaoAbriu };
}
