/**
 * "SÓ A ÚLTIMA REQUISIÇÃO ESCREVE" — para leituras disparadas por clique.
 *
 * ⚠️ F-07 da auditoria adversarial: no painel, abrir a inscrição A e logo
 * depois a B disparava duas leituras de eventos; se a de A chegasse por
 * último, a trilha de audit de A aparecia sob B. Cada `nova()` cancela a
 * anterior (AbortController) e devolve o sinal da atual; quem recebe a
 * resposta confere `signal.aborted` antes de escrever estado. `cancelar()`
 * serve para fechar a linha e para desmontar o componente.
 *
 * Puro e sem import de servidor: o painel (cliente) usa, e o teste exercita o
 * comportamento sem DOM.
 */
export class UltimaRequisicao {
  private atual: AbortController | null = null;

  /** Cancela a anterior e começa uma nova. */
  nova(): AbortSignal {
    this.atual?.abort();
    this.atual = new AbortController();
    return this.atual.signal;
  }

  /** Cancela a corrente (fechar seleção, desmontar). */
  cancelar(): void {
    this.atual?.abort();
    this.atual = null;
  }
}
