/**
 * Operação do ZION → chave em `FEATURE_TIER`.
 *
 * Módulo PURO e compartilhado de propósito: a rota (servidor) e a gaveta do
 * ZION (cliente) leem daqui. Foi a lição das três vezes em que a lista de gates
 * do flywheel estava escrita em dois lugares e divergiu — ver
 * `src/lib/admin/gate-keys.ts`.
 *
 * POR QUE ISTO EXISTE (auditoria 01/08):
 *
 * `arbScanner: "trader"` estava declarado em `FEATURE_TIER` desde sempre e não
 * correspondia a NENHUMA superfície do código — entrada morta. Enquanto isso o
 * card do plano Trader vende "Cross-CEX arbitrage feed", e o feed entrava pelo
 * `op=arbitrage` do ZION, sob a regra genérica do ZION: qualquer plano com
 * acesso ao ZION levava junto o que era vendido como exclusivo do Trader.
 *
 * Vender um recurso como exclusivo de um plano e entregá-lo em todos é o mesmo
 * defeito da cota que não contava — só que na direção da receita.
 *
 * Só quem aparece aqui tem exigência PRÓPRIA. O resto cai em `zionAdvisory`.
 */
import type { ZionOp } from "@/lib/zion/mode-prompts";

export const OP_FEATURE: Partial<Record<ZionOp, string>> = {
  arbitrage: "arbScanner",   // vendido no card do plano Trader
};

/** Chave de feature efetiva de uma operação. */
export function featureForOp(op: ZionOp): string {
  return OP_FEATURE[op] ?? "zionAdvisory";
}
