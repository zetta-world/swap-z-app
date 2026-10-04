import { FINALIDADES_RESERVA, TIERS, reservaEfetiva, type ConfigVenda, type FinalidadeReserva, type TierVenda } from "./config";
import type { CadeiaDeEvidencia } from "./evidencia";

/**
 * LIVRO DA RESERVA NÃO PAGA (OD-NFT-04 APPROVED, 04/10/2026) — PRO 30 · TRADER 10 · PILOT 0 = 40, FORA dos 2.850 pagos.
 *
 * Só dois usos: parceiro estratégico do ecossistema e recompensa/campanha de comunidade AUDITADA. Nada de equipe,
 * insider ou sorteio de Pilot. Toda emissão exige: finalidade da lista, categoria de destinatário da lista,
 * registro de aprovação por DOIS operadores autorizados distintos, referência do mint e evento de auditoria na trilha
 * encadeada. O que não for emitido continua NÃO MINTADO (não há "sobra" que vire venda ou alocação interna).
 * O mint aqui é FALSO (ensaio local); na venda real é o programa on-chain com autorização.
 */
export const CATEGORIAS_DESTINATARIO = ["PARCEIRO_ECOSSISTEMA", "MEMBRO_COMUNIDADE_CAMPANHA_AUDITADA"] as const;
export type CategoriaDestinatario = (typeof CATEGORIAS_DESTINATARIO)[number];

const CATEGORIA_POR_FINALIDADE: Record<FinalidadeReserva, CategoriaDestinatario> = {
  PARCEIRO_ESTRATEGICO_ECOSSISTEMA: "PARCEIRO_ECOSSISTEMA",
  RECOMPENSA_COMUNIDADE_AUDITADA: "MEMBRO_COMUNIDADE_CAMPANHA_AUDITADA",
};

export interface PedidoEmissaoReserva {
  tier: TierVenda;
  finalidade: string;
  categoriaDestinatario: string;
  /** Hash do destinatário (nunca endereço/nome cru na trilha). */
  destinatarioHash: string;
  aprovacao: { id: string; operadores: readonly string[]; motivo: string };
  /** Campanha auditada (obrigatória para recompensa de comunidade). */
  campanhaId?: string;
}

export type ErroReserva = "reserva_nao_configurada" | "sem_reserva_no_tier" | "reserva_esgotada" | "finalidade_fora_da_politica"
  | "categoria_fora_da_politica" | "categoria_incompativel" | "aprovacao_invalida" | "aprovacao_reutilizada" | "destinatario_invalido" | "campanha_ausente";

export interface EmissaoReserva {
  seq: number; tier: TierVenda; finalidade: FinalidadeReserva; categoria: CategoriaDestinatario;
  aprovacaoId: string; mintRef: string; eventoHash: string;
}

export class LivroDaReserva {
  private readonly emitidas: EmissaoReserva[] = [];
  private readonly aprovacoesUsadas = new Set<string>();

  constructor(private readonly cfg: ConfigVenda, private readonly evidencia: CadeiaDeEvidencia,
              private readonly operadoresAutorizados: readonly string[], private readonly mintFalso: (tier: TierVenda, seq: number) => string) {}

  limite(tier: TierVenda): number { return reservaEfetiva(this.cfg).origem === "CONFIGURADA" ? reservaEfetiva(this.cfg).porTier[tier] : 0; }

  emitir(p: PedidoEmissaoReserva): { ok: true; emissao: EmissaoReserva } | { ok: false; erro: ErroReserva } {
    if (this.cfg.reserva.estado !== "CONFIGURADO") return { ok: false, erro: "reserva_nao_configurada" };
    if (!TIERS.includes(p.tier) || this.limite(p.tier) === 0) return { ok: false, erro: "sem_reserva_no_tier" };
    if (!(FINALIDADES_RESERVA as readonly string[]).includes(p.finalidade)) return { ok: false, erro: "finalidade_fora_da_politica" };
    const fin = p.finalidade as FinalidadeReserva;
    const lote = this.cfg.reserva.valor[p.tier];
    if (!lote.some((l) => l.finalidadesPermitidas.includes(fin))) return { ok: false, erro: "finalidade_fora_da_politica" };
    if (!(CATEGORIAS_DESTINATARIO as readonly string[]).includes(p.categoriaDestinatario)) return { ok: false, erro: "categoria_fora_da_politica" };
    if (CATEGORIA_POR_FINALIDADE[fin] !== p.categoriaDestinatario) return { ok: false, erro: "categoria_incompativel" };
    if (fin === "RECOMPENSA_COMUNIDADE_AUDITADA" && !p.campanhaId?.trim()) return { ok: false, erro: "campanha_ausente" };
    if (!/^[0-9a-f]{64}$/.test(p.destinatarioHash)) return { ok: false, erro: "destinatario_invalido" };
    const ops = p.aprovacao.operadores;
    if (!p.aprovacao.id || ops.length < 2 || new Set(ops).size !== ops.length || ops.some((o) => !this.operadoresAutorizados.includes(o))
        || (p.aprovacao.motivo ?? "").trim().length < 10) return { ok: false, erro: "aprovacao_invalida" };
    if (this.aprovacoesUsadas.has(p.aprovacao.id)) return { ok: false, erro: "aprovacao_reutilizada" };
    if (this.emitidas.filter((e) => e.tier === p.tier).length >= this.limite(p.tier)) return { ok: false, erro: "reserva_esgotada" };

    const seq = this.emitidas.length + 1;
    const mintRef = this.mintFalso(p.tier, seq);
    const ev = this.evidencia.emitir("admin_audit", {
      evento: "reserva_emitida", seq, tier: p.tier, finalidade: fin, categoria: p.categoriaDestinatario,
      destinatario_hash: p.destinatarioHash, campanha: p.campanhaId ?? null,
      aprovacao: { id: p.aprovacao.id, operadores: [...ops].sort(), motivo: p.aprovacao.motivo }, mint_ref: mintRef, fora_do_supply_pago: true,
    });
    this.aprovacoesUsadas.add(p.aprovacao.id);
    const emissao: EmissaoReserva = { seq, tier: p.tier, finalidade: fin, categoria: p.categoriaDestinatario as CategoriaDestinatario, aprovacaoId: p.aprovacao.id, mintRef, eventoHash: ev.hash };
    this.emitidas.push(emissao);
    return { ok: true, emissao };
  }

  /** Divulgação: limite, emitidas e não mintadas por tier (as não mintadas continuam não mintadas). */
  resumo(): Record<TierVenda, { limite: number; emitidas: number; naoMintadas: number }> {
    const out = {} as Record<TierVenda, { limite: number; emitidas: number; naoMintadas: number }>;
    for (const t of TIERS) {
      const emitidas = this.emitidas.filter((e) => e.tier === t).length;
      out[t] = { limite: this.limite(t), emitidas, naoMintadas: this.limite(t) - emitidas };
    }
    return out;
  }

  todas(): readonly EmissaoReserva[] { return Object.freeze([...this.emitidas]); }
}
