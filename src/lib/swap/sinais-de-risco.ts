/**
 * ORDEM DOS SINAIS DE RISCO — os piores primeiro, porque quem lê corta em quatro.
 *
 * ⚠️⚠️ ISTO MORA FORA DA ROTA DE PROPÓSITO. A ordenação decide qual frase o
 * usuário lê na hora de assinar um swap; uma regra dessas precisa de teste que
 * EXECUTE a função, não de um teste que leia o comparador em texto. A rota
 * `/api/risk` importa daqui.
 *
 * O QUE ESTAVA ERRADO (achado A27, 14/09 — a metade que o achado não viu):
 *
 * `token-safety.ts` faz `.slice(0, 4)` e usa `signals[0]` como MOTIVO do
 * bloqueio. O tipo dele já documentava *"os piores primeiro"* — mas a rota
 * devolvia na ordem de AVALIAÇÃO, e o sinal do Honeypot.is é o ÚLTIMO a ser
 * empurrado, depois de até dezessete do GoPlus.
 *
 * Num token que o GoPlus acha limpo e o Honeypot.is confirma como honeypot, a
 * lista começava com `Top-10 holders 12.0%` — um sinal VERDE — e o cartão
 * escrevia "Token BLOQUEADO pela verificação de segurança: Top-10 holders
 * 12.0%". Com mais de quatro sinais do GoPlus antes dele, o motivo real nem
 * chegava à tela.
 */

export interface Signal {
  kind: "ok" | "warn" | "danger";
  label: string;
  weight: number;
  /**
   * O sinal significa "o dinheiro NÃO volta": honeypot confirmado (qualquer uma
   * das duas fontes) ou venda recusada pelo contrato. Bloqueia sozinho, sem
   * depender do score.
   */
  impeditivo?: true;
}

const PESO_DO_TIPO: Record<Signal["kind"], number> = { danger: 2, warn: 1, ok: 0 };

/**
 * Impeditivo primeiro; depois perigo, aviso, ok; depois peso decrescente.
 *
 * ⚠️ `sort` é ESTÁVEL, então empate preserva a ordem de avaliação — dois
 * sinais de mesmo tipo e mesmo peso saem na ordem em que o scanner os viu, que
 * é a ordem que o explorer já mostrava.
 */
export function osPioresPrimeiro(lista: readonly Signal[]): Signal[] {
  return [...lista].sort(
    (a, b) =>
      (b.impeditivo ? 1 : 0) - (a.impeditivo ? 1 : 0) ||
      PESO_DO_TIPO[b.kind] - PESO_DO_TIPO[a.kind] ||
      b.weight - a.weight,
  );
}
