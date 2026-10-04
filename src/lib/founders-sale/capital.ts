/**
 * POLÍTICA DE CAPITAL DOS FOUNDERS — modelo de PLANEJAMENTO, não contabilidade (docs/FOUNDERS-TREASURY-AND-CAPITAL-POLICY.md).
 *
 * Aprovada pelo dono em 04/10/2026: runway operacional mínimo de 24 meses; os recursos da venda não são capital
 * especulativo. A referência de venda total (US$ 796.250 ≈ R$ 4.149.100) é só REFERÊNCIA: o câmbio não é fixo e a
 * política escala por proporção.
 *
 * CASCATA ("RUNWAY PRIMEIRO, EXPANSÃO DEPOIS") — para todo valor efetivamente captado:
 *   1. reserva de impostos/regulatória — PROPORCIONAL ao captado (747.000 / 4.149.100 ≈ 18,0 %); é RESERVA,
 *      não cálculo de imposto;
 *   2. reserva de emergência → 3. CEO 24 meses → 4. IA → 5. infraestrutura → 6. segurança/jurídico MÍNIMO →
 *      7. estação de trabalho — cada um até a sua meta, nesta ordem (núcleo protegido);
 *   8. só então a expansão — restante de segurança, operações, equipe, crescimento e (com o portão) escritório —
 *      dividida pro rata pelas metas, sem passar da meta. O que sobra fica NÃO ALOCADO (reserva), nunca vira gasto.
 *
 * "Segurança mínima" = metade da meta de segurança (R$ 125.000). Parâmetro de engenharia DOCUMENTADO e ajustável:
 * com ele, o núcleo protegido fecha em ≈ R$ 2,106 mi — o patamar de "sobrevivência ≈ R$ 2,1 mi" do dono.
 *
 * Falha fechada: captado negativo/inválido, câmbio inválido, política inconsistente (metas, percentuais, níveis) e
 * qualquer alocação acima do disponível. Tudo em centavos inteiros (BigInt nas multiplicações).
 */

export const BALDES = [
  "IMPOSTOS", "EMERGENCIA", "CEO", "IA", "INFRA", "SEGURANCA", "ESTACAO", "OPERACOES", "EQUIPE", "CRESCIMENTO", "ESCRITORIO",
] as const;
export type Balde = (typeof BALDES)[number];

export interface MetaBalde {
  /** Valor de referência (venda total), em reais inteiros. */
  referenciaBrl: number;
  /** Percentual declarado pelo dono (1 casa) — conferido contra a referência. */
  percentualDeclarado: number;
  /** Referência mensal (planejamento), quando houver. */
  mensalBrl?: number;
}

export interface PoliticaCapital {
  versao: 1;
  runwayMeses: 24;
  referencia: { brutoUsd: number; totalBrl: number };
  metas: Record<Balde, MetaBalde>;
  /** Parte da meta de segurança que entra no núcleo protegido (o resto vai para a expansão). */
  segurancaMinimaBrl: number;
  /** Ordem do núcleo protegido (depois dos impostos). */
  ordemNucleo: readonly Balde[];
  /** Baldes da expansão (pro rata). `SEGURANCA` aqui = o restante acima do mínimo. */
  expansao: readonly Balde[];
  /** Patamares de planejamento (reais), não promessas. */
  niveis: { sobrevivencia: number; aquisicao: number; equipe: number; completo: number };
  portaoEscritorio: { mesesRunwayRestantesMin: number };
}

export const POLITICA_CAPITAL_V1: PoliticaCapital = {
  versao: 1,
  runwayMeses: 24,
  referencia: { brutoUsd: 796_250, totalBrl: 4_149_100 },
  metas: {
    IMPOSTOS: { referenciaBrl: 747_000, percentualDeclarado: 18.0 },
    EMERGENCIA: { referenciaBrl: 502_100, percentualDeclarado: 12.1 },
    CEO: { referenciaBrl: 360_000, percentualDeclarado: 8.7, mensalBrl: 15_000 },
    INFRA: { referenciaBrl: 360_000, percentualDeclarado: 8.7, mensalBrl: 15_000 },
    IA: { referenciaBrl: 300_000, percentualDeclarado: 7.2, mensalBrl: 12_500 },
    EQUIPE: { referenciaBrl: 720_000, percentualDeclarado: 17.4, mensalBrl: 30_000 },
    SEGURANCA: { referenciaBrl: 250_000, percentualDeclarado: 6.0 },
    ESCRITORIO: { referenciaBrl: 240_000, percentualDeclarado: 5.8 },
    ESTACAO: { referenciaBrl: 80_000, percentualDeclarado: 1.9 },
    CRESCIMENTO: { referenciaBrl: 450_000, percentualDeclarado: 10.8 },
    OPERACOES: { referenciaBrl: 140_000, percentualDeclarado: 3.4 },
  },
  segurancaMinimaBrl: 125_000,
  ordemNucleo: ["EMERGENCIA", "CEO", "IA", "INFRA", "SEGURANCA", "ESTACAO"],
  expansao: ["SEGURANCA", "OPERACOES", "EQUIPE", "CRESCIMENTO", "ESCRITORIO"],
  niveis: { sobrevivencia: 2_100_000, aquisicao: 2_500_000, equipe: 3_200_000, completo: 4_149_100 },
  portaoEscritorio: { mesesRunwayRestantesMin: 18 },
};

export type StatusRunway = "NO_CAPITAL" | "AT_RISK" | "PROTECTED_24M";
export type StatusEquipe = "LOCKED" | "SMALL_FOOTPRINT" | "SELECTED_SPECIALISTS" | "LARGER_TEAM" | "FULL_REFERENCE_CONTROLLED_RELEASE";
export type StatusCrescimento = "LOCKED" | "CONTROLLED" | "EXPANDED_ACQUISITION" | "FULL_REFERENCE_CONTROLLED_RELEASE";
export type StatusEscritorio = "LOCKED" | "PREPARATION_ONLY_GATE_PENDING" | "GATE_SATISFIED";

/** Fatos operacionais para o portão do escritório (nunca derivados do capital). */
export interface FatosEscritorio { plataformaOperacional: boolean; razaoDeNegocioDemonstrada: boolean; mesesRunwayRestantesAposCompromisso: number }

export interface Alocacao {
  ok: true;
  captadoBrlCentavos: number;
  porBalde: Record<Balde, number>;
  naoAlocadoBrlCentavos: number;
  nucleoProtegidoCompleto: boolean;
  runwayMesesCobertos: { CEO: number; IA: number; INFRA: number };
  RUNWAY_STATUS: StatusRunway;
  TEAM_EXPANSION_STATUS: StatusEquipe;
  GROWTH_UNLOCK_STATUS: StatusCrescimento;
  OFFICE_UNLOCK_STATUS: StatusEscritorio;
  patamar: "ZERO" | "SOBREVIVENCIA_NUCLEO_INCOMPLETO" | "SOBREVIVENCIA" | "AQUISICAO" | "EQUIPE" | "COMPLETO";
  aviso: "PLANEJAMENTO_NAO_CONTABILIDADE";
}
export type ErroCapital = { ok: false; erro: "captado_negativo" | "captado_invalido" | "cambio_invalido" | "politica_invalida" | "alocacao_excede_disponivel"; detalhe?: string[] };

const cent = (brl: number) => brl * 100;

/** Confere a política: metas inteiras ≥ 0, soma = total, percentuais declarados batem (1 casa) e somam 100,0, níveis em ordem. */
export function validarPolitica(p: PoliticaCapital): string[] {
  const e: string[] = [];
  let soma = 0, somaPct = 0;
  for (const b of BALDES) {
    const m = p.metas[b];
    if (!m || !Number.isInteger(m.referenciaBrl) || m.referenciaBrl < 0) { e.push(`meta_invalida:${b}`); continue; }
    soma += m.referenciaBrl;
    somaPct += Math.round(m.percentualDeclarado * 10);
    const calc = Math.round((m.referenciaBrl * 1000) / p.referencia.totalBrl); // décimos de %
    if (!Number.isFinite(m.percentualDeclarado) || Math.round(m.percentualDeclarado * 10) !== calc) e.push(`percentual_nao_confere:${b}`);
    if (m.mensalBrl !== undefined && m.mensalBrl * p.runwayMeses > m.referenciaBrl) e.push(`mensal_acima_da_meta:${b}`);
  }
  if (soma !== p.referencia.totalBrl) e.push(`soma_das_metas_${soma}_difere_do_total_${p.referencia.totalBrl}`);
  if (somaPct !== 1000) e.push(`percentuais_somam_${somaPct / 10}`);
  if (!(p.referencia.totalBrl > 0) || !(p.referencia.brutoUsd > 0)) e.push("referencia_invalida");
  if (!Number.isInteger(p.segurancaMinimaBrl) || p.segurancaMinimaBrl < 0 || p.segurancaMinimaBrl > p.metas.SEGURANCA.referenciaBrl) e.push("seguranca_minima_invalida");
  const n = p.niveis;
  if (!(0 < n.sobrevivencia && n.sobrevivencia < n.aquisicao && n.aquisicao < n.equipe && n.equipe <= n.completo)) e.push("niveis_fora_de_ordem");
  const vistos = new Set([...p.ordemNucleo, ...p.expansao.filter((b) => b !== "SEGURANCA")]);
  for (const b of BALDES) if (b !== "IMPOSTOS" && !vistos.has(b)) e.push(`balde_sem_lugar_na_cascata:${b}`);
  if (p.ordemNucleo.includes("IMPOSTOS") || p.expansao.includes("IMPOSTOS")) e.push("impostos_fora_do_primeiro_lugar");
  return e;
}

/** USD captado × câmbio (BRL por USD) → centavos de BRL (arredonda para baixo: nunca inventa dinheiro). */
export function converterParaBrl(brutoUsd: number, brlPorUsd: number): { ok: true; centavos: number } | ErroCapital {
  if (typeof brutoUsd !== "number" || !Number.isFinite(brutoUsd)) return { ok: false, erro: "captado_invalido" };
  if (brutoUsd < 0) return { ok: false, erro: "captado_negativo" };
  if (typeof brlPorUsd !== "number" || !Number.isFinite(brlPorUsd) || brlPorUsd <= 0) return { ok: false, erro: "cambio_invalido" };
  const usdCent = BigInt(Math.round(brutoUsd * 100));
  const fx = BigInt(Math.round(brlPorUsd * 1_000_000)); // 6 casas
  return { ok: true, centavos: Number((usdCent * fx) / 1_000_000n) };
}

/** Cenário de venda (fração da referência total) — exato em inteiros: 25 % de R$ 4.149.100 = R$ 1.037.275. */
export function cenarioBrlCentavos(p: PoliticaCapital, fracaoBps: number): number {
  return Number((BigInt(cent(p.referencia.totalBrl)) * BigInt(fracaoBps)) / 10_000n);
}

export function alocarCapital(captadoBrlCentavos: number, p: PoliticaCapital = POLITICA_CAPITAL_V1, fatos?: FatosEscritorio): Alocacao | ErroCapital {
  if (typeof captadoBrlCentavos !== "number" || !Number.isFinite(captadoBrlCentavos) || !Number.isInteger(captadoBrlCentavos)) return { ok: false, erro: "captado_invalido" };
  if (captadoBrlCentavos < 0) return { ok: false, erro: "captado_negativo" };
  const inval = validarPolitica(p);
  if (inval.length) return { ok: false, erro: "politica_invalida", detalhe: inval };

  const porBalde = Object.fromEntries(BALDES.map((b) => [b, 0])) as Record<Balde, number>;
  let resta = captadoBrlCentavos;
  // 1. impostos proporcionais
  porBalde.IMPOSTOS = Number((BigInt(captadoBrlCentavos) * BigInt(p.metas.IMPOSTOS.referenciaBrl)) / BigInt(p.referencia.totalBrl));
  resta -= porBalde.IMPOSTOS;
  // 2–7. núcleo protegido, em ordem, até a meta
  const metaNucleo = (b: Balde) => cent(b === "SEGURANCA" ? p.segurancaMinimaBrl : p.metas[b].referenciaBrl);
  for (const b of p.ordemNucleo) {
    const v = Math.min(resta, metaNucleo(b));
    porBalde[b] += v; resta -= v;
  }
  const nucleoProtegidoCompleto = p.ordemNucleo.every((b) => porBalde[b] === metaNucleo(b));
  // 8. expansão pro rata pelas metas restantes. O escritório SEMPRE pesa na divisão, mas antes do patamar de equipe
  //    a cota dele fica NÃO ALOCADA (reserva) — assim destravar o escritório nunca reduz outro balde (monotonia).
  const captadoBrl = captadoBrlCentavos / 100;
  const escritorioElegivel = nucleoProtegidoCompleto && captadoBrl >= p.niveis.equipe;
  const falta = (b: Balde) => cent(p.metas[b].referenciaBrl) - porBalde[b];
  if (nucleoProtegidoCompleto && resta > 0) {
    const pesos = p.expansao.map((b) => BigInt(falta(b)));
    const somaPesos = pesos.reduce((a, x) => a + x, 0n);
    if (somaPesos > 0n) {
      const pool = BigInt(resta) < somaPesos ? BigInt(resta) : somaPesos;
      p.expansao.forEach((b, i) => {
        if (b === "ESCRITORIO" && !escritorioElegivel) return;
        const v = Number((pool * pesos[i]) / somaPesos);
        porBalde[b] += v; resta -= v;
      });
    }
  }
  const naoAlocado = resta;
  // invariante: nada além do captado, nada acima da meta
  const total = BALDES.reduce((a, b) => a + porBalde[b], 0);
  const excede = total + naoAlocado !== captadoBrlCentavos || naoAlocado < 0 || BALDES.some((b) => porBalde[b] < 0 || (b !== "IMPOSTOS" && porBalde[b] > cent(p.metas[b].referenciaBrl)));
  if (excede) return { ok: false, erro: "alocacao_excede_disponivel" };

  const meses = (b: "CEO" | "IA" | "INFRA") => Math.min(p.runwayMeses, Math.floor(porBalde[b] / cent(p.metas[b].mensalBrl!)));
  const runwayOk = (["EMERGENCIA", "CEO", "IA", "INFRA"] as const).every((b) => porBalde[b] === cent(p.metas[b].referenciaBrl));
  const RUNWAY_STATUS: StatusRunway = captadoBrlCentavos === 0 ? "NO_CAPITAL" : runwayOk ? "PROTECTED_24M" : "AT_RISK";
  const n = p.niveis;
  const patamar: Alocacao["patamar"] = captadoBrlCentavos === 0 ? "ZERO" : !nucleoProtegidoCompleto ? "SOBREVIVENCIA_NUCLEO_INCOMPLETO"
    : captadoBrl >= n.completo ? "COMPLETO" : captadoBrl >= n.equipe ? "EQUIPE" : captadoBrl >= n.aquisicao ? "AQUISICAO" : "SOBREVIVENCIA";
  const TEAM_EXPANSION_STATUS: StatusEquipe = !nucleoProtegidoCompleto ? "LOCKED"
    : patamar === "COMPLETO" ? "FULL_REFERENCE_CONTROLLED_RELEASE" : patamar === "EQUIPE" ? "LARGER_TEAM" : patamar === "AQUISICAO" ? "SELECTED_SPECIALISTS" : "SMALL_FOOTPRINT";
  const GROWTH_UNLOCK_STATUS: StatusCrescimento = !nucleoProtegidoCompleto ? "LOCKED"
    : patamar === "COMPLETO" ? "FULL_REFERENCE_CONTROLLED_RELEASE" : patamar === "EQUIPE" || patamar === "AQUISICAO" ? "EXPANDED_ACQUISITION" : "CONTROLLED";
  const portao = !!fatos && fatos.plataformaOperacional && fatos.razaoDeNegocioDemonstrada
    && Number.isFinite(fatos.mesesRunwayRestantesAposCompromisso) && fatos.mesesRunwayRestantesAposCompromisso >= p.portaoEscritorio.mesesRunwayRestantesMin;
  const OFFICE_UNLOCK_STATUS: StatusEscritorio = !escritorioElegivel ? "LOCKED" : portao ? "GATE_SATISFIED" : "PREPARATION_ONLY_GATE_PENDING";

  return {
    ok: true, captadoBrlCentavos, porBalde, naoAlocadoBrlCentavos: naoAlocado, nucleoProtegidoCompleto,
    runwayMesesCobertos: { CEO: meses("CEO"), IA: meses("IA"), INFRA: meses("INFRA") },
    RUNWAY_STATUS, TEAM_EXPANSION_STATUS, GROWTH_UNLOCK_STATUS, OFFICE_UNLOCK_STATUS, patamar,
    aviso: "PLANEJAMENTO_NAO_CONTABILIDADE",
  };
}

/** Núcleo protegido em reais: menor captado que fecha impostos + núcleo (≈ patamar de sobrevivência). */
export function limiarNucleoBrlCentavos(p: PoliticaCapital = POLITICA_CAPITAL_V1): number {
  const nucleo = p.ordemNucleo.reduce((a, b) => a + cent(b === "SEGURANCA" ? p.segurancaMinimaBrl : p.metas[b].referenciaBrl), 0);
  // captado × (1 − t) ≥ núcleo, t = impostos/total  →  captado ≥ núcleo × total / (total − impostos)
  const tot = BigInt(p.referencia.totalBrl), imp = BigInt(p.metas.IMPOSTOS.referenciaBrl);
  let c = (BigInt(nucleo) * tot + (tot - imp) - 1n) / (tot - imp);
  // o imposto é arredondado para baixo: desce até o menor valor que ainda fecha o núcleo
  const fecha = (x: bigint) => x - (x * imp) / tot >= BigInt(nucleo);
  while (c > 0n && fecha(c - 1n)) c--;
  return Number(c);
}

/** Relatório do painel de planejamento: 25/50/75/100 % + valores customizados. Sem saldo bancário, sem ficção. */
export function relatorioCapital(p: PoliticaCapital = POLITICA_CAPITAL_V1, customBrlCentavos: readonly number[] = [], fatos?: FatosEscritorio) {
  const cenarios = [2500, 5000, 7500, 10_000].map((bps) => ({ nome: `${bps / 100}%`, captadoBrlCentavos: cenarioBrlCentavos(p, bps) }));
  const custom = customBrlCentavos.map((c, i) => ({ nome: `custom-${i + 1}`, captadoBrlCentavos: c }));
  return {
    versaoPolitica: p.versao,
    referencia: p.referencia,
    limiarNucleoBrlCentavos: limiarNucleoBrlCentavos(p),
    linhas: [...cenarios, ...custom].map((c) => ({ ...c, resultado: alocarCapital(c.captadoBrlCentavos, p, fatos) })),
    aviso: "PLANEJAMENTO_NAO_CONTABILIDADE" as const,
  };
}
