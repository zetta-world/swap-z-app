/**
 * MÁQUINA DE ESTADOS DA VENDA FOUNDERS — pura, sem relógio, sem rede.
 *
 * Independente de decisão: os HORÁRIOS e as FASES concretas são do dono
 * (`docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md` §2). Aqui só existe a matriz
 * de transições permitidas e a regra de que pausar lembra para onde voltar.
 *
 * `NFT_REAL_SALE=OFF`: nada aqui abre venda real; não há rota que use isto.
 */
export type EstadoVenda =
  | "rascunho" | "agendada" | "allowlist_aberta" | "publica_aberta"
  | "pausada" | "esgotada" | "encerrada" | "cancelada";

export type EventoVenda =
  | "agendar" | "abrir_allowlist" | "abrir_publica" | "pausar" | "retomar"
  | "esgotar" | "encerrar" | "cancelar";

export interface Venda {
  estado: EstadoVenda;
  /** Para onde `retomar` volta. Só definido em `pausada`. */
  antesDaPausa?: "allowlist_aberta" | "publica_aberta";
}

const ABERTOS = new Set<EstadoVenda>(["allowlist_aberta", "publica_aberta"]);
const TERMINAIS = new Set<EstadoVenda>(["esgotada", "encerrada", "cancelada"]);

const MATRIZ: Record<EventoVenda, Partial<Record<EstadoVenda, EstadoVenda>>> = {
  agendar:         { rascunho: "agendada" },
  abrir_allowlist: { agendada: "allowlist_aberta" },
  abrir_publica:   { agendada: "publica_aberta", allowlist_aberta: "publica_aberta" },
  pausar:          { allowlist_aberta: "pausada", publica_aberta: "pausada" },
  retomar:         {},
  esgotar:         { allowlist_aberta: "esgotada", publica_aberta: "esgotada", pausada: "esgotada" },
  encerrar:        { allowlist_aberta: "encerrada", publica_aberta: "encerrada", pausada: "encerrada" },
  cancelar:        { rascunho: "cancelada", agendada: "cancelada", pausada: "cancelada" },
};

export type ResultadoTransicao =
  | { ok: true; venda: Venda }
  | { ok: false; erro: "transicao_proibida" | "estado_terminal" };

export function transicionar(v: Venda, e: EventoVenda): ResultadoTransicao {
  if (TERMINAIS.has(v.estado)) return { ok: false, erro: "estado_terminal" };
  if (e === "retomar") {
    return v.estado === "pausada" && v.antesDaPausa
      ? { ok: true, venda: { estado: v.antesDaPausa } }
      : { ok: false, erro: "transicao_proibida" };
  }
  const para = MATRIZ[e][v.estado];
  if (!para) return { ok: false, erro: "transicao_proibida" };
  if (e === "pausar") return { ok: true, venda: { estado: para, antesDaPausa: v.estado as "allowlist_aberta" | "publica_aberta" } };
  return { ok: true, venda: { estado: para } };
}

/** Só estes estados aceitam reserva. Pausada, esgotada e qualquer outro: não. */
export function aceitaReserva(v: Venda): boolean {
  return ABERTOS.has(v.estado);
}

/** Em `allowlist_aberta`, só quem está na allowlist; em `publica_aberta`, qualquer um. */
export function exigeAllowlist(v: Venda): boolean {
  return v.estado === "allowlist_aberta";
}
