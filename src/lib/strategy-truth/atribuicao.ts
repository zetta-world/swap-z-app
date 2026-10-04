/**
 * FASE B (preparo) — ESQUEMA DE ATRIBUIÇÃO DE PERDA. Só esquema + validação + uma
 * regra preliminar CONSERVADORA para teste local. Nenhum rótulo é gravado em produção:
 * `destino` só aceita "local_somente" e este módulo não tem função de escrita.
 *
 * ⚠️ O QUE A REGRA v0 NÃO FAZ, de propósito (hipóteses do plano NÃO aprovadas):
 *   · `low_confidence` só com um limiar PRÉ-REGISTRADO passado de fora (H2: 70 não é adotado);
 *   · `wrong_regime` só com uma regra de compatibilidade passada de fora (H1; DOWN⇒SELL vetado);
 *   · `bad_asset`, `late_entry`, `liquidity` exigem dado que a exportação não tem — nunca atribuídos aqui;
 *   · stop sem trajetória posterior NÃO vira `wrong_direction` nem `stop_geometry`: vira `unknown`.
 * Sem import: carregável pelo strip-types do Node 24, isolado de rede/banco.
 */

export const ROTULOS_PERDA = [
  "wrong_direction", "wrong_regime", "low_confidence", "bad_asset", "cost_over_edge",
  "stop_geometry", "time_expiry", "late_entry", "liquidity", "unknown",
] as const;
export type RotuloPerda = (typeof ROTULOS_PERDA)[number];
export const VERSAO_ATRIBUICAO = "atrib-v0-rascunho";

export interface AtribuicaoPerda {
  dataset: "paper_positions" | "celeiro_posicoes" | "bancada_operacao";
  ref: string;
  primaria: RotuloPerda;
  secundarias: RotuloPerda[];
  evidencias: Record<string, string | number | boolean | null>;
  regras_versao: string;
  confianca: "HIGH" | "MEDIUM" | "LOW";
  destino: "local_somente";
}

export interface PerdaObservada {
  dataset: AtribuicaoPerda["dataset"];
  ref: string;
  lado: "buy" | "sell";
  motivo: "target" | "stop" | "expired" | "liquidacao" | "outro";
  /** movimento de preço assinado pelo lado, % (antes de custo) */
  brutoPct: number | null;
  /** resultado líquido, % */
  liquidoPct: number;
  probabilidade?: number | null;
  regime?: string | null;
  /** Depois do stop, dentro do horizonte original: o alvo foi tocado? o preço seguiu contra? */
  trajetoria?: { alvoTocadoAposStop: boolean; seguiuContra: boolean } | null;
}

export interface ParametrosPreRegistrados {
  limiarConfianca?: number | null;
  regimeCompativel?: ((regime: string, lado: "buy" | "sell") => boolean) | null;
}

/** null = não é perda (nada a atribuir). */
export function atribuirPreliminar(p: PerdaObservada, pre: ParametrosPreRegistrados = {}): AtribuicaoPerda | null {
  if (!(p.liquidoPct < 0)) return null;
  const ev: AtribuicaoPerda["evidencias"] = { motivo: p.motivo, bruto_pct: p.brutoPct, liquido_pct: p.liquidoPct };
  let primaria: RotuloPerda = "unknown";
  let confianca: AtribuicaoPerda["confianca"] = "LOW";
  if (p.brutoPct !== null && p.brutoPct > 0) { primaria = "cost_over_edge"; confianca = "HIGH"; }
  else if (p.motivo === "expired") { primaria = "time_expiry"; confianca = "HIGH"; }
  else if (p.motivo === "stop" || p.motivo === "liquidacao") {
    if (p.trajetoria?.alvoTocadoAposStop) { primaria = "stop_geometry"; confianca = "MEDIUM"; }
    else if (p.trajetoria?.seguiuContra) { primaria = "wrong_direction"; confianca = "MEDIUM"; }
    else ev.falta = "trajetoria_pos_stop";
  }
  const secundarias: RotuloPerda[] = [];
  if (pre.limiarConfianca != null && p.probabilidade != null && p.probabilidade < pre.limiarConfianca) secundarias.push("low_confidence");
  if (pre.regimeCompativel && p.regime && !pre.regimeCompativel(p.regime, p.lado)) secundarias.push("wrong_regime");
  if (p.motivo === "expired" && primaria !== "time_expiry") secundarias.push("time_expiry");
  return { dataset: p.dataset, ref: p.ref, primaria, secundarias: secundarias.filter((s) => s !== primaria), evidencias: ev, regras_versao: VERSAO_ATRIBUICAO, confianca, destino: "local_somente" };
}

export function validarAtribuicao(a: unknown): string[] {
  const e: string[] = [];
  const x = a as Partial<AtribuicaoPerda> | null;
  if (!x || typeof x !== "object") return ["não é objeto"];
  if (!["paper_positions", "celeiro_posicoes", "bancada_operacao"].includes(String(x.dataset))) e.push("dataset inválido");
  if (typeof x.ref !== "string" || !x.ref) e.push("ref ausente");
  if (!ROTULOS_PERDA.includes(x.primaria as RotuloPerda)) e.push("primaria fora da taxonomia");
  if (!Array.isArray(x.secundarias) || x.secundarias.some((s) => !ROTULOS_PERDA.includes(s))) e.push("secundarias fora da taxonomia");
  if (Array.isArray(x.secundarias) && x.secundarias.includes(x.primaria as RotuloPerda)) e.push("secundaria repete a primária");
  if (x.destino !== "local_somente") e.push("destino diferente de local_somente (gravação em produção não autorizada)");
  if (typeof x.regras_versao !== "string" || !x.regras_versao) e.push("regras_versao ausente");
  if (!["HIGH", "MEDIUM", "LOW"].includes(String(x.confianca))) e.push("confianca inválida");
  return e;
}
