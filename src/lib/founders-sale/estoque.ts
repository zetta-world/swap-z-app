import { LivroDeReservas, type OpcoesLivro, type ResultadoReserva } from "./alocacao";
import { TIERS, reservaEfetiva, type ConfigVenda, type TierVenda } from "./config";

/**
 * ESTOQUE DA VENDA POR TIER — um `LivroDeReservas` por tier (supply PAGO), sem duplicar a lógica de reserva.
 *
 * Campos do supply (nunca inventados):
 *   paid_supply     = `supplyPago` aprovado;
 *   reserved_supply = reserva FORA da venda (OD-NFT-04 pendente → 0 rotulado `UNCONFIGURED_SIMULATION_ZERO`);
 *   minted          = reservas confirmadas;
 *   reserved        = reservas ativas (ainda não confirmadas);
 *   available       = paid_supply − minted − reserved.
 * Invariante provada em teste (500 pedidos concorrentes): minted + reserved + available = paid_supply e
 * minted + reserved ≤ paid_supply — OVERSOLD = 0.
 *
 * Tetos por carteira: cumulativos entre as fases; allowlist 1/1/1 e evento inteiro 2/2/1.
 * A pública recebe todo o supply pago remanescente de cada tier, inclusive Pilot.
 */
export type FaseVenda = "allowlist" | "publica";

export interface ResumoTier { paid_supply: number; reserved_supply: number; minted: number; reserved: number; available: number }
export interface ResumoEstoque {
  porTier: Record<TierVenda, ResumoTier>;
  total: ResumoTier;
  origemReserva: "CONFIGURADA" | "UNCONFIGURED_SIMULATION_ZERO";
  esgotado: boolean;
}

export type ResultadoEstoque = ResultadoReserva | { ok: false; erro: "tier_invalido" | "tier_fora_da_fase" };

export class EstoqueDaVenda {
  private readonly livros: Record<TierVenda, LivroDeReservas>;
  constructor(private readonly cfg: ConfigVenda, agora: () => number, validadeMs: number, opcoes: OpcoesLivro = {}) {
    const max = (t: TierVenda) => Math.max(cfg.tetos.allowlist[t], cfg.tetos.publica[t]);
    this.livros = {
      PRO: new LivroDeReservas({ supply: cfg.supplyPago.PRO, maxPorCarteira: max("PRO"), validadeMs }, agora, opcoes),
      TRADER: new LivroDeReservas({ supply: cfg.supplyPago.TRADER, maxPorCarteira: max("TRADER"), validadeMs }, agora, opcoes),
      PILOT: new LivroDeReservas({ supply: cfg.supplyPago.PILOT, maxPorCarteira: max("PILOT"), validadeMs }, agora, opcoes),
    };
  }

  private ehTier(t: string): t is TierVenda { return (TIERS as readonly string[]).includes(t); }

  tetoDaFase(tier: TierVenda, fase: FaseVenda): number {
    return fase === "allowlist" ? this.cfg.tetos.allowlist[tier] : this.cfg.tetos.publica[tier];
  }

  reservar(p: { tier: string; carteira: string; unidades: number; chave: string; fase: FaseVenda; vendaAberta: boolean; elegivel: boolean; concedido?: number }): Promise<ResultadoEstoque> {
    if (!this.ehTier(p.tier)) return Promise.resolve({ ok: false, erro: "tier_invalido" });
    // na allowlist o teto é o MENOR entre o da fase e o concedido no snapshot
    const teto = p.fase === "allowlist" ? Math.min(this.tetoDaFase(p.tier, "allowlist"), p.concedido ?? 0) : this.tetoDaFase(p.tier, "publica");
    return this.livros[p.tier].reservar({ chave: p.chave, carteira: p.carteira, unidades: p.unidades, vendaAberta: p.vendaAberta, elegivel: p.elegivel, teto });
  }

  confirmar(tier: TierVenda, id: string) { return this.livros[tier].confirmar(id); }
  cancelar(tier: TierVenda, id: string) { return this.livros[tier].liberar(id); }
  reserva(tier: TierVenda, id: string) { return this.livros[tier].reserva(id); }

  alocacao(carteira: string, tier: TierVenda, fase: FaseVenda, concedido: number | null): { granted: number | null; used: number; remaining: number | null } {
    const used = this.livros[tier].usadasPor(carteira);
    const granted = fase === "allowlist" ? (concedido === null ? null : Math.min(concedido, this.tetoDaFase(tier, "allowlist"))) : this.tetoDaFase(tier, "publica");
    return { granted, used, remaining: granted === null ? null : Math.max(0, granted - used) };
  }

  resumo(): ResumoEstoque {
    const reserva = reservaEfetiva(this.cfg);
    const porTier = {} as Record<TierVenda, ResumoTier>;
    const total: ResumoTier = { paid_supply: 0, reserved_supply: 0, minted: 0, reserved: 0, available: 0 };
    for (const t of TIERS) {
      const p = this.livros[t].progresso();
      const r: ResumoTier = { paid_supply: p.supply, reserved_supply: reserva.porTier[t], minted: p.confirmadas, reserved: p.reservadas, available: p.restantes };
      porTier[t] = r;
      for (const k of Object.keys(total) as Array<keyof ResumoTier>) total[k] += r[k];
    }
    return { porTier, total, origemReserva: reserva.origem, esgotado: total.available === 0 && total.reserved === 0 };
  }
}
