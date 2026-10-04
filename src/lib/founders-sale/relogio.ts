/**
 * RELÓGIO DA VENDA — autoridade do SERVIDOR, avanço por fonte MONOTÔNICA.
 *
 * O relógio de parede do navegador pode estar errado (ou ser mudado de
 * propósito para "abrir antes"). Aqui o tempo é: instante do servidor no
 * momento da sincronização + quanto o relógio MONOTÔNICO andou desde então
 * (`performance.now()` no navegador, injetado nos testes). `Date.now()` do
 * cliente não entra em conta nenhuma.
 *
 * Os horários das fases são decisão do dono (não há default aqui): chegam
 * como `JanelaVenda` vinda de configuração/servidor.
 */
export interface Sincronizacao {
  /** Instante do servidor (ms epoch) informado pela resposta autoritativa. */
  servidorMs: number;
  /** Leitura do relógio monotônico local no momento em que a resposta chegou. */
  monotonicoMs: number;
}

export type Monotonico = () => number;

export class RelogioDaVenda {
  private sync: Sincronizacao | null = null;
  constructor(private readonly monotonico: Monotonico) {}

  sincronizar(servidorMs: number): void {
    if (!Number.isFinite(servidorMs) || servidorMs <= 0) throw new Error("instante_invalido");
    this.sync = { servidorMs, monotonicoMs: this.monotonico() };
  }

  /** `null` enquanto não houve sincronização com o servidor: a UI não inventa hora. */
  agora(): number | null {
    if (!this.sync) return null;
    const passou = this.monotonico() - this.sync.monotonicoMs;
    return this.sync.servidorMs + Math.max(0, passou);
  }
}

export interface JanelaVenda {
  inicioMs: number | null;
  fimMs:    number | null;
}

export type Contagem =
  | { tipo: "sem_hora" }                       // sem sincronização ou sem horário definido
  | { tipo: "antes"; restanteMs: number; d: number; h: number; m: number; s: number }
  | { tipo: "durante"; restanteMs: number | null }
  | { tipo: "depois" };

export function contagem(janela: JanelaVenda, agoraMs: number | null): Contagem {
  if (agoraMs === null || janela.inicioMs === null) return { tipo: "sem_hora" };
  if (janela.fimMs !== null && janela.fimMs <= janela.inicioMs) return { tipo: "sem_hora" };
  if (agoraMs < janela.inicioMs) {
    const restanteMs = janela.inicioMs - agoraMs;
    const t = Math.ceil(restanteMs / 1000);
    return { tipo: "antes", restanteMs, d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
  }
  if (janela.fimMs !== null && agoraMs >= janela.fimMs) return { tipo: "depois" };
  return { tipo: "durante", restanteMs: janela.fimMs === null ? null : janela.fimMs - agoraMs };
}
