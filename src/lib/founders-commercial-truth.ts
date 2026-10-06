/**
 * Verdade comercial canônica e independente da infraestrutura da venda.
 *
 * Só AVAILABLE_AT_LAUNCH pode ser apresentado como disponível. A separação
 * deste módulo preserva o isolamento de `founders-sale`: pricing, ZION e a
 * preview consomem o mesmo dado, sem importar o painel/motor da venda.
 */
export type FoundersCommercialTier = "PRO" | "TRADER" | "PILOT";

export const TAXA_SWAP_BPS: Record<FoundersCommercialTier | "FREE", number> = {
  FREE: 100,
  PRO: 50,
  TRADER: 25,
  PILOT: 10,
};

export const ESTADOS_BENEFICIO = [
  "AVAILABLE_AT_LAUNCH",
  "IMPLEMENTED_DISABLED",
  "COMING_SOON_ROADMAP",
  "NOT_PART_OF_THE_OFFER",
  "A_CONFIRMAR",
] as const;
export type EstadoBeneficio = (typeof ESTADOS_BENEFICIO)[number];
export type GrupoBeneficio = "A_DISPONIVEL" | "B_ROADMAP" | "C_EXCLUIDO";

export interface Beneficio {
  id: string;
  estado: EstadoBeneficio;
  /** Compatibilidade de domínio. Não usar para decidir disponibilidade. */
  grupo: GrupoBeneficio;
  tiers: readonly FoundersCommercialTier[];
  duracao: "PREMIUM_36_MESES" | "PERMANENTE_COM_O_PASSE";
}

const beneficio = (
  id: string,
  estado: EstadoBeneficio,
  tiers: readonly FoundersCommercialTier[],
  duracao: Beneficio["duracao"],
): Beneficio => ({
  id,
  estado,
  grupo: estado === "AVAILABLE_AT_LAUNCH" ? "A_DISPONIVEL"
    : estado === "NOT_PART_OF_THE_OFFER" ? "C_EXCLUIDO"
      : "B_ROADMAP",
  tiers,
  duracao,
});

const TODOS: readonly FoundersCommercialTier[] = ["PRO", "TRADER", "PILOT"];
export const BENEFICIOS: readonly Beneficio[] = [
  beneficio("zion_advisory", "AVAILABLE_AT_LAUNCH", TODOS, "PREMIUM_36_MESES"),
  beneficio("cex_autopilot", "IMPLEMENTED_DISABLED", TODOS, "PREMIUM_36_MESES"),
  beneficio("arb_scanner", "A_CONFIRMAR", ["TRADER", "PILOT"], "PREMIUM_36_MESES"),
  beneficio("priority_support", "AVAILABLE_AT_LAUNCH", ["TRADER", "PILOT"], "PREMIUM_36_MESES"),
  beneficio("reduced_swap_fee", "AVAILABLE_AT_LAUNCH", TODOS, "PREMIUM_36_MESES"),
  beneficio("pilot_advanced_automation", "COMING_SOON_ROADMAP", ["PILOT"], "PREMIUM_36_MESES"),
  beneficio("founder_badge_onchain", "AVAILABLE_AT_LAUNCH", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("founder_theme", "COMING_SOON_ROADMAP", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("hall_of_fame_opt_in", "COMING_SOON_ROADMAP", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("early_access_priority", "COMING_SOON_ROADMAP", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("product_polls", "COMING_SOON_ROADMAP", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("beta_access", "COMING_SOON_ROADMAP", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("elevated_api_limits", "COMING_SOON_ROADMAP", TODOS, "PERMANENTE_COM_O_PASSE"),
  beneficio("royalty_distribution_to_holders", "NOT_PART_OF_THE_OFFER", [], "PERMANENTE_COM_O_PASSE"),
  beneficio("future_token_allocation", "NOT_PART_OF_THE_OFFER", [], "PERMANENTE_COM_O_PASSE"),
  beneficio("guaranteed_future_allowlist", "NOT_PART_OF_THE_OFFER", [], "PERMANENTE_COM_O_PASSE"),
  beneficio("treasury_governance", "NOT_PART_OF_THE_OFFER", [], "PERMANENTE_COM_O_PASSE"),
];

export const beneficioPodeSerVendidoComoDisponivel = (estado: EstadoBeneficio): boolean => estado === "AVAILABLE_AT_LAUNCH";
export const beneficiosPublicaveis = (tier: FoundersCommercialTier) => BENEFICIOS.filter((b) => b.estado !== "NOT_PART_OF_THE_OFFER" && b.tiers.includes(tier));
export const beneficiosPorEstado = (tier: FoundersCommercialTier, estado: EstadoBeneficio) => beneficiosPublicaveis(tier).filter((b) => b.estado === estado);
export const beneficiosDisponiveisNoLancamento = (tier: FoundersCommercialTier) => beneficiosPorEstado(tier, "AVAILABLE_AT_LAUNCH");

export const POLITICA_SUPORTE_PRIORITARIO = {
  comecaNoTier: "TRADER" as const,
  canal: "FILA_ASSINCRONA_PRIORITARIA" as const,
  slaRigido: false,
  humano24x7: false,
  concierge: false,
  obrigacaoPessoalDoCeo: false,
};

export const OFERTA_PADRAO_PILOT = {
  backtestsPorJanela: 5_000,
  janelaHoras: 24,
  tipo: "ESTRATEGIA_PROPRIA" as const,
  ativosMax: 3,
  historicoDiasMax: 365,
  candle: "4h" as const,
  cargasMaioresConsomemProporcionalmente: true,
  modoMesaIncluidoNaMesmaDefinicao: false,
  budgetFraction: "1/16" as const,
};
