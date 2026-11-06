/**
 * Oráculo de testes do contrato temporal de 05/11/2026, sem cursores ou
 * indicadores incrementais. A referência antiga permanece intocada em
 * mesa-real-legado.ts; ela incluía OHLC de prazos ainda abertos.
 * Somente testes; não usado pelo produto.
 */
import { computeIndicatorsLegado } from "./indicadores-legado";
import { candidateAttempts } from "@/lib/zion/playbooks";
import { paraCandle, MAX_BARRAS_AVALIADAS, type VelasDaMesa, type RodadaDaMesa } from "../mesa-real";
const H = 3_600_000;
export function rodarMesaReferenciaTemporal(m: VelasDaMesa, simbolo: string, custo: number): RodadaDaMesa {
  const r: RodadaDaMesa = { operacoes: [], barrasAvaliadas: 0,
    cortadaPeloTeto: m.h1.length - 200 > MAX_BARRAS_AVALIADAS,
    aindaAbertas: 0, porPlaybook: {}, porQueNaoAbriu: {} };
  let ocupadaAte = -Infinity;
  for (let i = 200; i < Math.min(m.h1.length, 200 + MAX_BARRAS_AVALIADAS); i++) {
    r.barrasAvaliadas++;
    const entradaEm = m.h1[i].t + H;
    if (entradaEm < ocupadaAte) continue;
    const ind = computeIndicatorsLegado(simbolo, paraCandle(m.h1.slice(0, i + 1)),
      paraCandle(m.h4.filter((c) => c.t + 4 * H <= entradaEm)),
      paraCandle(m.d1.filter((c) => c.t + 24 * H <= entradaEm)),
      paraCandle(m.w1.filter((c) => c.t + 168 * H <= entradaEm)));
    const candidatos = candidateAttempts(ind);
    const plano = candidatos.find((c) => c.plan)?.plan;
    if (!plano) {
      const porque = candidatos[0]?.reason ?? "sem candidato no regime";
      r.porQueNaoAbriu[porque] = (r.porQueNaoAbriu[porque] ?? 0) + 1;
      continue;
    }
    const horizonte = entradaEm + plano.horizonHours * H;
    let encontrado = false;
    const caminho = m.h1.slice(i + 1);
    for (let k = 0; k < caminho.length; k++) {
      const c = caminho[k], fechamento = c.t + H;
      if (c.t !== entradaEm + k * H || fechamento > horizonte) break;
      const desfecho = c.low <= plano.stop ? "stop" : c.high >= plano.target ? "alvo"
        : fechamento === horizonte ? "expirada" : null;
      if (!desfecho) continue;
      const preco = desfecho === "stop" ? plano.stop : desfecho === "alvo" ? plano.target : c.close;
      const bruto = (preco - plano.entry) / plano.entry * 100;
      const liquido = bruto - custo;
      r.operacoes.push({ abriuEm: entradaEm, fechouEm: fechamento, entrada: plano.entry,
        saida: preco, desfecho, brutoPct: liquido + custo, liquidoPct: liquido,
        playbook: plano.playbook, simbolo });
      r.porPlaybook[plano.playbook] = (r.porPlaybook[plano.playbook] ?? 0) + 1;
      ocupadaAte = fechamento;
      encontrado = true;
      break;
    }
    if (!encontrado) { r.aindaAbertas++; ocupadaAte = Infinity; }
  }
  return r;
}
