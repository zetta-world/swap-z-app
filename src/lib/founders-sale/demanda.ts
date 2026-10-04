import { TIERS, type ConfigVenda, type TierVenda } from "./config";
import { avaliar, type Inscricao, type IntencaoNaoVinculante } from "./allowlist-hibrida";

/**
 * VALIDAÇÃO DE DEMANDA (gate antes de `PRICE_STATUS=FINAL`) — docs/FOUNDERS-NFT-LAUNCH-FUNNEL.md §D.
 *
 * Calcula, por tier, o interesse QUALIFICADO (e-mail confirmado + carteira assinada + país permitido) com
 * preferência pelo tier, a razão interesse ÷ supply pago, a intenção NÃO VINCULANTE e o funil.
 * Os limiares (OD-NFT-21) são do dono e entram por configuração: sem eles o resultado é
 * `PENDING_OWNER_THRESHOLD` — o motor nunca escolhe um número. Com eles, classifica PASS / FAIL /
 * INCONCLUSIVE sem mudar código. Sem política de país (OD-NFT-16), "qualificado" depende do jurídico e
 * o resultado é INCONCLUSIVE (nunca PASS).
 */
export type StatusValidacao = "PENDING_OWNER_THRESHOLD" | "PASS" | "FAIL" | "INCONCLUSIVE";

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
    const t = i.preferenciaTier as TierVenda;
    interesse[t]++;
    if (i.intencao === "pretende_comprar") intencaoQ[t]++;
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
  porTier: Record<TierVenda, StatusValidacao>;
  motivos: string[];
  limiaresPendentes: string[];
}

/**
 * `agora` decide se a janela terminou: abaixo do limiar com a janela aberta = INCONCLUSIVE (ainda coletando),
 * com a janela fechada = FAIL. Amostra abaixo do mínimo = INCONCLUSIVE.
 */
export function avaliarDemanda(r: RelatorioDemanda, cfg: ConfigVenda, agora: number, inicioJanela: number | null): AvaliacaoDemanda {
  const { limiaresPorTier, janelaMs, minimoAmostra } = cfg.validacaoDemanda;
  const limiaresPendentes = [
    ...(limiaresPorTier.estado !== "CONFIGURADO" ? ["limiaresPorTier (OD-NFT-21)"] : []),
    ...(janelaMs.estado !== "CONFIGURADO" ? ["janelaMs (OD-NFT-21)"] : []),
    ...(minimoAmostra.estado !== "CONFIGURADO" ? ["minimoAmostra (OD-NFT-21)"] : []),
  ];
  const pend = { PRO: "PENDING_OWNER_THRESHOLD", TRADER: "PENDING_OWNER_THRESHOLD", PILOT: "PENDING_OWNER_THRESHOLD" } as Record<TierVenda, StatusValidacao>;
  if (limiaresPorTier.estado !== "CONFIGURADO" || janelaMs.estado !== "CONFIGURADO" || minimoAmostra.estado !== "CONFIGURADO") {
    return { status: "PENDING_OWNER_THRESHOLD", porTier: pend, motivos: ["limiares do dono não configurados"], limiaresPendentes };
  }
  const motivos: string[] = [];
  if (r.qualificadasPendentesJuridico > 0 || cfg.juridico.paisesPermitidos.estado !== "CONFIGURADO") motivos.push("política de país pendente do jurídico");
  const janelaFechada = inicioJanela !== null && agora >= inicioJanela + janelaMs.valor;
  const amostraOk = r.qualificadas >= minimoAmostra.valor;
  if (!amostraOk) motivos.push(`amostra ${r.qualificadas} < mínimo ${minimoAmostra.valor}`);
  const porTier = {} as Record<TierVenda, StatusValidacao>;
  for (const t of TIERS) {
    if (motivos.length) { porTier[t] = "INCONCLUSIVE"; continue; }
    const ok = r.razaoInteresseSupply[t] >= limiaresPorTier.valor[t];
    porTier[t] = ok ? "PASS" : janelaFechada ? "FAIL" : "INCONCLUSIVE";
  }
  const vals = Object.values(porTier);
  const status: StatusValidacao = vals.every((v) => v === "PASS") ? "PASS" : vals.some((v) => v === "FAIL") ? "FAIL" : "INCONCLUSIVE";
  return { status, porTier, motivos, limiaresPendentes };
}

/** Pacote de validação (relatórios separados exigidos pelo dono) — dados agregados, sem PII. */
export function pacoteDeValidacao(inscricoes: readonly Inscricao[], cfg: ConfigVenda, agora: number, inicioJanela: number | null) {
  const r = relatorio(inscricoes, cfg);
  const a = avaliarDemanda(r, cfg, agora, inicioJanela);
  const cobertura = {} as Record<TierVenda, { supply: number; interesseQualificado: number; razao: number; limiar: number | "PENDING_OWNER" }>;
  for (const t of TIERS) {
    cobertura[t] = { supply: cfg.supplyPago[t], interesseQualificado: r.interesseQualificadoPorTier[t], razao: r.razaoInteresseSupply[t],
      limiar: cfg.validacaoDemanda.limiaresPorTier.estado === "CONFIGURADO" ? cfg.validacaoDemanda.limiaresPorTier.valor[t] : "PENDING_OWNER" };
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
