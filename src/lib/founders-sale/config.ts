import { impressaoConfig } from "./evidencia";

/**
 * CONFIGURAÇÃO DA VENDA FOUNDERS — a única fonte dos números da venda no domínio.
 *
 * Valores APROVADOS pelo dono (docs/FOUNDERS-NFT-OWNER-DECISIONS.md, rev. 3, 04/10/2026) entram como dado.
 * Valores NÃO decididos entram como `Pendente` com o dono da pendência — nunca como um número inventado.
 * Um `Pendente` não pode ser lido como valor: quem precisa dele recebe o estado e falha fechado
 * (ex.: elegibilidade por país pendente = `PENDING_LEGAL`, não "todos liberados").
 *
 * `NFT_REAL_SALE=OFF`: a rede é sempre a falsa local; `validarConfig` recusa qualquer outra.
 */
export const TIERS = ["PRO", "TRADER", "PILOT"] as const;
export type TierVenda = (typeof TIERS)[number];

export type DonoDaPendencia = "PENDING_OWNER" | "PENDING_LEGAL" | "PENDING_EXTERNAL";
export type Pendente<T> =
  | { estado: "CONFIGURADO"; valor: T; fonte: string }
  | { estado: DonoDaPendencia; motivo: string; ref: string };

export const pendente = (estado: DonoDaPendencia, motivo: string, ref: string): Pendente<never> => ({ estado, motivo, ref });
export const configurado = <T>(valor: T, fonte: string): Pendente<T> => ({ estado: "CONFIGURADO", valor, fonte });
export const valorOu = <T>(p: Pendente<T>, padrao: T): T => (p.estado === "CONFIGURADO" ? p.valor : padrao);

export type StatusPreco = "PROVISIONAL_FOR_DEMAND_VALIDATION" | "FINAL";
export type RedeVenda = "solana:localnet-fake";

export interface LoteReservado { quantidade: number; finalidade: string }

export interface ConfigVenda {
  versao: 1;
  /** Supply PAGO da venda (OD-NFT-02/supply, 04/10). A reserva NÃO soma aqui. */
  supplyPago: Record<TierVenda, number>;
  /** OD-NFT-04: toda NFT reservada precisa de finalidade divulgada; quantidades não decididas. */
  reserva: Pendente<Record<TierVenda, LoteReservado[]>>;
  /** OD-NFT-02: âncora em USD, PROVISÓRIA até a validação de demanda. */
  precoUsd: Record<TierVenda, number>;
  statusPreco: StatusPreco;
  ancora: "USD";
  ativoPagamento: "SOL";
  /** Preço por fase: referência SOL/USD fotografada e congelada (fonte da referência: não decidida). */
  comportamentoPreco: "SNAPSHOT_AND_FREEZE";
  fonteReferencia: Pendente<string>;
  /** OD-NFT-05: allowlist 1 por tier; pública 2 (Pilot 1). Tetos CUMULATIVOS por carteira e tier. */
  tetos: { allowlist: Record<TierVenda, number>; publica: Record<TierVenda, number> };
  /** OD-NFT-06 (princípio): Pilot só allowlist. */
  pilotSomenteAllowlist: boolean;
  /** OD-NFT-07: allowlist 48 h → pública até esgotar ou 14 dias. */
  duracaoAllowlistMs: number;
  duracaoMaximaPublicaMs: number;
  /** OD-NFT-08: nenhuma data antes de jurídico + Vercel + ensaio. `null` = sem data. */
  horarios: {
    inscricaoAbre: number | null; inscricaoFecha: number | null;
    allowlistAbre: number | null; publicaAbre: number | null; vendaFecha: number | null;
  };
  /** OD-NFT-14: 36 meses do encerramento oficial da venda; sem expiração por versão. */
  premium: { meses: 36; inicio: "ENCERRAMENTO_OFICIAL_DA_VENDA" };
  /** OD-NFT-11: royalty para a tesouraria, sem distribuição a holders; % não decidido. */
  royalty: { destino: "TESOURARIA"; distribuicaoAHolders: false; percentual: Pendente<number> };
  /** OD-NFT-10 (modelo aprovado) + OD-NFT-22 (signatários/política pendentes). */
  tesouraria: {
    modo: "MULTISIG_REQUIRED";
    limiarPlanejado: { m: 2; n: 3 };
    signatarios: Pendente<string[]>;
    endereco: Pendente<string>;
    politicaConversao: Pendente<{ fracao: number; gatilho: string }>;
  };
  /** OD-NFT-16/17: jurídico. */
  juridico: {
    paisesPermitidos: Pendente<string[]>;
    paisesBloqueados: Pendente<string[]>;
    exigeKyc: Pendente<boolean>;
    textoReembolso: Pendente<string>;
    divulgacaoConsumidor: Pendente<string>;
  };
  /** OD-NFT-20. */
  relacaoPlanoMensal: Pendente<string>;
  /** OD-NFT-21. */
  validacaoDemanda: { limiaresPorTier: Pendente<Record<TierVenda, number>>; janelaMs: Pendente<number>; minimoAmostra: Pendente<number> };
  rede: RedeVenda;
}

const H = 3_600_000, D = 24 * H;

export const CONFIG_APROVADA: ConfigVenda = {
  versao: 1,
  supplyPago: { PRO: 2000, TRADER: 750, PILOT: 100 },
  reserva: pendente("PENDING_OWNER", "quantidades e finalidade por lote", "OD-NFT-04"),
  precoUsd: { PRO: 149, TRADER: 399, PILOT: 1990 },
  statusPreco: "PROVISIONAL_FOR_DEMAND_VALIDATION",
  ancora: "USD",
  ativoPagamento: "SOL",
  comportamentoPreco: "SNAPSHOT_AND_FREEZE",
  fonteReferencia: pendente("PENDING_OWNER", "fonte/mecanismo da referência SOL/USD", "OD-NFT-02"),
  tetos: { allowlist: { PRO: 1, TRADER: 1, PILOT: 1 }, publica: { PRO: 2, TRADER: 2, PILOT: 1 } },
  pilotSomenteAllowlist: true,
  duracaoAllowlistMs: 48 * H,
  duracaoMaximaPublicaMs: 14 * D,
  horarios: { inscricaoAbre: null, inscricaoFecha: null, allowlistAbre: null, publicaAbre: null, vendaFecha: null },
  premium: { meses: 36, inicio: "ENCERRAMENTO_OFICIAL_DA_VENDA" },
  royalty: { destino: "TESOURARIA", distribuicaoAHolders: false, percentual: pendente("PENDING_OWNER", "percentual de royalty", "OD-NFT-11") },
  tesouraria: {
    modo: "MULTISIG_REQUIRED",
    limiarPlanejado: { m: 2, n: 3 },
    signatarios: pendente("PENDING_OWNER", "identidade dos 3 signatários", "OD-NFT-22"),
    endereco: pendente("PENDING_EXTERNAL", "endereço da multisig só existe depois de criada pelo dono", "OD-NFT-10/22"),
    politicaConversao: pendente("PENDING_OWNER", "fração e gatilho da conversão para stable", "OD-NFT-22"),
  },
  juridico: {
    paisesPermitidos: pendente("PENDING_LEGAL", "jurisdições permitidas", "OD-NFT-16"),
    paisesBloqueados: pendente("PENDING_LEGAL", "jurisdições bloqueadas", "OD-NFT-16"),
    exigeKyc: pendente("PENDING_LEGAL", "KYC", "OD-NFT-16"),
    textoReembolso: pendente("PENDING_LEGAL", "texto de reembolso/cancelamento", "OD-NFT-17"),
    divulgacaoConsumidor: pendente("PENDING_LEGAL", "divulgação de direito do consumidor", "OD-NFT-17"),
  },
  relacaoPlanoMensal: pendente("PENDING_OWNER", "relação NFT × plano mensal (+30%)", "OD-NFT-20"),
  validacaoDemanda: {
    limiaresPorTier: pendente("PENDING_OWNER", "razão mínima interesse qualificado ÷ supply", "OD-NFT-21"),
    janelaMs: pendente("PENDING_OWNER", "janela de coleta", "OD-NFT-21"),
    minimoAmostra: pendente("PENDING_OWNER", "amostra mínima", "OD-NFT-21"),
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
  if (cfg.reserva.estado === "CONFIGURADO") {
    for (const t of TIERS) for (const l of cfg.reserva.valor[t]) {
      if (!inteiroPositivo(l.quantidade)) e.push(`reserva_quantidade_invalida:${t}`);
      if (!l.finalidade || l.finalidade.trim().length < 5) e.push(`reserva_sem_finalidade:${t}`);
    }
  }
  if (cfg.royalty.distribuicaoAHolders !== false || cfg.royalty.destino !== "TESOURARIA") e.push("royalty_fora_da_politica");
  if (cfg.royalty.percentual.estado === "CONFIGURADO") {
    const p = cfg.royalty.percentual.valor;
    if (!(p >= 0 && p <= 100)) e.push("royalty_percentual_invalido");
  }
  if (cfg.premium.meses !== 36) e.push("premium_fora_da_politica");
  if (cfg.statusPreco === "FINAL" && cfg.validacaoDemanda.limiaresPorTier.estado !== "CONFIGURADO") e.push("preco_final_sem_validacao_de_demanda");
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
  if (h.publicaAbre !== null && h.vendaFecha !== null && h.vendaFecha - h.publicaAbre > cfg.duracaoMaximaPublicaMs) e.push("janela_publica_excede_a_aprovada");
  return e;
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
