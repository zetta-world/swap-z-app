import { impressaoConfig } from "./evidencia";

/**
 * CONFIGURAÇÃO DA VENDA FOUNDERS — a única fonte dos números da venda no domínio.
 *
 * Valores APROVADOS pelo dono (docs/FOUNDERS-NFT-OWNER-DECISIONS.md, rev. 4, 04/10/2026) entram como dado.
 * Valores NÃO decididos entram como `Pendente` com QUEM destrava — nunca como um número inventado:
 *   PENDING_OWNER (decisão do dono) · PENDING_LEGAL (jurídico/contábil) · PENDING_VERCEL (ambiente hospedado) ·
 *   PENDING_EXTERNAL (provedor externo / prontidão externa) · PENDING_CHAIN (devnet/mainnet/dinheiro real).
 * Um `Pendente` não pode ser lido como valor: quem precisa dele recebe o estado e falha fechado
 * (ex.: elegibilidade por país pendente = `PENDING_LEGAL`, não "todos liberados").
 *
 * `NFT_REAL_SALE=OFF`: a rede é sempre a falsa local; `validarConfig` recusa qualquer outra.
 */
export const TIERS = ["PRO", "TRADER", "PILOT"] as const;
export type TierVenda = (typeof TIERS)[number];

export type DonoDaPendencia = "PENDING_OWNER" | "PENDING_LEGAL" | "PENDING_VERCEL" | "PENDING_EXTERNAL" | "PENDING_CHAIN";
export type Pendente<T> =
  | { estado: "CONFIGURADO"; valor: T; fonte: string }
  | { estado: DonoDaPendencia; motivo: string; ref: string };

export const pendente = (estado: DonoDaPendencia, motivo: string, ref: string): Pendente<never> => ({ estado, motivo, ref });
export const configurado = <T>(valor: T, fonte: string): Pendente<T> => ({ estado: "CONFIGURADO", valor, fonte });
export const valorOu = <T>(p: Pendente<T>, padrao: T): T => (p.estado === "CONFIGURADO" ? p.valor : padrao);

export type StatusPreco = "PROVISIONAL_FOR_DEMAND_VALIDATION" | "FINAL";
export type RedeVenda = "solana:localnet-fake";

/** OD-NFT-04 (APPROVED 04/10): só estes usos. Nada de equipe, insider ou sorteio de Pilot. */
export const FINALIDADES_RESERVA = ["PARCEIRO_ESTRATEGICO_ECOSSISTEMA", "RECOMPENSA_COMUNIDADE_AUDITADA"] as const;
export type FinalidadeReserva = (typeof FINALIDADES_RESERVA)[number];
export interface LoteReservado { quantidade: number; finalidade: string; finalidadesPermitidas: readonly FinalidadeReserva[] }

/** OD-NFT-21 (APPROVED 04/10) — regra PRÉ-REGISTRADA, congelada antes de qualquer dado real. */
export interface RegraDemanda {
  versao: 1;
  /** QUALIFIED_INTEREST ≥ 35 % do supply PAGO do tier. */
  qualificadoBps: 3500;
  /** NON_BINDING_PURCHASE_INTENT ≥ 20 % do supply PAGO do tier. */
  intencaoBps: 2000;
  arredondamento: "TETO_INTEIRO";
  /** PASS exige os três tiers. */
  passExige: "TODOS_OS_TIERS";
}
export interface ParametrosConversao {
  /** Frações do valor RECEBIDO, em bps (somam 10 000). */
  solRetidoBps: number; stableBps: number; fiatBps: number;
  trancheMaxBrlCentavos: number;
  tranchesPorDiaMax: number;
  limitePorContraparteBps: number;
  contrapartes: readonly string[];
}

export interface ConfigVenda {
  versao: 1;
  /** Supply PAGO da venda (OD-NFT-02/supply, 04/10). A reserva NÃO soma aqui. */
  supplyPago: Record<TierVenda, number>;
  /** OD-NFT-04 (APPROVED): reserva NÃO paga, pequena e divulgada, FORA do supply pago. */
  reserva: Pendente<Record<TierVenda, LoteReservado[]>>;
  /** OD-NFT-02: âncora em USD, PROVISÓRIA até a validação de demanda. */
  precoUsd: Record<TierVenda, number>;
  statusPreco: StatusPreco;
  ancora: "USD";
  ativoPagamento: "SOL";
  /** Preço por fase: referência SOL/USD fotografada e congelada (fonte da referência: não decidida). */
  comportamentoPreco: "SNAPSHOT_AND_FREEZE";
  fonteReferencia: Pendente<string>;
  /** Regra final 06/10: allowlist 1 por tier; teto TOTAL do evento 2/2/1. Compras da allowlist contam no total. */
  tetos: { allowlist: Record<TierVenda, number>; publica: Record<TierVenda, number> };
  /** Allowlist 48 h; o EVENTO inteiro termina por sold-out real ou 14 dias desde `allowlistAbre`. */
  duracaoAllowlistMs: number;
  duracaoMaximaVendaMs: number;
  /** OD-NFT-08: PENDING_EXTERNAL_READINESS — nenhuma data antes de jurídico, Vercel, ensaio hospedado, ensaio em
   *  devnet, provedores prontos e a antecedência de anúncio. `null` = sem data (a autoridade não abre). */
  dataLancamento: Pendente<number>;
  horarios: {
    inscricaoAbre: number | null; inscricaoFecha: number | null;
    allowlistAbre: number | null; publicaAbre: number | null; vendaFecha: number | null;
  };
  /** OD-NFT-14: 36 meses do encerramento oficial da venda; sem expiração por versão. */
  premium: { meses: 36; inicio: "ENCERRAMENTO_OFICIAL_DA_VENDA" };
  /** OD-NFT-11 (APPROVED_SUBJECT_TO_LEGAL_AND_TECHNICAL_COMPATIBILITY): 2,5 % para a TESOURARIA, sem distribuição a
   *  holders, NUNCA anunciado como benefício do comprador (`publico: false`). Percentual em %, não em bps. */
  royalty: {
    destino: "TESOURARIA"; distribuicaoAHolders: false; publico: false;
    percentual: Pendente<number>;
    compatibilidade: Pendente<"COMPATIVEL">;
  };
  /** OD-NFT-10 + OD-NFT-22 (política PARTIALLY_CLOSED): multisig 2-de-3 com papéis definidos; só as identidades
   *  humanas dos signatários ficam com o dono. Conversão: princípio aprovado, parâmetros dependem de análise de risco
   *  documentada + revisão contábil/jurídica. */
  tesouraria: {
    modo: "MULTISIG_REQUIRED";
    limiarPlanejado: { m: 2; n: 3 };
    papeisSignatarios: readonly ["A_CEO_AUTORIDADE_CORPORATIVA", "B_INDEPENDENTE_FINANCEIRO_SEGURANCA", "C_INDEPENDENTE_RECUPERACAO_CONTINUIDADE"];
    signatarios: Pendente<string[]>;
    endereco: Pendente<string>;
    politicaConversao: {
      principio: "OBRIGACOES_OPERACIONAIS_FORA_DO_RISCO_SOL";
      parametros: Pendente<ParametrosConversao>;
    };
  };
  /** OD-NFT-16/17: jurídico. */
  juridico: {
    paisesPermitidos: Pendente<string[]>;
    paisesBloqueados: Pendente<string[]>;
    exigeKyc: Pendente<boolean>;
    textoReembolso: Pendente<string>;
    divulgacaoConsumidor: Pendente<string>;
  };
  /** OD-NFT-20 (APPROVED): produtos separados; "+30 %" = orientação de preço NÃO vinculante. */
  relacaoPlanoMensal: Pendente<RelacaoPlanoMensal>;
  /** OD-NFT-21 (APPROVED, regra v1). Janela e resultado só existem com a coleta real. */
  validacaoDemanda: {
    regra: RegraDemanda;
    janela: Pendente<{ inicio: number; fim: number }>;
    resultado: Pendente<{ status: "PASS" | "FAIL" | "INCONCLUSIVE"; fingerprintRegra: string; avaliadoEm: number }>;
  };
  rede: RedeVenda;
}

export interface RelacaoPlanoMensal {
  modelo: "PRODUTOS_COMERCIAIS_SEPARADOS";
  regraMais30: "NON_BINDING_PRICING_GUIDANCE";
  assinaturaDisponivelParaNaoHolders: true;
  garantiaDePremioFuturoSobreONft: false;
}

export const REGRA_DEMANDA_V1: RegraDemanda = { versao: 1, qualificadoBps: 3500, intencaoBps: 2000, arredondamento: "TETO_INTEIRO", passExige: "TODOS_OS_TIERS" };

const H = 3_600_000, D = 24 * H;
const RESERVA_FINS = FINALIDADES_RESERVA;
/** OD-NFT-04: teto aprovado da reserva não paga, por tier (TOTAL 40, fora dos 2.850 pagos). */
export const RESERVA_APROVADA_MAX: Readonly<Record<TierVenda, number>> = { PRO: 30, TRADER: 10, PILOT: 0 };

export const CONFIG_APROVADA: ConfigVenda = {
  versao: 1,
  supplyPago: { PRO: 2000, TRADER: 750, PILOT: 100 },
  reserva: configurado({
    PRO: [{ quantidade: 30, finalidade: "parceiros estratégicos do ecossistema e recompensas/campanhas de comunidade auditadas", finalidadesPermitidas: RESERVA_FINS }],
    TRADER: [{ quantidade: 10, finalidade: "parceiros estratégicos do ecossistema e recompensas/campanhas de comunidade auditadas", finalidadesPermitidas: RESERVA_FINS }],
    PILOT: [],
  }, "OD-NFT-04 APPROVED 04/10/2026"),
  precoUsd: { PRO: 149, TRADER: 399, PILOT: 1990 },
  statusPreco: "PROVISIONAL_FOR_DEMAND_VALIDATION",
  ancora: "USD",
  ativoPagamento: "SOL",
  comportamentoPreco: "SNAPSHOT_AND_FREEZE",
  fonteReferencia: pendente("PENDING_EXTERNAL", "provedor da referência SOL/USD + snapshot real (nenhum oráculo de produção nesta fase)", "OD-NFT-02"),
  tetos: { allowlist: { PRO: 1, TRADER: 1, PILOT: 1 }, publica: { PRO: 2, TRADER: 2, PILOT: 1 } },
  duracaoAllowlistMs: 48 * H,
  duracaoMaximaVendaMs: 14 * D,
  dataLancamento: pendente("PENDING_EXTERNAL", "PENDING_EXTERNAL_READINESS: jurídico, Vercel, ensaio hospedado, devnet, provedores e antecedência de anúncio", "OD-NFT-08"),
  horarios: { inscricaoAbre: null, inscricaoFecha: null, allowlistAbre: null, publicaAbre: null, vendaFecha: null },
  premium: { meses: 36, inicio: "ENCERRAMENTO_OFICIAL_DA_VENDA" },
  royalty: {
    destino: "TESOURARIA", distribuicaoAHolders: false, publico: false,
    percentual: configurado(2.5, "OD-NFT-11 APPROVED_SUBJECT_TO_LEGAL_AND_TECHNICAL_COMPATIBILITY 04/10/2026"),
    compatibilidade: pendente("PENDING_CHAIN", "padrão/marketplace escolhido precisa suportar (ou não impor) royalty — conferir no devnet; revisão jurídica antes da mainnet", "OD-NFT-11"),
  },
  tesouraria: {
    modo: "MULTISIG_REQUIRED",
    limiarPlanejado: { m: 2, n: 3 },
    papeisSignatarios: ["A_CEO_AUTORIDADE_CORPORATIVA", "B_INDEPENDENTE_FINANCEIRO_SEGURANCA", "C_INDEPENDENTE_RECUPERACAO_CONTINUIDADE"],
    signatarios: pendente("PENDING_OWNER", "PENDING_OWNER_IDENTITY_SELECTION: identidades humanas dos 3 signatários", "OD-NFT-22"),
    endereco: pendente("PENDING_CHAIN", "endereço da multisig só existe depois de criada (devnet → mainnet, com autorização)", "OD-NFT-10/22"),
    politicaConversao: {
      principio: "OBRIGACOES_OPERACIONAIS_FORA_DO_RISCO_SOL",
      parametros: pendente("PENDING_LEGAL", "tranches, limites, contrapartes e divisão stable/fiat: análise de risco documentada + revisão contábil/jurídica", "OD-NFT-22"),
    },
  },
  juridico: {
    paisesPermitidos: pendente("PENDING_LEGAL", "jurisdições permitidas", "OD-NFT-16"),
    paisesBloqueados: pendente("PENDING_LEGAL", "jurisdições bloqueadas", "OD-NFT-16"),
    exigeKyc: pendente("PENDING_LEGAL", "KYC", "OD-NFT-16"),
    textoReembolso: pendente("PENDING_LEGAL", "texto de reembolso/cancelamento", "OD-NFT-17"),
    divulgacaoConsumidor: pendente("PENDING_LEGAL", "divulgação de direito do consumidor", "OD-NFT-17"),
  },
  relacaoPlanoMensal: configurado({
    modelo: "PRODUTOS_COMERCIAIS_SEPARADOS", regraMais30: "NON_BINDING_PRICING_GUIDANCE",
    assinaturaDisponivelParaNaoHolders: true, garantiaDePremioFuturoSobreONft: false,
  }, "OD-NFT-20 APPROVED 04/10/2026"),
  validacaoDemanda: {
    regra: REGRA_DEMANDA_V1,
    janela: pendente("PENDING_VERCEL", "coleta real exige Early Access hospedado + texto de consentimento aprovado; janela registrada ANTES do primeiro dado", "OD-NFT-21"),
    resultado: pendente("PENDING_EXTERNAL", "só existe depois da coleta real e da janela fechada", "OD-NFT-21"),
  },
  rede: "solana:localnet-fake",
};

/** Reserva efetiva: pendente = 0 SÓ PARA SIMULAÇÃO (rotulado). Nunca soma unidades reais escondidas. */
export function reservaEfetiva(cfg: ConfigVenda): { porTier: Record<TierVenda, number>; origem: "CONFIGURADA" | "UNCONFIGURED_SIMULATION_ZERO" } {
  if (cfg.reserva.estado !== "CONFIGURADO") return { porTier: { PRO: 0, TRADER: 0, PILOT: 0 }, origem: "UNCONFIGURED_SIMULATION_ZERO" };
  const porTier = { PRO: 0, TRADER: 0, PILOT: 0 };
  for (const t of TIERS) porTier[t] = cfg.reserva.valor[t].reduce((s, l) => s + l.quantidade, 0);
  return { porTier, origem: "CONFIGURADA" };
}

export function validarConfig(cfg: ConfigVenda): string[] {
  const e: string[] = [];
  const inteiroPositivo = (n: unknown) => Number.isInteger(n) && (n as number) > 0;
  if (cfg.rede !== "solana:localnet-fake") e.push("rede_nao_permitida");
  for (const t of TIERS) {
    if (!inteiroPositivo(cfg.supplyPago[t])) e.push(`supply_invalido:${t}`);
    if (!(cfg.precoUsd[t] > 0) || !Number.isFinite(cfg.precoUsd[t])) e.push(`preco_invalido:${t}`);
    if (!inteiroPositivo(cfg.tetos.allowlist[t]) || !inteiroPositivo(cfg.tetos.publica[t])) e.push(`teto_invalido:${t}`);
    if (cfg.tetos.publica[t] < cfg.tetos.allowlist[t]) e.push(`teto_publico_menor_que_allowlist:${t}`);
  }
  if (cfg.duracaoAllowlistMs !== 48 * H) e.push("duracao_allowlist_fora_da_politica");
  if (cfg.duracaoMaximaVendaMs !== 14 * D) e.push("duracao_maxima_venda_fora_da_politica");
  if (cfg.reserva.estado === "CONFIGURADO") {
    for (const t of TIERS) for (const l of cfg.reserva.valor[t]) {
      if (!inteiroPositivo(l.quantidade)) e.push(`reserva_quantidade_invalida:${t}`);
      if (!l.finalidade || l.finalidade.trim().length < 5) e.push(`reserva_sem_finalidade:${t}`);
      if (!l.finalidadesPermitidas?.length || l.finalidadesPermitidas.some((f) => !(FINALIDADES_RESERVA as readonly string[]).includes(f))) e.push(`reserva_finalidade_fora_da_politica:${t}`);
    }
    // OD-NFT-04: nada de sorteio de Pilot; acima do aprovado (30/10/0) só com nova decisão do dono.
    if (cfg.reserva.valor.PILOT.length) e.push("reserva_pilot_proibida");
    for (const t of TIERS) {
      const q = cfg.reserva.valor[t].reduce((a, l) => a + l.quantidade, 0);
      if (q > RESERVA_APROVADA_MAX[t]) e.push(`reserva_acima_do_aprovado:${t}`);
    }
  }
  if (cfg.royalty.distribuicaoAHolders !== false || cfg.royalty.destino !== "TESOURARIA") e.push("royalty_fora_da_politica");
  if (cfg.royalty.publico !== false) e.push("royalty_nao_pode_ser_beneficio_publico");
  if (cfg.royalty.percentual.estado === "CONFIGURADO") {
    const p = cfg.royalty.percentual.valor;
    if (!(p >= 0 && p <= 100) || !Number.isInteger(Math.round(p * 100)) || Math.abs(p * 100 - Math.round(p * 100)) > 1e-9) e.push("royalty_percentual_invalido");
  }
  if (cfg.premium.meses !== 36) e.push("premium_fora_da_politica");
  const vr = cfg.validacaoDemanda.resultado;
  if (cfg.statusPreco === "FINAL" && !(vr.estado === "CONFIGURADO" && vr.valor.status === "PASS")) e.push("preco_final_sem_validacao_de_demanda");
  const rg = cfg.validacaoDemanda.regra;
  if (rg.versao !== REGRA_DEMANDA_V1.versao || rg.qualificadoBps !== REGRA_DEMANDA_V1.qualificadoBps || rg.intencaoBps !== REGRA_DEMANDA_V1.intencaoBps
      || rg.arredondamento !== REGRA_DEMANDA_V1.arredondamento || rg.passExige !== REGRA_DEMANDA_V1.passExige) e.push("regra_de_demanda_alterada_sem_nova_versao");
  const pc = cfg.tesouraria.politicaConversao.parametros;
  if (pc.estado === "CONFIGURADO") for (const x of validarParametrosConversao(pc.valor)) e.push(x);
  if (cfg.tesouraria.limiarPlanejado.m < 2 || cfg.tesouraria.limiarPlanejado.n < 3) e.push("tesouraria_signatario_unico");
  const h = cfg.horarios;
  const ordem: Array<[string, number | null]> = [["inscricaoAbre", h.inscricaoAbre], ["inscricaoFecha", h.inscricaoFecha], ["allowlistAbre", h.allowlistAbre], ["publicaAbre", h.publicaAbre], ["vendaFecha", h.vendaFecha]];
  let anterior = -Infinity;
  for (const [nome, v] of ordem) {
    if (v === null) continue;
    if (!Number.isInteger(v)) { e.push(`horario_invalido:${nome}`); continue; }
    if (v <= anterior) e.push(`horario_fora_de_ordem:${nome}`);
    anterior = v;
  }
  if (h.allowlistAbre !== null && h.publicaAbre !== null && h.publicaAbre - h.allowlistAbre !== cfg.duracaoAllowlistMs) e.push("janela_allowlist_difere_da_aprovada");
  if (h.allowlistAbre !== null && h.vendaFecha !== null && h.vendaFecha - h.allowlistAbre > cfg.duracaoMaximaVendaMs) e.push("janela_total_excede_a_aprovada");
  return e;
}

/** Parâmetros de conversão: frações somam 10 000 bps, limites positivos, contrapartes nomeadas. */
export function validarParametrosConversao(p: ParametrosConversao): string[] {
  const e: string[] = [];
  const bps = [p.solRetidoBps, p.stableBps, p.fiatBps];
  if (bps.some((x) => !Number.isInteger(x) || x < 0) || bps.reduce((a, b) => a + b, 0) !== 10_000) e.push("conversao_fracoes_invalidas");
  if (!Number.isInteger(p.trancheMaxBrlCentavos) || p.trancheMaxBrlCentavos <= 0) e.push("conversao_tranche_invalida");
  if (!Number.isInteger(p.tranchesPorDiaMax) || p.tranchesPorDiaMax <= 0) e.push("conversao_tranches_por_dia_invalido");
  if (!Number.isInteger(p.limitePorContraparteBps) || p.limitePorContraparteBps <= 0 || p.limitePorContraparteBps > 10_000) e.push("conversao_limite_contraparte_invalido");
  if (!p.contrapartes.length || new Set(p.contrapartes).size !== p.contrapartes.length) e.push("conversao_contrapartes_invalidas");
  // nenhuma contraparte pode receber tudo se houver limite < 100 %: as contrapartes têm de cobrir 100 %
  if (p.contrapartes.length * p.limitePorContraparteBps < 10_000) e.push("conversao_limites_nao_cobrem_o_total");
  return e;
}

/** Royalty em basis points (padrão on-chain): 2,5 % → 250. Pendente → null. */
export function royaltyBps(cfg: ConfigVenda): number | null {
  return cfg.royalty.percentual.estado === "CONFIGURADO" ? Math.round(cfg.royalty.percentual.valor * 100) : null;
}

/** Supply da coleção: pago (base do capital) + reserva divulgada (fora da venda). */
export function supplyDaColecao(cfg: ConfigVenda): { pago: number; reservado: number; maximo: number; porTier: Record<TierVenda, { pago: number; reservado: number }> } {
  const r = reservaEfetiva(cfg);
  const porTier = { PRO: { pago: 0, reservado: 0 }, TRADER: { pago: 0, reservado: 0 }, PILOT: { pago: 0, reservado: 0 } };
  let pago = 0, reservado = 0;
  for (const t of TIERS) { porTier[t] = { pago: cfg.supplyPago[t], reservado: r.porTier[t] }; pago += cfg.supplyPago[t]; reservado += r.porTier[t]; }
  return { pago, reservado, maximo: pago + reservado, porTier };
}

/** Fingerprint da configuração (sha256 canônico). Publicar antes de abrir; conferir em cada operação. */
export function fingerprintConfig(cfg: ConfigVenda): string {
  return impressaoConfig(cfg as unknown as Record<string, unknown>);
}

/** Itens pendentes (para o painel e a evidência): nada aparece como "decidido" sem estar. */
export function pendencias(cfg: ConfigVenda): Array<{ campo: string; estado: DonoDaPendencia; ref: string; motivo: string }> {
  const out: Array<{ campo: string; estado: DonoDaPendencia; ref: string; motivo: string }> = [];
  const visitar = (v: unknown, caminho: string) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (typeof o.estado === "string" && o.estado.startsWith("PENDING_")) {
      out.push({ campo: caminho, estado: o.estado as DonoDaPendencia, ref: String(o.ref), motivo: String(o.motivo) });
      return;
    }
    for (const [k, x] of Object.entries(o)) visitar(x, caminho ? `${caminho}.${k}` : k);
  };
  visitar(cfg, "");
  return out.sort((a, b) => a.campo.localeCompare(b.campo));
}

/** Gross teórico (CENÁRIO, não previsão): supply pago × preço provisório. */
export function grossTeoricoUsd(cfg: ConfigVenda): { porTier: Record<TierVenda, number>; total: number } {
  const porTier = { PRO: 0, TRADER: 0, PILOT: 0 };
  for (const t of TIERS) porTier[t] = cfg.supplyPago[t] * cfg.precoUsd[t];
  return { porTier, total: porTier.PRO + porTier.TRADER + porTier.PILOT };
}
