#!/usr/bin/env node
/**
 * CE-15 — MODELO DE CUSTO DE 36 MESES por holder Founders, por plano e cenário.
 *
 * Lê `scripts/cost/premissas-36-meses.json` (cada número com fonte: MEASURED /
 * ESTIMATED / DECISAO) e escreve `docs/COST-ENGINEERING-36M-MODEL.md` + JSON.
 * Determinístico: mesmas premissas → mesmas tabelas. Nada aqui é decisão
 * comercial: preços, supply, referral e reserva são ENTRADAS; o modelo só mostra
 * a matemática.
 *
 * Uso: node scripts/cost/modelo-36-meses.mjs [--json saida.json]
 */
import { readFileSync, writeFileSync } from "node:fs";

const P = JSON.parse(readFileSync("scripts/cost/premissas-36-meses.json", "utf8"));
const v = (x) => (typeof x === "object" && x !== null && "valor" in x ? x.valor : x);
const MESES = v(P.meses);
const DIAS_MES = 30.4;
const TIERS = ["pro", "trader", "pilot"];
const CENARIOS = ["EXPECTED", "HEAVY", "STRESS"];
const pr = Object.fromEntries(Object.entries(P.precos).map(([k, x]) => [k, v(x)]));
const un = Object.fromEntries(Object.entries(P.unitarios).map(([k, x]) => [k, v(x)]));
const fixoMes = Object.values(P.fixosMensaisUsd).reduce((s, x) => s + v(x), 0);

/** Teto de velas por rodada e orçamento diário de unidades — a MESMA fórmula de `cotas.ts`. */
const tetoPorRodada = (t) => P.tiers[t].simbolosPorTeste * P.tiers[t].janelaMaxDias * 24;
const orcamentoDia = (t) => Math.floor(P.tiers[t].backtestsPorDia * tetoPorRodada(t) * P.orcamentoWorkbench.fracaoDoTeto[t]);

/** Custo de UMA análise do ZION (provedor ativo = Kimi; Sonnet como sensibilidade). */
function custoAnalise(cen, provedor = "kimi") {
  const c = P.cenarios[cen];
  const entrada = un.zionPrefixoTokens + un.zionPayloadUsuarioTokens + 100;
  const cacheados = un.zionPrefixoTokens * c.cacheHitPrefixo;
  const naoCacheados = entrada - cacheados;
  const saida = un[c.saida];
  const k = provedor === "kimi"
    ? [pr.kimiInputPorMTok, pr.kimiCacheReadPorMTok, pr.kimiOutputPorMTok]
    : [pr.sonnetInputPorMTok, pr.sonnetCacheReadPorMTok, pr.sonnetOutputPorMTok];
  return (naoCacheados * k[0] + cacheados * k[1] + saida * k[2]) / 1e6;
}

/** Custo de ler e processar UMA vela no Workbench (egress + CPU + memória da espera no banco). */
function custoPorVela(cpuUs = un.cpuPorVelaPropriaUs) {
  const egress = (un.bytesPorVela / 1e9) * pr.egressGbUsd;
  const cpu = (cpuUs / 3.6e9) * pr.cpuHoraUsd;
  const memoria = ((un.msDbPorPagina / 1000) / 1000) * un.memoriaFuncaoGb / 3600 * pr.memoriaGbHoraUsd;
  return egress + cpu + memoria;
}

function velasPorDia(t, cen) {
  const c = P.cenarios[cen];
  if (c.backtestsUso === "orcamento") return orcamentoDia(t);
  return c.backtestsUso[t] * c.velasPorBacktest;
}
function backtestsPorDia(t, cen) {
  const c = P.cenarios[cen];
  return c.backtestsUso === "orcamento" ? P.tiers[t].backtestsPorDia : c.backtestsUso[t];
}

/** Custo mensal TOTAL do tique do papel, dividido pelas mesas ativas. */
function custoMesaMes(cen) {
  const mesasTotal = TIERS.reduce((s, t) => s + P.tiers[t].mesasDePapel * (P.tiers[t].supplyPago + P.tiers[t].reserva), 0);
  const ativas = mesasTotal * P.cenarios[cen].mesasAtivas;
  const ticksMes = un.tiquesPorDia * DIAS_MES;
  const mes = ticksMes * ((un.tiqueEgressMb / 1000) * pr.egressGbUsd + (un.tiqueCpuS3250 / 3600) * pr.cpuHoraUsd)
    + ticksMes * (pr.invocacaoPorMilhaoUsd / 1e6);
  return ativas > 0 ? mes / ativas : 0;
}

const holders = TIERS.reduce((s, t) => s + P.tiers[t].supplyPago + P.tiers[t].reserva, 0);
const fixoPorHolder36 = (fixoMes * MESES) / holders;

function linha(t, cen) {
  const T = P.tiers[t], c = P.cenarios[cen];
  const analisesMes = T.zionPorDia * c.zionUso * DIAS_MES;
  const ia = analisesMes * custoAnalise(cen) * MESES;
  const iaSonnet = analisesMes * custoAnalise(cen, "sonnet") * MESES;
  const velasDia = velasPorDia(t, cen);
  const workbench = (velasDia * custoPorVela() + backtestsPorDia(t, cen) * pr.invocacaoPorMilhaoUsd / 1e6) * DIAS_MES * MESES;
  const workbenchCpuAntes = velasDia * ((un.cpuPorVelaPropriaUsAntes / 3.6e9) * pr.cpuHoraUsd) * DIAS_MES * MESES;
  const workbenchCpuDepois = velasDia * ((un.cpuPorVelaPropriaUs / 3.6e9) * pr.cpuHoraUsd) * DIAS_MES * MESES;
  const papel = T.mesasDePapel * c.mesasAtivas * custoMesaMes(cen) * MESES;
  // Armazenamento ACUMULADO (o que é gravado no mês m é pago de m até o fim):
  // Σ_{m=1..M} (m × bytes/mês) GB-mês. Com retenção de R meses das operações,
  // o detalhe para de crescer depois de R meses.
  const rodadasMes = backtestsPorDia(t, cen) * DIAS_MES;
  const opsPorRodada = (velasDia / Math.max(1, backtestsPorDia(t, cen))) * un.operacoesPorVela;
  const gbRodadasMes = (rodadasMes * un.bytesPorRodada) / 1e9;
  const gbOpsMes = (rodadasMes * opsPorRodada * un.bytesPorOperacao) / 1e9;
  const somaMeses = (MESES * (MESES + 1)) / 2;
  const R = un.retencaoOperacoesMeses;
  const somaComRetencao = (R * (R + 1)) / 2 + (MESES - R) * R;
  const armazenamento = (gbRodadasMes * somaMeses + gbOpsMes * somaMeses) * pr.armazenamentoGbMesUsd;
  const armazenamentoComRetencao = (gbRodadasMes * somaMeses + gbOpsMes * somaComRetencao) * pr.armazenamentoGbMesUsd;
  const cash = ia + workbench + papel + armazenamento;
  const humano = c.suporteHorasMes[t] * pr.horaHumanaUsd * MESES;
  const fixo = fixoPorHolder36;
  return {
    tier: t, cenario: cen, preco: T.preco,
    ia, iaSonnet, workbench, workbenchCpuAntes, workbenchCpuDepois, papel, armazenamento, armazenamentoComRetencao,
    gbMesFinal: gbRodadasMes + gbOpsMes, cash, humano, fixo,
    economico: cash + humano + fixo,
    velasDia, analisesMes,
  };
}

const linhas = [];
for (const cen of CENARIOS) for (const t of TIERS) linhas.push(linha(t, cen));
const L = (t, cen) => linhas.find((l) => l.tier === t && l.cenario === cen);

const usd = (x) => {
  const a = Math.abs(x), s = x < 0 ? "−" : "";
  return a >= 100 ? `${s}$${Math.round(a).toLocaleString("en-US")}` : a >= 1 ? `${s}$${a.toFixed(2)}` : `${s}$${a.toFixed(4)}`;
};
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const out = [];
out.push("# Modelo de custo de 36 meses — COST ENGINEERING ROUND (CE-15)");
out.push("");
out.push("> Gerado por `node scripts/cost/modelo-36-meses.mjs` a partir de `scripts/cost/premissas-36-meses.json`. Não editar à mão.");
out.push("> **Matemática, não política:** preços (provisórios), supply, referral e reserva são ENTRADAS. Nenhum número aqui é decisão aprovada.");
out.push("> Valores por HOLDER, em USD, somados nos 36 meses. Fonte de cada premissa no JSON (MEASURED / ESTIMATED / DECISAO).");
out.push("");
out.push("## 1. Custo unitário");
out.push("");
out.push(`| item | valor | fonte |`);
out.push(`|---|---|---|`);
for (const cen of CENARIOS) out.push(`| uma análise ZION (Kimi), ${cen} | ${usd(custoAnalise(cen))} | tokens: prefixo MEASURED, payload/saída ESTIMATED |`);
for (const cen of CENARIOS) out.push(`| uma análise ZION (Sonnet, sensibilidade), ${cen} | ${usd(custoAnalise(cen, "sonnet"))} | ESTIMATED |`);
out.push(`| uma vela lida e processada no Workbench, depois | $${custoPorVela().toExponential(2)} | egress domina |`);
out.push(`| CPU de uma vela (estratégia própria), antes → depois | $${((un.cpuPorVelaPropriaUsAntes / 3.6e9) * pr.cpuHoraUsd).toExponential(2)} → $${((un.cpuPorVelaPropriaUs / 3.6e9) * pr.cpuHoraUsd).toExponential(2)} | MEASURED (CE-03) |`);
out.push(`| CPU de uma barra (modo mesa), antes → depois | $${((un.cpuPorBarraMesaUsAntes / 3.6e9) * pr.cpuHoraUsd).toExponential(2)} → $${((un.cpuPorBarraMesaUs / 3.6e9) * pr.cpuHoraUsd).toExponential(2)} | MEASURED (CE-03) |`);
out.push(`| uma mesa de papel por mês (EXPECTED) | ${usd(custoMesaMes("EXPECTED"))} | tique MEASURED (CE-10) |`);
out.push(`| fixos da plataforma por holder (36 meses, ${holders} holders) | ${usd(fixoPorHolder36)} | ESTIMATED ($${fixoMes}/mês) |`);
out.push("");
out.push("## 2. Custo de 36 meses por holder");
out.push("");
out.push("| cenário | plano | preço | ZION | Workbench | papel | armazenamento | **CASH** | CASH/preço | HUMANO | FIXO | **ECONÔMICO** | econômico/preço |");
out.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const l of linhas) {
  out.push(`| ${l.cenario} | ${l.tier} | ${usd(l.preco)} | ${usd(l.ia)} | ${usd(l.workbench)} | ${usd(l.papel)} | ${usd(l.armazenamento)} | **${usd(l.cash)}** | ${pct(l.cash / l.preco)} | ${usd(l.humano)} | ${usd(l.fixo)} | **${usd(l.economico)}** | ${pct(l.economico / l.preco)} |`);
}
out.push("");
out.push("ZION com Sonnet (sensibilidade de provedor), 36 meses: " + TIERS.map((t) => `${t} ${CENARIOS.map((c) => `${c[0]} ${usd(L(t, c).iaSonnet)}`).join(" / ")}`).join(" · "));
out.push("");
out.push("## 3. O que a engenharia removeu (Workbench, linha de CPU, 36 meses por holder)");
out.push("");
out.push("| cenário | plano | velas/dia | CPU antes | CPU depois |");
out.push("|---|---|---|---|---|");
for (const l of linhas) out.push(`| ${l.cenario} | ${l.tier} | ${Math.round(l.velasDia).toLocaleString("en-US")} | ${usd(l.workbenchCpuAntes)} | ${usd(l.workbenchCpuDepois)} |`);
out.push("");
out.push("## 4. Margem por plano (preço − referral − custo econômico de 36 meses)");
out.push("");
out.push("| cenário | plano | referral 0% | 10% | 15% | 20% |");
out.push("|---|---|---|---|---|---|");
for (const l of linhas) out.push(`| ${l.cenario} | ${l.tier} | ${P.referral.map((r) => `${usd(l.preco * (1 - r) - l.economico)} (${pct((l.preco * (1 - r) - l.economico) / l.preco)})`).join(" | ")} |`);
out.push("");
out.push("## 5. Carteira inteira (2.850 pagos + 40 de reserva, que consomem serviço sem receita)");
out.push("");
out.push("| cenário | receita bruta | custo econômico total | resultado com referral 0% | 10% | 15% | 20% |");
out.push("|---|---|---|---|---|---|---|");
for (const cen of CENARIOS) {
  const receita = TIERS.reduce((s, t) => s + P.tiers[t].preco * P.tiers[t].supplyPago, 0);
  const custo = TIERS.reduce((s, t) => s + L(t, cen).economico * (P.tiers[t].supplyPago + P.tiers[t].reserva), 0);
  out.push(`| ${cen} | ${usd(receita)} | ${usd(custo)} | ${P.referral.map((r) => usd(receita * (1 - r) - custo)).join(" | ")} |`);
}
out.push("");
out.push("## 6. Reserva de serviço — cobertura do passivo de 36 meses");
out.push("");
out.push("Passivo = CASH + HUMANO de 36 meses por holder (o FIXO é da plataforma, não do holder). Cobertura = reserva ÷ passivo.");
out.push("A proposta **orientada a passivo** reserva o passivo HEAVY + 20%, expresso em % do preço.");
out.push("");
out.push("| plano | passivo EXPECTED | passivo HEAVY | passivo STRESS | 40/35/15 → cobertura E/H/S | 25/20/10 → cobertura E/H/S | orientada a passivo (% do preço) |");
out.push("|---|---|---|---|---|---|---|");
for (const t of TIERS) {
  const passivo = (cen) => L(t, cen).cash + L(t, cen).humano;
  const cob = (pctRes) => CENARIOS.map((cen) => `${(P.tiers[t].preco * pctRes / passivo(cen)).toFixed(2)}×`).join(" / ");
  const orientada = (passivo("HEAVY") * 1.2) / P.tiers[t].preco;
  out.push(`| ${t} | ${usd(passivo("EXPECTED"))} | ${usd(passivo("HEAVY"))} | ${usd(passivo("STRESS"))} | ${usd(P.tiers[t].preco * P.reservaDeServico["40/35/15"][t])}: ${cob(P.reservaDeServico["40/35/15"][t])} | ${usd(P.tiers[t].preco * P.reservaDeServico["25/20/10"][t])}: ${cob(P.reservaDeServico["25/20/10"][t])} | ${pct(orientada)} (${usd(passivo("HEAVY") * 1.2)}) |`);
}
out.push("");
out.push("## 7. Armazenamento: sem retenção × retenção de operações (PROPOSTA, não implementada)");
out.push("");
out.push(`Cada backtest grava a rodada, o resultado e TODAS as operações (\`bancada_operacao\`); nada tem retenção hoje. A proposta mantém o detalhe das operações por ${un.retencaoOperacoesMeses} meses e o resumo para sempre — exige decisão do dono (dado do cliente).`);
out.push("");
out.push("| cenário | plano | GB/mês gravados | 36 meses sem retenção | com retenção |");
out.push("|---|---|---|---|---|");
for (const l of linhas) out.push(`| ${l.cenario} | ${l.tier} | ${l.gbMesFinal.toFixed(3)} | ${usd(l.armazenamento)} | ${usd(l.armazenamentoComRetencao)} |`);
out.push("");
out.push("## 8. Comparação com a assinatura mensal (Hird, preço do código)");
out.push("");
out.push("| cenário | plano | custo econômico por mês | preço mensal | custo/preço |");
out.push("|---|---|---|---|---|");
for (const l of linhas) {
  const mensal = P.tiers[l.tier].mensalHird;
  out.push(`| ${l.cenario} | ${l.tier} | ${usd(l.economico / MESES)} | ${usd(mensal)} | ${pct(l.economico / MESES / mensal)} |`);
}
out.push("");
out.push("## 9. Leitura (gerada dos números acima)");
out.push("");
for (const cen of CENARIOS) {
  const partes = TIERS.map((t) => {
    const l = L(t, cen);
    const maior = [["ZION", l.ia], ["Workbench", l.workbench], ["humano", l.humano]].sort((a, b) => b[1] - a[1])[0][0];
    return `${t}: CASH ${pct(l.cash / l.preco)} do preço, econômico ${pct(l.economico / l.preco)}, maior linha = ${maior}`;
  });
  out.push(`- **${cen}** — ${partes.join("; ")}.`);
}
const pilotStressWb = L("pilot", "STRESS").workbench;
out.push(`- O Workbench do Pilot em STRESS (orçamento de unidades do CE-05/CE-15 usado todo dia, fração 1/16) custa ${usd(pilotStressWb)} em 36 meses, ${pct(pilotStressWb / P.tiers.pilot.preco)} do preço; com a fração uniforme de ¼ seriam ~4× isso (ver o relatório, CE-05-R1).`);
out.push(`- Trocar Kimi por Sonnet multiplica a linha do ZION por ~${(custoAnalise("EXPECTED", "sonnet") / custoAnalise("EXPECTED")).toFixed(1)}× (EXPECTED).`);
out.push("- O HUMANO depende inteiramente de `horaHumanaUsd` e das horas por plano, que são hipóteses: o dono precisa fixá-las antes de qualquer conclusão sobre margem.");
out.push("");
writeFileSync("docs/COST-ENGINEERING-36M-MODEL.md", out.join("\n") + "\n");
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify({ premissas: P, linhas }, null, 2));
console.log(out.slice(0, 40).join("\n"));
