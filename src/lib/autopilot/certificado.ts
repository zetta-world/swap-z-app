/**
 * O CERTIFICADO DA ESTRATÉGIA — achado A110.
 *
 * ⚠️⚠️ AUTORIZAR UMA CARTEIRA NÃO É AUTORIZAR UMA ESTRATÉGIA. São perguntas
 * diferentes e o sistema só sabia responder a primeira:
 *
 *     "o usuário está autorizado"   ≠   "esta estratégia pode operar"
 *
 * Um intent autônomo precisa dizer QUAL estratégia, em QUAL versão, e apontar
 * para a evidência que qualificou aquela versão. Sem isso, "o robô comprou" é
 * frase sem sujeito — e revogar uma estratégia ruim não tem onde pegar.
 *
 * ⚠️ O CERTIFICADO É SOBRE A VERSÃO. Mudar um parâmetro cria outra hipótese, e
 * a evidência da anterior não vale para ela. `strategy_hash` amarra o
 * certificado ao conteúdo exato dos parâmetros: mudança silenciosa deixa de
 * casar, e o veredito é recusa — nunca "provavelmente é a mesma coisa".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export interface LimitesDoCertificado {
  maxTradeUsd?: number | null;
  maxExposureUsd?: number | null;
  dailyLossStopUsd?: number | null;
  maxTradesPerDay?: number | null;
}

export interface CertificadoRow {
  id: string;
  strategy_id: string;
  strategy_version: number;
  strategy_hash: string;
  certificate_version: number;
  evidence: Record<string, unknown>;
  sample_size: number | null;
  cost_assumptions: Record<string, unknown> | null;
  risk_limits: LimitesDoCertificado;
  allowed_venues: string[];
  allowed_symbols: string[];
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export type MotivoDaRecusaDoCertificado =
  | "sem_certificado"
  | "revogado"
  | "fora_da_validade"
  | "hash_nao_confere"
  | "venue_nao_permitida"
  | "simbolo_nao_permitido"
  | "acima_do_teto_do_certificado";

export type VereditoDoCertificado =
  | { vale: true; certificadoId: string; limites: LimitesDoCertificado }
  | { vale: false; motivo: MotivoDaRecusaDoCertificado; porque: string };

export interface PedidoParaCertificar {
  venue: string;
  symbol: string;
  notionalUsd: number | null;
  /** O hash dos parâmetros COM QUE a estratégia vai rodar agora. */
  strategyHash?: string | null;
}

/**
 * O certificado cobre ESTE pedido, AGORA?
 *
 * ⚠️ FUNÇÃO PURA DE PROPÓSITO. É a decisão que separa "dinheiro pode se mover"
 * de "não pode"; ela precisa ser exercitável sem banco e sem rede.
 *
 * ⚠️ E TODA AUSÊNCIA É RECUSA. Sem certificado, revogado, fora da janela, hash
 * diferente, venue não listada, símbolo não listado: recusa. Não existe
 * "provavelmente está tudo bem" neste arquivo.
 */
export function avaliarCertificado(
  cert: CertificadoRow | null | undefined,
  pedido: PedidoParaCertificar,
  agora: Date = new Date(),
): VereditoDoCertificado {
  if (!cert) {
    return { vale: false, motivo: "sem_certificado",
      porque: "nenhum certificado vivo para esta estrategia/versao" };
  }
  if (cert.revoked_at) {
    /**
     * ⚠️⚠️ INVARIANTE 14. Revogar impede intent NOVO imediatamente. Não mata
     * ordem viva — isso é reconciliação, não revogação — mas fecha a torneira.
     */
    return { vale: false, motivo: "revogado",
      porque: `revogado em ${cert.revoked_at}: ${cert.revoked_reason ?? "sem motivo"}` };
  }
  const t = agora.getTime();
  if (t < new Date(cert.valid_from).getTime()) {
    return { vale: false, motivo: "fora_da_validade", porque: "ainda nao vigente" };
  }
  if (cert.valid_until && t > new Date(cert.valid_until).getTime()) {
    return { vale: false, motivo: "fora_da_validade",
      porque: `expirou em ${cert.valid_until}` };
  }
  if (pedido.strategyHash && pedido.strategyHash !== cert.strategy_hash) {
    return { vale: false, motivo: "hash_nao_confere",
      porque: "os parametros mudaram desde a certificacao — a evidencia e de outra hipotese" };
  }
  if (!cert.allowed_venues.includes(pedido.venue)) {
    return { vale: false, motivo: "venue_nao_permitida",
      porque: `${pedido.venue} nao esta entre ${cert.allowed_venues.join(", ") || "(nenhuma)"}` };
  }
  if (!cert.allowed_symbols.includes(pedido.symbol)) {
    return { vale: false, motivo: "simbolo_nao_permitido",
      porque: `${pedido.symbol} nao esta entre ${cert.allowed_symbols.join(", ") || "(nenhum)"}` };
  }
  /**
   * ⚠️ O TETO DO CERTIFICADO É O ENVELOPE DA EVIDÊNCIA. A sessão diz quanto o
   * USUÁRIO aceita arriscar; o certificado diz dentro de que tamanho a
   * estratégia foi medida. Operar acima é usar a evidência para outra coisa.
   *
   * ⚠️ NOCIONAL DESCONHECIDO NÃO PASSA. `null` aqui é "não medimos", e não
   * medimos nunca pode virar "cabe no teto".
   */
  const teto = cert.risk_limits?.maxTradeUsd;
  if (teto != null && Number.isFinite(teto)) {
    if (pedido.notionalUsd == null || !Number.isFinite(pedido.notionalUsd)) {
      return { vale: false, motivo: "acima_do_teto_do_certificado",
        porque: "nocional desconhecido e o certificado tem teto — sem medida nao passa" };
    }
    if (pedido.notionalUsd > Number(teto)) {
      return { vale: false, motivo: "acima_do_teto_do_certificado",
        porque: `nocional ${pedido.notionalUsd} acima do teto certificado ${teto}` };
    }
  }
  return { vale: true, certificadoId: cert.id, limites: cert.risk_limits ?? {} };
}

/**
 * O certificado VIVO de uma estratégia/versão.
 *
 * ⚠️ `undefined` é falha de leitura, `null` é "não há". Quem confunde os dois
 * libera dinheiro quando o banco cai — e o executor trata ambos como recusa,
 * que é a direção certa para esta pergunta.
 */
export async function certificadoVivo(
  db: SupabaseClient<Database>, strategyId: string, versao: number,
): Promise<CertificadoRow | null | undefined> {
  const { data, error } = await db.from("strategy_certificates")
    .select("*")
    .eq("strategy_id", strategyId)
    .eq("strategy_version", versao)
    .is("revoked_at", null)
    .limit(1);
  if (error) return undefined;
  return ((data ?? [])[0] as CertificadoRow | undefined) ?? null;
}
