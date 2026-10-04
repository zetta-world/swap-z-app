import { TIERS, REGRA_DEMANDA_V1, type ConfigVenda, type TierVenda } from "./config";
import { avaliar, type Inscricao, type IntencaoNaoVinculante } from "./allowlist-hibrida";
import { canonico, sha256Hex } from "./evidencia";

/**
 * VALIDAÇÃO DE DEMANDA — regra PRÉ-REGISTRADA v1 (OD-NFT-21 APPROVED, 04/10/2026), congelada antes de qualquer
 * dado real. Denominador = supply PAGO do tier (a reserva não entra).
 *
 *   QUALIFIED_INTEREST          = e-mail verificado + carteira assinada + elegível pela política de jurisdição
 *                                 + tier escolhido (`avaliar` = ELIGIBLE).
 *   NON_BINDING_PURCHASE_INTENT = QUALIFIED_INTEREST + intenção explícita "pretende_comprar" AO PREÇO PROVISÓRIO
 *                                 DECLARADO do tier (`precoIntencaoUsd` = preço atual). Ninguém fica obrigado.
 *
 *   PASS         — os TRÊS tiers com qualificados ≥ ⌈35 % supply⌉ E intenção ≥ ⌈20 % supply⌉ (inteiros, teto);
 *   INCONCLUSIVE — algum tier fica abaixo, mas a demanda AGREGADA alcança a soma dos mínimos (demanda material);
 *                  ou a política de jurisdição não estava final / mudou durante a janela (o denominador qualificado
 *                  muda materialmente);
 *   FAIL         — janela fechada e a demanda agregada abaixo da soma dos mínimos pré-registrados.
 *
 * Antes da coleta real: AWAITING_REAL_COLLECTION; janela aberta: COLLECTING (sem veredito parcial).
 * Regra alterada sem nova versão = INVALID_RULE (falha fechada). Todo resultado carrega versão + fingerprint da regra,
 * para que um resultado antigo continue auditável se o dono aprovar uma v2 no futuro.
 */
export type StatusValidacao = "AWAITING_REAL_COLLECTION" | "COLLECTING" | "PASS" | "FAIL" | "INCONCLUSIVE" | "INVALID_RULE";

/** Mínimo inteiro = ⌈supply × bps / 10 000⌉ em aritmética inteira (sem ponto flutuante). */
export const minimoInteiro = (supply: number, bps: number) => Math.floor((supply * bps + 9_999) / 10_000);

export function minimosDemanda(cfg: ConfigVenda): Record<TierVenda, { qualificados: number; intencao: number }> {
  const r = cfg.validacaoDemanda.regra;
  const out = {} as Record<TierVenda, { qualificados: number; intencao: number }>;
  for (const t of TIERS) out[t] = { qualificados: minimoInteiro(cfg.supplyPago[t], r.qualificadoBps), intencao: minimoInteiro(cfg.supplyPago[t], r.intencaoBps) };
  return out;
}

export function fingerprintRegraDemanda(cfg: ConfigVenda): string {
  return sha256Hex(`founders-demanda-regra\0${canonico({ regra: cfg.validacaoDemanda.regra, supplyPago: cfg.supplyPago })}`);
}

const regraIntegra = (cfg: ConfigVenda) => canonico(cfg.validacaoDemanda.regra) === canonico(REGRA_DEMANDA_V1);

export interface RelatorioDemanda {
  inscricoes: number;
  emailsVerificados: number;
  carteirasAssinadas: number;
  qualificadas: number;
  qualificadasPendentesJuridico: number;
  preferencias: Record<TierVenda | "indeciso" | "sem_resposta", number>;
  interesseQualificadoPorTier: Record<TierVenda, number>;
  razaoInteresseSupply: Record<TierVenda, number>;
  intencao: Record<IntencaoNaoVinculante | "sem_resposta", number>;
  intencaoQualificadaPorTier: Record<TierVenda, number>;
  funilPct: { emailVerificado: number; carteiraAssinada: number; qualificada: number };
  fontes: Record<string, number>;
  janela: { de: number | null; ate: number | null };
  aviso: "INTENCAO_NAO_VINCULANTE";
}

const pct = (a: number, b: number) => (b === 0 ? 0 : Math.round((a / b) * 10_000) / 100);

export function relatorio(inscricoes: readonly Inscricao[], cfg: ConfigVenda): RelatorioDemanda {
  const pref = { PRO: 0, TRADER: 0, PILOT: 0, indeciso: 0, sem_resposta: 0 };
  const intencao = { pretende_comprar: 0, talvez: 0, so_interesse: 0, sem_resposta: 0 };
  const interesse = { PRO: 0, TRADER: 0, PILOT: 0 }, intencaoQ = { PRO: 0, TRADER: 0, PILOT: 0 };
  const fontes: Record<string, number> = {};
  let ev = 0, ca = 0, q = 0, qj = 0, de: number | null = null, ate: number | null = null;
  for (const i of inscricoes) {
    if (i.emailVerificado) ev++;
    if (i.carteira && i.carteiraAssinada) ca++;
    pref[i.preferenciaTier ?? "sem_resposta"]++;
    intencao[i.intencao ?? "sem_resposta"]++;
    fontes[i.fonte] = (fontes[i.fonte] ?? 0) + 1;
    de = de === null ? i.em : Math.min(de, i.em); ate = ate === null ? i.em : Math.max(ate, i.em);
    const a = avaliar(i, cfg);
    if (a.estado === "PENDING_LEGAL") qj++;
    if (a.estado !== "ELIGIBLE") continue;
    q++;
    const t = i.preferenciaTier as TierVenda; // ELIGIBLE já exige tier escolhido
    interesse[t]++;
    if (i.intencao === "pretende_comprar" && i.precoIntencaoUsd === cfg.precoUsd[t]) intencaoQ[t]++;
  }
  const razao = { PRO: 0, TRADER: 0, PILOT: 0 };
  for (const t of TIERS) razao[t] = Math.round((interesse[t] / cfg.supplyPago[t]) * 10_000) / 10_000;
  return {
    inscricoes: inscricoes.length, emailsVerificados: ev, carteirasAssinadas: ca, qualificadas: q, qualificadasPendentesJuridico: qj,
    preferencias: pref, interesseQualificadoPorTier: interesse, razaoInteresseSupply: razao, intencao, intencaoQualificadaPorTier: intencaoQ,
    funilPct: { emailVerificado: pct(ev, inscricoes.length), carteiraAssinada: pct(ca, inscricoes.length), qualificada: pct(q, inscricoes.length) },
    fontes, janela: { de, ate }, aviso: "INTENCAO_NAO_VINCULANTE",
  };
}

export interface AvaliacaoDemanda {
  status: StatusValidacao;
  porTier: Record<TierVenda, { qualificados: number; intencao: number; minimoQualificados: number; minimoIntencao: number; passa: boolean }>;
  agregado: { qualificados: number; intencao: number; minimoQualificados: number; minimoIntencao: number; material: boolean };
  motivos: string[];
  versaoRegra: number;
  fingerprintRegra: string;
}

export interface OpcoesAvaliacao {
  /** A política de jurisdição (OD-NFT-16) mudou durante a janela de coleta. */
  politicaJuridicaMudouNaJanela?: boolean;
}

export function avaliarDemanda(r: RelatorioDemanda, cfg: ConfigVenda, agora: number, o: OpcoesAvaliacao = {}): AvaliacaoDemanda {
  const min = minimosDemanda(cfg);
  const porTier = {} as AvaliacaoDemanda["porTier"];
  let aq = 0, ai = 0, mq = 0, mi = 0;
  for (const t of TIERS) {
    const q = r.interesseQualificadoPorTier[t], i = r.intencaoQualificadaPorTier[t];
    porTier[t] = { qualificados: q, intencao: i, minimoQualificados: min[t].qualificados, minimoIntencao: min[t].intencao, passa: q >= min[t].qualificados && i >= min[t].intencao };
    aq += q; ai += i; mq += min[t].qualificados; mi += min[t].intencao;
  }
  const agregado = { qualificados: aq, intencao: ai, minimoQualificados: mq, minimoIntencao: mi, material: aq >= mq && ai >= mi };
  const base = { porTier, agregado, versaoRegra: cfg.validacaoDemanda.regra.versao, fingerprintRegra: fingerprintRegraDemanda(cfg) };
  if (!regraIntegra(cfg)) return { ...base, status: "INVALID_RULE", motivos: ["regra difere da v1 pré-registrada — mudança exige nova decisão do dono e nova versão"] };
  const j = cfg.validacaoDemanda.janela;
  if (j.estado !== "CONFIGURADO") return { ...base, status: "AWAITING_REAL_COLLECTION", motivos: [`janela de coleta: ${j.estado} (${j.ref})`] };
  if (agora < j.valor.fim) return { ...base, status: "COLLECTING", motivos: ["janela aberta: sem veredito parcial"] };
  const motivos: string[] = [];
  if (cfg.juridico.paisesPermitidos.estado !== "CONFIGURADO" || r.qualificadasPendentesJuridico > 0) motivos.push("política de jurisdição não final: denominador qualificado pode mudar");
  if (o.politicaJuridicaMudouNaJanela) motivos.push("política de jurisdição mudou durante a janela");
  if (motivos.length) return { ...base, status: "INCONCLUSIVE", motivos };
  if (TIERS.every((t) => porTier[t].passa)) return { ...base, status: "PASS", motivos: [] };
  const abaixo = TIERS.filter((t) => !porTier[t].passa).map((t) => `${t} abaixo do mínimo`);
  return agregado.material
    ? { ...base, status: "INCONCLUSIVE", motivos: [...abaixo, "demanda agregada material"] }
    : { ...base, status: "FAIL", motivos: [...abaixo, "demanda agregada abaixo da soma dos mínimos pré-registrados"] };
}

/** Pacote de validação (relatórios separados exigidos pelo dono) — dados agregados, sem PII. */
export function pacoteDeValidacao(inscricoes: readonly Inscricao[], cfg: ConfigVenda, agora: number, o: OpcoesAvaliacao = {}) {
  const r = relatorio(inscricoes, cfg);
  const a = avaliarDemanda(r, cfg, agora, o);
  const cobertura = {} as Record<TierVenda, { supply: number; interesseQualificado: number; razao: number; minimoQualificados: number; minimoIntencao: number }>;
  for (const t of TIERS) {
    cobertura[t] = { supply: cfg.supplyPago[t], interesseQualificado: r.interesseQualificadoPorTier[t], razao: r.razaoInteresseSupply[t],
      minimoQualificados: a.porTier[t].minimoQualificados, minimoIntencao: a.porTier[t].minimoIntencao };
  }
  return {
    demandaPorTier: r.interesseQualificadoPorTier,
    carteirasQualificadas: { assinadas: r.carteirasAssinadas, qualificadas: r.qualificadas, pendentesJuridico: r.qualificadasPendentesJuridico },
    preferencias: r.preferencias,
    intencaoNaoVinculante: { ...r.intencao, qualificadaPorTier: r.intencaoQualificadaPorTier, aviso: r.aviso },
    coberturaDeSupply: cobertura,
    funil: { inscricoes: r.inscricoes, emailsVerificados: r.emailsVerificados, carteirasAssinadas: r.carteirasAssinadas, qualificadas: r.qualificadas, pct: r.funilPct },
    avaliacao: a,
    statusPreco: cfg.statusPreco,
  };
}
