import type { ConfigVenda, RelacaoPlanoMensal, TierVenda } from "./config";

/**
 * BENEFÍCIOS DO PASSE — só o que a plataforma sustenta (OD-NFT-18, 04/10/2026).
 *
 *   grupo A (disponível no lançamento): premium do tier por 36 meses, taxa de swap reduzida do tier, badge on-chain;
 *   grupo B (roadmap, SEM data): rotulado "planejado";
 *   grupo C (excluído): nunca aparece como promessa — distribuição de royalty, tokens/alocações futuras, whitelist
 *   garantida em coleções futuras, voto sobre a tesouraria.
 *
 * Janela premium (OD-NFT-14): 36 meses CORRIDOS a partir do encerramento OFICIAL da venda. Sem gatilho por versão.
 * Relação com o plano mensal (OD-NFT-20): PENDENTE — este módulo não calcula "+30%".
 *
 * Taxas: espelho de `src/lib/tier/fees.ts` (`TIER_FEE_BPS`); um teste garante que não divergem.
 */
export const TAXA_SWAP_BPS: Record<TierVenda | "FREE", number> = { FREE: 100, PRO: 50, TRADER: 25, PILOT: 10 };

export type GrupoBeneficio = "A_DISPONIVEL" | "B_ROADMAP" | "C_EXCLUIDO";
export interface Beneficio { id: string; grupo: GrupoBeneficio; tiers: readonly TierVenda[]; duracao: "PREMIUM_36_MESES" | "PERMANENTE_COM_O_PASSE" }

const TODOS: readonly TierVenda[] = ["PRO", "TRADER", "PILOT"];
export const BENEFICIOS: readonly Beneficio[] = [
  { id: "zion_advisory", grupo: "A_DISPONIVEL", tiers: TODOS, duracao: "PREMIUM_36_MESES" },
  { id: "cex_autopilot", grupo: "A_DISPONIVEL", tiers: TODOS, duracao: "PREMIUM_36_MESES" },
  { id: "arb_scanner", grupo: "A_DISPONIVEL", tiers: ["TRADER", "PILOT"], duracao: "PREMIUM_36_MESES" },
  { id: "priority_support", grupo: "A_DISPONIVEL", tiers: ["TRADER", "PILOT"], duracao: "PREMIUM_36_MESES" },
  { id: "reduced_swap_fee", grupo: "A_DISPONIVEL", tiers: TODOS, duracao: "PREMIUM_36_MESES" },
  { id: "founder_badge_onchain", grupo: "A_DISPONIVEL", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "founder_theme", grupo: "B_ROADMAP", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "hall_of_fame_opt_in", grupo: "B_ROADMAP", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "early_access_priority", grupo: "B_ROADMAP", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "product_polls", grupo: "B_ROADMAP", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "beta_access", grupo: "B_ROADMAP", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "elevated_api_limits", grupo: "B_ROADMAP", tiers: TODOS, duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "royalty_distribution_to_holders", grupo: "C_EXCLUIDO", tiers: [], duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "future_token_allocation", grupo: "C_EXCLUIDO", tiers: [], duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "guaranteed_future_allowlist", grupo: "C_EXCLUIDO", tiers: [], duracao: "PERMANENTE_COM_O_PASSE" },
  { id: "treasury_governance", grupo: "C_EXCLUIDO", tiers: [], duracao: "PERMANENTE_COM_O_PASSE" },
];

export const beneficiosPublicaveis = (tier: TierVenda) => BENEFICIOS.filter((b) => b.grupo !== "C_EXCLUIDO" && b.tiers.includes(tier));

/** Soma meses de calendário em UTC; se o dia não existe no mês de destino, usa o último dia do mês. */
export function somarMesesUtc(ms: number, meses: number): number {
  const d = new Date(ms);
  const alvoMes = d.getUTCMonth() + meses;
  const ano = d.getUTCFullYear() + Math.floor(alvoMes / 12), mes = ((alvoMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return Date.UTC(ano, mes, Math.min(d.getUTCDate(), ultimoDia), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

export type JanelaPremium = { estado: "AGUARDANDO_ENCERRAMENTO_DA_VENDA" } | { estado: "DEFINIDA"; inicio: number; fim: number };

export function janelaPremium(cfg: ConfigVenda, encerramentoOficial: number | null): JanelaPremium {
  if (encerramentoOficial === null) return { estado: "AGUARDANDO_ENCERRAMENTO_DA_VENDA" };
  return { estado: "DEFINIDA", inicio: encerramentoOficial, fim: somarMesesUtc(encerramentoOficial, cfg.premium.meses) };
}

/** Premium ativo para o holder ATUAL (OD-NFT-12: segue o holder) enquanto a janela não fecha. Antes do encerramento oficial, o premium já vale (a contagem só começa no encerramento). */
export function premiumAtivo(cfg: ConfigVenda, encerramentoOficial: number | null, agora: number, detemPasse: boolean): boolean {
  if (!detemPasse) return false;
  const j = janelaPremium(cfg, encerramentoOficial);
  return j.estado === "AGUARDANDO_ENCERRAMENTO_DA_VENDA" ? true : agora < j.fim;
}

/** OD-NFT-20 (APPROVED): NFT e assinaturas são produtos separados; "+30 %" é orientação de preço NÃO vinculante —
 *  nenhum cliente tem direito a um prêmio mínimo do mensal sobre o NFT, e a assinatura segue aberta a não holders. */
export function relacaoPlanoMensal(cfg: ConfigVenda): { estado: "PENDING_OWNER"; ref: "OD-NFT-20" } | { estado: "CONFIGURADO"; valor: RelacaoPlanoMensal } {
  return cfg.relacaoPlanoMensal.estado === "CONFIGURADO" ? { estado: "CONFIGURADO", valor: cfg.relacaoPlanoMensal.valor } : { estado: "PENDING_OWNER", ref: "OD-NFT-20" };
}
