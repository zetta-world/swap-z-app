/**
 * MÁQUINA DE ESTADOS DA VENDA FOUNDERS — pura, sem relógio, sem rede.
 *
 * Fluxo aprovado (OD-NFT-07, 04/10/2026), um passo por vez, sem atalho:
 *   rascunho (COMING_SOON) → inscricao_aberta (APPLICATION_OPEN) → allowlist_congelada (ALLOWLIST_FROZEN)
 *   → allowlist_aberta (ALLOWLIST_SALE) → publica_aberta (PUBLIC_SALE) → esgotada (SOLD_OUT) / encerrada (ENDED)
 * `pausada` (PAUSED) só a partir de um estado de VENDA ativa e lembra para onde voltar.
 * `cancelada` só antes da venda abrir ou em pausa; na UI pública vira ENDED.
 *
 * Os HORÁRIOS não moram aqui (`autoridade.ts` aplica relógio do servidor e versão). Esta matriz é a única
 * fonte das transições permitidas. `NFT_REAL_SALE=OFF`: nada aqui fala com chain.
 */
export type EstadoVenda =
  | "rascunho" | "inscricao_aberta" | "allowlist_congelada" | "allowlist_aberta" | "publica_aberta"
  | "pausada" | "esgotada" | "encerrada" | "cancelada";

export type EventoVenda =
  | "abrir_inscricao" | "congelar_allowlist" | "abrir_allowlist" | "abrir_publica"
  | "pausar" | "retomar" | "esgotar" | "encerrar" | "cancelar";

export interface Venda {
  estado: EstadoVenda;
  /** Para onde `retomar` volta. Só definido em `pausada`. */
  antesDaPausa?: "allowlist_aberta" | "publica_aberta";
}

export const ESTADOS_PUBLICOS = [
  "COMING_SOON", "APPLICATION_OPEN", "ALLOWLIST_FROZEN", "ALLOWLIST_SALE", "PUBLIC_SALE",
  "PAUSED", "SOLD_OUT", "ENDED",
] as const;
export type EstadoPublico = (typeof ESTADOS_PUBLICOS)[number];

const PUBLICO: Record<EstadoVenda, EstadoPublico> = {
  rascunho: "COMING_SOON", inscricao_aberta: "APPLICATION_OPEN", allowlist_congelada: "ALLOWLIST_FROZEN",
  allowlist_aberta: "ALLOWLIST_SALE", publica_aberta: "PUBLIC_SALE", pausada: "PAUSED",
  esgotada: "SOLD_OUT", encerrada: "ENDED", cancelada: "ENDED",
};
export const estadoPublico = (v: Venda): EstadoPublico => PUBLICO[v.estado];

const ABERTOS = new Set<EstadoVenda>(["allowlist_aberta", "publica_aberta"]);
const TERMINAIS = new Set<EstadoVenda>(["esgotada", "encerrada", "cancelada"]);

const MATRIZ: Record<EventoVenda, Partial<Record<EstadoVenda, EstadoVenda>>> = {
  abrir_inscricao:    { rascunho: "inscricao_aberta" },
  congelar_allowlist: { inscricao_aberta: "allowlist_congelada" },
  abrir_allowlist:    { allowlist_congelada: "allowlist_aberta" },
  abrir_publica:      { allowlist_aberta: "publica_aberta" },
  pausar:             { allowlist_aberta: "pausada", publica_aberta: "pausada" },
  retomar:            {},
  esgotar:            { allowlist_aberta: "esgotada", publica_aberta: "esgotada", pausada: "esgotada" },
  encerrar:           { allowlist_aberta: "encerrada", publica_aberta: "encerrada", pausada: "encerrada" },
  cancelar:           { rascunho: "cancelada", inscricao_aberta: "cancelada", allowlist_congelada: "cancelada", pausada: "cancelada" },
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

/** Em `allowlist_aberta`, só quem está no snapshot congelado; em `publica_aberta`, qualquer carteira elegível. */
export function exigeAllowlist(v: Venda): boolean {
  return v.estado === "allowlist_aberta";
}

export const ehTerminal = (v: Venda): boolean => TERMINAIS.has(v.estado);
