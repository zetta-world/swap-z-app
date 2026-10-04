import { transicionar, estadoPublico, type Venda, type EventoVenda, type EstadoPublico } from "./maquina";
import type { ConfigVenda } from "./config";

/**
 * ESTADO AUTORITATIVO DA VENDA — o "servidor". A UI e a contagem são PROJEÇÕES dele.
 *
 *   · relógio = o do servidor, injetado; o relógio do navegador nunca entra aqui;
 *   · toda transição leva `versaoEsperada` (concorrência otimista): replay ou corrida com a mesma versão
 *     perde com `versao_desatualizada` — no máximo UMA transição por versão;
 *   · mutações serializadas numa fila única;
 *   · horários da configuração são porteiros: abrir antes da hora = `cedo_demais`; sem horário configurado
 *     (OD-NFT-08: nenhuma data ainda) = `sem_horario` — a venda NÃO abre por padrão;
 *   · `tick()` aplica só o que o relógio manda: allowlist → pública na hora; encerra na data final
 *     (inclusive em pausa).
 */
export interface EstadoAutoritativo {
  venda: Venda;
  versao: number;
  publico: EstadoPublico;
  snapshotId: string | null;
  atualizadoEm: number;
}

export type ErroAutoridade =
  | "versao_desatualizada" | "transicao_proibida" | "estado_terminal" | "cedo_demais" | "sem_horario"
  | "snapshot_necessario" | "armazenamento_indisponivel";

export type ResultadoAutoridade = { ok: true; estado: EstadoAutoritativo } | { ok: false; erro: ErroAutoridade; estado: EstadoAutoritativo };

/** Armazenamento do estado: em memória por padrão; injetável para caos ("banco fora"). */
export interface ArmazemEstado {
  ler(): EstadoAutoritativo;
  gravar(e: EstadoAutoritativo): void;
}

export class ArmazemEmMemoria implements ArmazemEstado {
  constructor(private e: EstadoAutoritativo) {}
  ler() { return this.e; }
  gravar(e: EstadoAutoritativo) { this.e = e; }
}

export function estadoInicial(agora: number): EstadoAutoritativo {
  const venda: Venda = { estado: "rascunho" };
  return { venda, versao: 0, publico: estadoPublico(venda), snapshotId: null, atualizadoEm: agora };
}

export class VendaAutoritativa {
  private fila: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly cfg: ConfigVenda,
    private readonly agora: () => number,
    private readonly armazem: ArmazemEstado = new ArmazemEmMemoria(estadoInicial(0)),
    private readonly aoMudar?: (de: EstadoAutoritativo, para: EstadoAutoritativo, evento: EventoVenda, origem: string) => void,
  ) {}

  private emFila<T>(fn: () => T): Promise<T> {
    const p = this.fila.then(fn, fn);
    this.fila = p.catch(() => undefined);
    return p;
  }

  ler(): EstadoAutoritativo { return this.armazem.ler(); }

  private porteiroDeHorario(evento: EventoVenda): ErroAutoridade | null {
    const h = this.cfg.horarios, t = this.agora();
    const exigir = (marco: number | null): ErroAutoridade | null => (marco === null ? "sem_horario" : t < marco ? "cedo_demais" : null);
    switch (evento) {
      case "abrir_inscricao":    return exigir(h.inscricaoAbre);
      case "congelar_allowlist": return exigir(h.inscricaoFecha);
      case "abrir_allowlist":    return exigir(h.allowlistAbre);
      case "abrir_publica":      return exigir(h.publicaAbre);
      default:                   return null;
    }
  }

  private aplicar(atual: EstadoAutoritativo, evento: EventoVenda, extra: { snapshotId?: string }, origem: string): ResultadoAutoridade {
    const r = transicionar(atual.venda, evento);
    if (!r.ok) return { ok: false, erro: r.erro, estado: atual };
    const novo: EstadoAutoritativo = {
      venda: r.venda, versao: atual.versao + 1, publico: estadoPublico(r.venda),
      snapshotId: evento === "congelar_allowlist" ? (extra.snapshotId ?? null) : atual.snapshotId,
      atualizadoEm: this.agora(),
    };
    try { this.armazem.gravar(novo); }
    catch { return { ok: false, erro: "armazenamento_indisponivel", estado: atual }; }
    this.aoMudar?.(atual, novo, evento, origem);
    return { ok: true, estado: novo };
  }

  transicionar(evento: EventoVenda, opcoes: { versaoEsperada: number; snapshotId?: string; origem?: string }): Promise<ResultadoAutoridade> {
    return this.emFila(() => {
      let atual: EstadoAutoritativo;
      try { atual = this.armazem.ler(); }
      catch { return { ok: false as const, erro: "armazenamento_indisponivel" as const, estado: estadoInicial(this.agora()) }; }
      if (opcoes.versaoEsperada !== atual.versao) return { ok: false as const, erro: "versao_desatualizada" as const, estado: atual };
      const barrado = this.porteiroDeHorario(evento);
      if (barrado) return { ok: false as const, erro: barrado, estado: atual };
      if (evento === "congelar_allowlist" && !opcoes.snapshotId) return { ok: false as const, erro: "snapshot_necessario" as const, estado: atual };
      if (evento === "abrir_allowlist" && !atual.snapshotId) return { ok: false as const, erro: "snapshot_necessario" as const, estado: atual };
      return this.aplicar(atual, evento, { snapshotId: opcoes.snapshotId }, opcoes.origem ?? "admin");
    });
  }

  /** Transições comandadas pelo relógio do servidor. Idempotente: chamar duas vezes não avança duas vezes. */
  tick(): Promise<EstadoAutoritativo> {
    return this.emFila(() => {
      const atual = this.armazem.ler();
      const h = this.cfg.horarios, t = this.agora(), s = atual.venda.estado;
      if (h.vendaFecha !== null && t >= h.vendaFecha && (s === "allowlist_aberta" || s === "publica_aberta" || s === "pausada")) {
        const r = this.aplicar(atual, "encerrar", {}, "relogio");
        return r.estado;
      }
      if (s === "allowlist_aberta" && h.publicaAbre !== null && t >= h.publicaAbre) return this.aplicar(atual, "abrir_publica", {}, "relogio").estado;
      return atual;
    });
  }

  /** O estoque informa: nada disponível e nada reservado em aberto = esgotado (chamado pelo serviço de venda). */
  esgotar(): Promise<ResultadoAutoridade> {
    return this.emFila(() => this.aplicar(this.armazem.ler(), "esgotar", {}, "estoque"));
  }
}
