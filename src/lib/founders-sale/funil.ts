import { validarEvento, type EventoTelemetria } from "./telemetria";

/**
 * FUNIL LOCAL DA VENDA FOUNDERS — derivado só da telemetria sem PII (sessão = hash).
 *
 * DISCOVERY → LANDING → VALUE_UNDERSTANDING → WHITELIST_APPLICATION → QUALIFICATION → WALLET_READY →
 * SALE_READY → PURCHASE → HOLDER_ONBOARDING
 *
 * Uma sessão conta numa etapa quando o evento DA etapa aconteceu (não por inferência de etapa posterior).
 * Eventos que não passam no esquema são descartados e contados — nunca entram no funil.
 * Nenhum número de comprador é fabricado: tudo vem dos eventos recebidos.
 */
export const ETAPAS_FUNIL = [
  "DISCOVERY", "LANDING", "VALUE_UNDERSTANDING", "WHITELIST_APPLICATION", "QUALIFICATION",
  "WALLET_READY", "SALE_READY", "PURCHASE", "HOLDER_ONBOARDING",
] as const;
export type EtapaFunil = (typeof ETAPAS_FUNIL)[number];

function etapaDoEvento(e: EventoTelemetria): EtapaFunil | null {
  switch (e.nome) {
    case "founders_page_view": return typeof e.origem === "string" && e.origem !== "direto" ? "DISCOVERY" : "LANDING";
    case "tier_view": return "VALUE_UNDERSTANDING";
    case "whitelist_start": case "whitelist_complete": return "WHITELIST_APPLICATION";
    case "email_verified": case "tier_preference_selected": return "QUALIFICATION";
    case "wallet_signed": return "WALLET_READY";
    case "wallet_connected": return e.rede_ok === true ? "WALLET_READY" : null;
    case "eligibility_checked": return e.resultado === "eligible" ? "SALE_READY" : null;
    case "tx_confirmed": return "PURCHASE";
    case "post_purchase_onboarding": return "HOLDER_ONBOARDING";
    default: return null;
  }
}

export interface RelatorioFunil {
  sessoesPorEtapa: Record<EtapaFunil, number>;
  conversaoDaEtapaAnteriorPct: Record<EtapaFunil, number | null>;
  eventosDescartados: number;
}

export function funil(eventos: readonly unknown[]): RelatorioFunil {
  const porEtapa = Object.fromEntries(ETAPAS_FUNIL.map((e) => [e, new Set<string>()])) as Record<EtapaFunil, Set<string>>;
  let descartados = 0;
  for (const bruto of eventos) {
    const v = validarEvento(bruto);
    if (!v.ok || typeof v.evento.sessao !== "string") { descartados++; continue; }
    const etapa = etapaDoEvento(v.evento);
    if (etapa) {
      porEtapa[etapa].add(v.evento.sessao);
      if (etapa === "DISCOVERY") porEtapa.LANDING.add(v.evento.sessao); // quem chega por uma origem também viu a landing
    }
  }
  const sessoesPorEtapa = {} as Record<EtapaFunil, number>;
  const conv = {} as Record<EtapaFunil, number | null>;
  ETAPAS_FUNIL.forEach((e, i) => {
    sessoesPorEtapa[e] = porEtapa[e].size;
    const anterior = i === 0 ? null : porEtapa[ETAPAS_FUNIL[i - 1]].size;
    conv[e] = anterior === null || anterior === 0 ? null : Math.round((porEtapa[e].size / anterior) * 10_000) / 100;
  });
  return { sessoesPorEtapa, conversaoDaEtapaAnteriorPct: conv, eventosDescartados: descartados };
}
