import type { ConfigVenda, RelacaoPlanoMensal } from "./config";

export {
  BENEFICIOS,
  ESTADOS_BENEFICIO,
  OFERTA_PADRAO_PILOT,
  POLITICA_SUPORTE_PRIORITARIO,
  TAXA_SWAP_BPS,
  beneficioPodeSerVendidoComoDisponivel,
  beneficiosDisponiveisNoLancamento,
  beneficiosPorEstado,
  beneficiosPublicaveis,
} from "../founders-commercial-truth";
export type {
  Beneficio,
  EstadoBeneficio,
  FoundersCommercialTier,
  GrupoBeneficio,
} from "../founders-commercial-truth";

/**
 * VERDADE COMERCIAL DO PASSE — só o que a plataforma sustenta.
 *
 * Cada item tem um estado explícito. Só AVAILABLE_AT_LAUNCH pode ser vendido
 * como disponível. IMPLEMENTED_DISABLED, COMING_SOON_ROADMAP e A_CONFIRMAR
 * podem ser explicados ao cliente, mas nunca promovidos a benefício atual.
 *
 * Janela premium (OD-NFT-14): 36 meses CORRIDOS a partir do encerramento OFICIAL da venda. Sem gatilho por versão.
 * Relação com o plano mensal (OD-NFT-20): PENDENTE — este módulo não calcula "+30%".
 *
 * Taxas: espelho de `src/lib/tier/fees.ts` (`TIER_FEE_BPS`); um teste garante que não divergem.
 */
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
