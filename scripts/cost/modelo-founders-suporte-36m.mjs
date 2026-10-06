#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const P = JSON.parse(readFileSync("scripts/cost/premissas-founders-suporte-36m.json", "utf8"));
const B = JSON.parse(readFileSync("scripts/cost/premissas-36-meses.json", "utf8"));
const v = (x) => (x && typeof x === "object" && "valor" in x ? x.valor : x);
const TIERS = ["pro", "trader", "pilot"];
const CENARIOS = ["EXPECTED", "HEAVY", "STRESS"];
const MESES = 36;
const DIAS_MES = 30.4;
const brlUsd = P.moeda.brlPorUsd;
const holders = (t) => B.tiers[t].supplyPago + B.tiers[t].reserva;
const holdersTotal = TIERS.reduce((s, t) => s + holders(t), 0);
const receitaTotal = TIERS.reduce((s, t) => s + B.tiers[t].preco * B.tiers[t].supplyPago, 0);
const encargos = Object.values(P.trabalho.encargos).reduce((a, b) => a + b, 0);
const pr = Object.fromEntries(Object.entries(B.precos).map(([k, x]) => [k, v(x)]));
const un = Object.fromEntries(Object.entries(B.unitarios).map(([k, x]) => [k, v(x)]));
const fixoMesUsd = Object.values(B.fixosMensaisUsd).reduce((s, x) => s + v(x), 0);

const salarioBase = (papel) => papel === "LEAD" ? P.trabalho.salarioBaseLeadBrlMes : P.trabalho.salarioBaseL1BrlMes;
const progressao = (papel) => papel === "LEAD" ? P.trabalho.progressaoAnualLead : P.trabalho.progressaoAnualL1;
const salarioNoMes = (papel, mesDesdeInicio) => salarioBase(papel) * (1 + progressao(papel)) ** Math.floor((mesDesdeInicio - 1) / 12);
const custoMensalPessoa = (papel, mesDesdeInicio) => salarioNoMes(papel, mesDesdeInicio) * (1 + encargos)
  + P.trabalho.beneficiosBrlMesPessoa + P.trabalho.ferramentasBrlMesPessoa;
const treinamentoExtra = (papel) => P.trabalho.recrutamentoBrlPorContratacao
  + (papel === "LEAD" ? P.trabalho.treinamentoCursoBrlPorLead : P.trabalho.treinamentoCursoBrlPorL1)
  + P.trabalho.supervisaoInicialHorasPorContratacao * P.trabalho.custoCeoEspecialistaBrlHora;
const horasTreinamentoCobertasPelaFolha = (papel) => papel === "LEAD"
  ? P.trabalho.treinamentoHorasCobertasPelaFolhaLead
  : P.trabalho.treinamentoHorasCobertasPelaFolhaL1;
const horasProdutivasSteady = P.trabalho.horasBrutasMes * P.trabalho.fracaoProdutiva * P.trabalho.disponibilidadeFeriasAusencias;

function staffing(nome) {
  const cfg = P.staffing[nome];
  let suporteBrl = 0, treinamentoBrl = 0, horasTreinamentoNaFolha = 0, horas36 = 0;
  const meses = [];
  for (let mes = 1; mes <= MESES; mes++) {
    let custo = 0, horas = 0, ativos = 0;
    for (const pessoa of cfg.pessoas) {
      if (mes < pessoa.inicioMes) continue;
      ativos++;
      const desde = mes - pessoa.inicioMes + 1;
      const mensal = custoMensalPessoa(pessoa.papel, desde);
      custo += mensal;
      const ramp = P.trabalho.rampProdutividadeTresMeses[desde - 1] ?? 1;
      horas += horasProdutivasSteady * ramp;
      if (desde === 1) {
        // A folha já paga as horas de treinamento e o ramp já reduz a capacidade.
        // Somamos aqui somente desembolsos extras: recrutamento, curso/material e supervisão adicional.
        treinamentoBrl += treinamentoExtra(pessoa.papel);
        horasTreinamentoNaFolha += horasTreinamentoCobertasPelaFolha(pessoa.papel);
      }
    }
    suporteBrl += custo;
    horas36 += horas;
    meses.push({ mes, ativos, custoBrl: custo, horasProdutivas: horas });
  }
  return { nome, descricao: cfg.descricao, suporteBrl, treinamentoBrl, horasTreinamentoNaFolha, totalBrl: suporteBrl + treinamentoBrl, horas36, meses };
}

const staffingModels = Object.fromEntries(Object.keys(P.staffing).map((n) => [n, staffing(n)]));

function custoAnalise(cen) {
  const c = B.cenarios[cen];
  const prefixo = un.zionPrefixoTokens + (un.zionFatosTokens ?? 0);
  const entrada = prefixo + un.zionPayloadUsuarioTokens + 100;
  const cacheados = prefixo * c.cacheHitPrefixo;
  const naoCacheados = entrada - cacheados;
  const saida = un[c.saida];
  return (naoCacheados * pr.kimiInputPorMTok + cacheados * pr.kimiCacheReadPorMTok + saida * pr.kimiOutputPorMTok) / 1e6;
}
const tetoPorRodada = (t) => B.tiers[t].simbolosPorTeste * B.tiers[t].janelaMaxDias * 24;
const orcamentoDia = (t) => Math.floor(B.tiers[t].backtestsPorDia * tetoPorRodada(t) * B.orcamentoWorkbench.fracaoDoTeto[t]);
const velasDia = (t, cen) => B.cenarios[cen].backtestsUso === "orcamento"
  ? orcamentoDia(t) : B.cenarios[cen].backtestsUso[t] * B.cenarios[cen].velasPorBacktest;
const rodadasDia = (t, cen) => B.cenarios[cen].backtestsUso === "orcamento" ? B.tiers[t].backtestsPorDia : B.cenarios[cen].backtestsUso[t];
function custoPorVela() {
  const egress = (un.bytesPorVela / 1e9) * pr.egressGbUsd;
  const cpu = (un.cpuPorVelaPropriaUs / 3.6e9) * pr.cpuHoraUsd;
  const memoria = ((un.msDbPorPagina / 1000) / 1000) * un.memoriaFuncaoGb / 3600 * pr.memoriaGbHoraUsd;
  return egress + cpu + memoria;
}
function custoMesaMes(cen) {
  const mesasTotal = TIERS.reduce((s, t) => s + B.tiers[t].mesasDePapel * holders(t), 0);
  const ativas = mesasTotal * B.cenarios[cen].mesasAtivas;
  const ticksMes = un.tiquesPorDia * DIAS_MES;
  const custoTotal = ticksMes * ((un.tiqueEgressMb / 1000) * pr.egressGbUsd + (un.tiqueCpuS3250 / 3600) * pr.cpuHoraUsd)
    + ticksMes * (pr.invocacaoPorMilhaoUsd / 1e6);
  return ativas > 0 ? custoTotal / ativas : 0;
}
function maquina(t, cen) {
  const c = B.cenarios[cen], T = B.tiers[t];
  const ai = T.zionPorDia * c.zionUso * DIAS_MES * custoAnalise(cen) * MESES;
  const workbench = (velasDia(t, cen) * custoPorVela() + rodadasDia(t, cen) * pr.invocacaoPorMilhaoUsd / 1e6) * DIAS_MES * MESES;
  const papel = T.mesasDePapel * c.mesasAtivas * custoMesaMes(cen) * MESES;
  const rodadasMes = rodadasDia(t, cen) * DIAS_MES;
  const opsPorRodada = (velasDia(t, cen) / Math.max(1, rodadasDia(t, cen))) * un.operacoesPorVela;
  const gbRodadasMes = (rodadasMes * un.bytesPorRodada) / 1e9;
  const gbOpsMes = (rodadasMes * opsPorRodada * un.bytesPorOperacao) / 1e9;
  const somaMeses = MESES * (MESES + 1) / 2;
  const databaseCloud = (gbRodadasMes + gbOpsMes) * somaMeses * pr.armazenamentoGbMesUsd;
  return { compute: workbench + papel, ai, databaseCloud, fixed: fixoMesUsd * MESES / holdersTotal };
}

function demanda(cen, deflexao = P.operacao.deflexaoBase[cen]) {
  const minutos = P.operacao.ticketMinutos[cen];
  const porTier = {};
  for (const t of TIERS) {
    const elegiveisMes = P.operacao.contatosElegiveisPorHolderMes[cen][t] * holders(t);
    const humanosMes = elegiveisMes * (1 - deflexao);
    porTier[t] = { elegiveisMes, humanosMes, horasMes: humanosMes * minutos / 60 };
  }
  const total = TIERS.reduce((s, t) => s + porTier[t].horasMes, 0);
  return { porTier, horasMes: total, ticketsHumanosMes: TIERS.reduce((s, t) => s + porTier[t].humanosMes, 0) };
}

function linha(t, cen) {
  const d = demanda(cen);
  const staff = staffingModels[P.operacao.staffingPorCenario[cen]];
  const share = d.horasMes > 0 ? d.porTier[t].horasMes / d.horasMes : 0;
  const support = (staff.suporteBrl / brlUsd) * share / holders(t);
  const training = (staff.treinamentoBrl / brlUsd) * share / holders(t);
  const esc = P.operacao.escalacaoBase[cen];
  const ceoExpert = d.porTier[t].humanosMes * esc * P.operacao.horasPorEscalacao
    * P.trabalho.custoCeoEspecialistaBrlHora * MESES / brlUsd / holders(t);
  const m = maquina(t, cen);
  const otherOps = P.otherOpsBrlMes * MESES / brlUsd / holdersTotal;
  const total = m.compute + m.ai + m.databaseCloud + support + ceoExpert + training + m.fixed + otherOps;
  return { tier: t, cenario: cen, staffing: staff.nome, ...m, support, ceoExpert, training, otherOps, total };
}

const linhas = CENARIOS.flatMap((c) => TIERS.map((t) => linha(t, c)));
const L = (t, c) => linhas.find((x) => x.tier === t && x.cenario === c);

const restanteLinear = (total, mesesPrestados) => total * (MESES - mesesPrestados) / MESES;
const restanteDatabase = (total, mesesPrestados) => {
  const somaTotal = MESES * (MESES + 1) / 2;
  const somaIncorrida = mesesPrestados * (mesesPrestados + 1) / 2;
  return total * (somaTotal - somaIncorrida) / somaTotal;
};

/**
 * Obrigação de serviço por holder após N meses efetivamente prestados.
 * - front-loaded: recrutamento/curso/supervisão extra ainda não incorridos;
 * - recurring: folha exata dos meses futuros, fixos e other ops;
 * - variable: AI, compute, DB/cloud e escalação remanescentes.
 *
 * Não usa 1/36 cego: folha segue a progressão mensal e DB/cloud segue a curva
 * acumulativa de storage. Dados observados devem substituir a previsão no
 * recálculo periódico.
 */
function obrigacaoRestante(t, cen, mesesPrestados) {
  if (!Number.isInteger(mesesPrestados) || mesesPrestados < 0 || mesesPrestados > MESES) throw new Error(`meses_prestados_invalidos:${mesesPrestados}`);
  const l = L(t, cen);
  const d = demanda(cen);
  const staff = staffingModels[P.operacao.staffingPorCenario[cen]];
  const share = d.horasMes > 0 ? d.porTier[t].horasMes / d.horasMes : 0;
  const payrollFutureBrl = staff.meses.slice(mesesPrestados).reduce((s, x) => s + x.custoBrl, 0);
  const frontLoaded = mesesPrestados < P.serviceLiability.frontLoadedIncurridoNoMes ? l.training : 0;
  const recurring = {
    payrollService: payrollFutureBrl / brlUsd * share / holders(t),
    fixed: restanteLinear(l.fixed, mesesPrestados),
    otherOps: restanteLinear(l.otherOps, mesesPrestados),
  };
  const variable = {
    compute: restanteLinear(l.compute, mesesPrestados),
    ai: restanteLinear(l.ai, mesesPrestados),
    databaseCloud: restanteDatabase(l.databaseCloud, mesesPrestados),
    ceoExpert: restanteLinear(l.ceoExpert, mesesPrestados),
  };
  const total = frontLoaded + Object.values(recurring).reduce((a, b) => a + b, 0)
    + Object.values(variable).reduce((a, b) => a + b, 0);
  return { tier: t, cenario: cen, mesesPrestados, frontLoaded, recurring, variable, total };
}

const serviceLiability = {
  definition: "DYNAMIC_REMAINING_SERVICE_LIABILITY",
  recalculation: P.serviceLiability.recalculo,
  reserveIsAdditionalCost: false,
  hybridP90Observed: { status: "UNAVAILABLE_WITHOUT_OBSERVED_TELEMETRY", method: P.serviceLiability.hibridoP90 },
  buffers: P.serviceLiability.buffersPrudenciais,
  checkpoints: P.serviceLiability.checkpointsMesesPrestados.map((mesesPrestados) => {
    const tiers = Object.fromEntries(TIERS.map((t) => [t, obrigacaoRestante(t, "EXPECTED", mesesPrestados)]));
    const portfolioExpected = TIERS.reduce((s, t) => s + tiers[t].total * holders(t), 0);
    return {
      mesesPrestados,
      tiers,
      portfolioExpected,
      reserveSensitivity: Object.fromEntries(P.serviceLiability.buffersPrudenciais.map((b) => [String(b), portfolioExpected * (1 + b)])),
    };
  }),
};

const capitalPolicy = P.capitalPolicyV1Reference;
const serviceCoverageBrl = capitalPolicy.serviceCoverageBuckets.reduce((s, k) => s + capitalPolicy.bucketsBrl[k], 0);
const taxRegulatoryBrl = capitalPolicy.bucketsBrl.IMPOSTOS;
const emergencyRunwayBrl = capitalPolicy.bucketsBrl.EMERGENCIA + capitalPolicy.bucketsBrl.CEO;
const initialLiabilityUsd = serviceLiability.checkpoints.find((x) => x.mesesPrestados === 0).portfolioExpected;
const capitalReconciliation = P.serviceLiability.buffersPrudenciais.map((buffer) => {
  const serviceReserveBrl = initialLiabilityUsd * (1 + buffer) * brlUsd;
  const deployableCorporateCapitalBrl = Math.max(0, capitalPolicy.totalBrl - taxRegulatoryBrl - emergencyRunwayBrl - serviceReserveBrl);
  const reallocationRequiredBrl = Math.max(0, serviceReserveBrl - serviceCoverageBrl);
  return {
    buffer,
    grossProceedsBrl: capitalPolicy.totalBrl,
    taxRegulatoryBrl,
    serviceReserveBrl,
    emergencyRunwayBrl,
    deployableCorporateCapitalBrl,
    existingServiceCoverageBrl: serviceCoverageBrl,
    reallocationRequiredBrl,
    reconciledTotalBrl: taxRegulatoryBrl + serviceReserveBrl + emergencyRunwayBrl + deployableCorporateCapitalBrl,
    exceedsGross: taxRegulatoryBrl + serviceReserveBrl + emergencyRunwayBrl > capitalPolicy.totalBrl,
  };
});

const usd = (x) => `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brl = (x) => `R$ ${x.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

const out = [];
out.push("# FOUNDERS SUPPORT AND ECONOMICS — MODEL OUTPUT");
out.push("");
out.push("> Gerado por `node scripts/cost/modelo-founders-suporte-36m.mjs`. Não editar à mão.");
out.push("> Cenário de planejamento, não parecer contábil/jurídico. Custos de staffing são autoritativos em BRL; USD usa câmbio assumido.");
out.push("");
out.push("## Staffing models");
out.push("");
out.push("| modelo | desenho | folha/benefícios/ferramentas 36m | treinamento EXTRA | horas de treinamento já cobertas pela folha | total 36m | horas produtivas 36m |");
out.push("|---|---|---:|---:|---:|---:|---:|");
for (const s of Object.values(staffingModels)) out.push(`| ${s.nome} | ${s.descricao} | ${brl(s.suporteBrl)} | ${brl(s.treinamentoBrl)} | ${s.horasTreinamentoNaFolha.toLocaleString("pt-BR")} h | ${brl(s.totalBrl)} | ${Math.round(s.horas36).toLocaleString("pt-BR")} |`);
out.push("");
out.push("As horas de treinamento já são remuneradas na folha e reduzem a capacidade pelo ramp; não são cobradas novamente. `treinamento EXTRA` contém somente recrutamento, curso/material e supervisão adicional.");
out.push("");
out.push("## Capacity and ZION deflection");
out.push("");
out.push("| cenário | deflexão | tickets humanos/mês | horas humanas/mês | capacidade do staffing/mês (steady) | utilização | leitura |");
out.push("|---|---:|---:|---:|---:|---:|---|");
for (const cen of CENARIOS) for (const def of P.operacao.deflexaoSensibilidade) {
  const d = demanda(cen, def), s = staffingModels[P.operacao.staffingPorCenario[cen]];
  const capacidade = s.meses.slice(-1)[0].horasProdutivas;
  const util = d.horasMes / capacidade;
  out.push(`| ${cen} | ${pct(def)} | ${d.ticketsHumanosMes.toFixed(0)} | ${d.horasMes.toFixed(1)} | ${capacidade.toFixed(1)} | ${pct(util)} | ${util > 0.85 ? "BACKLOG PROVÁVEL" : util > 0.7 ? "gatilho de contratação" : "capacidade operacional"} |`);
}
out.push("");
out.push("## 36-month economic cost per holder (USD)");
out.push("");
out.push("| cenário | tier | compute | AI | database/cloud | support L1/L2 | CEO/expert | training | fixed | other ops | **total** | total/preço |");
out.push("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
for (const l of linhas) out.push(`| ${l.cenario} | ${l.tier} | ${usd(l.compute)} | ${usd(l.ai)} | ${usd(l.databaseCloud)} | ${usd(l.support)} | ${usd(l.ceoExpert)} | ${usd(l.training)} | ${usd(l.fixed)} | ${usd(l.otherOps)} | **${usd(l.total)}** | ${pct(l.total / B.tiers[l.tier].preco)} |`);
out.push("");
out.push("## Referral sensitivity per paid pass");
out.push("");
out.push("| cenário | tier | 0% | 10% | 15% | 20% |");
out.push("|---|---|---:|---:|---:|---:|");
for (const l of linhas) out.push(`| ${l.cenario} | ${l.tier} | ${P.referral.map((r) => usd(B.tiers[l.tier].preco * (1 - r) - l.total)).join(" | ")} |`);
out.push("");
out.push("## CEO/expert escalation sensitivity (36 months, full portfolio)");
out.push("");
out.push("| cenário | 0.5% | 1% | 2% | 5% |");
out.push("|---|---:|---:|---:|---:|");
for (const cen of CENARIOS) {
  const d = demanda(cen);
  out.push(`| ${cen} | ${P.operacao.escalacaoSensibilidade.map((r) => brl(d.ticketsHumanosMes * r * P.operacao.horasPorEscalacao * P.trabalho.custoCeoEspecialistaBrlHora * MESES)).join(" | ")} |`);
}
out.push("");
out.push("## Service reserve from remaining liability");
out.push("");
out.push("A reserva é capital segregado para pagar custos futuros, não um custo novo. A obrigação remanescente soma front-loaded ainda não incorrido, folha/serviço mensal futuro, AI, compute, DB/cloud, fixed ops e volume/escalation esperados. Folha usa a grade mensal real; DB/cloud usa a curva de storage. O modelo deve ser recalculado periodicamente com custos incorridos e uso observado.");
out.push("");
out.push("| meses prestados | passivo EXPECTED remanescente | ×1,10 | ×1,25 | ×1,50 |");
out.push("|---:|---:|---:|---:|---:|");
for (const cp of serviceLiability.checkpoints) out.push(`| ${cp.mesesPrestados} | ${usd(cp.portfolioExpected)} | ${usd(cp.reserveSensitivity["0.1"])} | ${usd(cp.reserveSensitivity["0.25"])} | ${usd(cp.reserveSensitivity["0.5"])} |`);
out.push("");
out.push("Opção híbrida P90/uso observado: definida, mas **não calculável sem telemetria real**. Ela usa o maior entre expected ajustado pelo run-rate observado e P90 empírico, mais buffer de execução. HEAVY permanece cenário de risco e não vira reserva automática.");
out.push("");
out.push("### Initial per-pass sensitivity (model output, not policy)");
out.push("");
out.push("| tier | obrigação expected/pass | ×1,10 | ×1,25 | ×1,50 |");
out.push("|---|---:|---:|---:|---:|");
const initialCheckpoint = serviceLiability.checkpoints.find((x) => x.mesesPrestados === 0);
for (const t of TIERS) out.push(`| ${t} | ${usd(initialCheckpoint.tiers[t].total)} | ${usd(initialCheckpoint.tiers[t].total * 1.10)} | ${usd(initialCheckpoint.tiers[t].total * 1.25)} | ${usd(initialCheckpoint.tiers[t].total * 1.50)} |`);
out.push("");
out.push("## Capital policy reconciliation");
out.push("");
out.push("A Service Reserve é reconciliada dentro da política de capital já existente. Não se soma uma segunda reserva aos 100% do caixa. D/E/F/K (infra, IA, equipe e operações) oferecem R$ " + serviceCoverageBrl.toLocaleString("pt-BR") + " de cobertura já alocada; eventual excesso exige reclassificação formal de outros baldes, nunca capital fictício.");
out.push("");
out.push("| buffer | gross proceeds | tax/regulatory | service liability reserve | emergency + CEO runway | deployable corporate capital | reallocation required | soma | > gross? |");
out.push("|---:|---:|---:|---:|---:|---:|---:|---:|---|");
for (const c of capitalReconciliation) out.push(`| ${pct(c.buffer)} | ${brl(c.grossProceedsBrl)} | ${brl(c.taxRegulatoryBrl)} | ${brl(c.serviceReserveBrl)} | ${brl(c.emergencyRunwayBrl)} | ${brl(c.deployableCorporateCapitalBrl)} | ${brl(c.reallocationRequiredBrl)} | ${brl(c.reconciledTotalBrl)} | ${c.exceedsGross ? "YES" : "NO"} |`);
out.push("");
out.push("A linha tributária é somente reserva de planejamento; não decide tratamento fiscal. Nenhum buffer foi aprovado como percentual final.");
out.push("## Portfolio result");
out.push("");
out.push("| cenário | receita bruta paga | custo 2.890 holders | 0% referral | 10% | 15% | 20% |");
out.push("|---|---:|---:|---:|---:|---:|---:|");
for (const cen of CENARIOS) {
  const cost = TIERS.reduce((s, t) => s + L(t, cen).total * holders(t), 0);
  out.push(`| ${cen} | ${usd(receitaTotal)} | ${usd(cost)} | ${P.referral.map((r) => usd(receitaTotal * (1 - r) - cost)).join(" | ")} |`);
}

const data = { assumptions: P, staffingModels, lines: linhas, serviceLiability, capitalReconciliation, generated: { holdersTotal, receitaTotal } };
writeFileSync("scripts/cost/founders-support-economics-output.json", JSON.stringify(data, null, 2) + "\n");
writeFileSync("docs/FOUNDERS-SUPPORT-ECONOMICS-MODEL.md", out.join("\n") + "\n");
console.log(out.join("\n"));
