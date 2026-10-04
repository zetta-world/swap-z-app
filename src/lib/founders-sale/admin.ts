import { createHash } from "node:crypto";
import type { EventoVenda } from "./maquina";
import type { VendaAutoritativa, EstadoAutoritativo, ErroAutoridade } from "./autoridade";
import { congelar, snapshotIntegro, type SnapshotAlocacao } from "./allowlist-hibrida";
import type { CadeiaDeEvidencia } from "./evidencia";

/**
 * CAMADA DE SEGURANÇA DO ADMIN DA VENDA — modelo LOCAL (nenhuma rota hospedada, nenhum provedor).
 *
 * Ação crítica = DOIS passos. `solicitar` exige operador AUTORIZADO e MOTIVO, fotografa a versão do estado
 * autoritativo e devolve a FRASE exata; `confirmar` só executa com a frase idêntica, dentro da validade,
 * (se configurado) por OUTRO operador, e contra a MESMA versão (pedido velho = `versao_desatualizada`).
 * Pedido usado não roda de novo (replay). Todo pedido, recusa e execução vira `admin_audit` com
 * operador, motivo, antes/depois e instante. Nenhum controle de um clique.
 *
 * Regras fixas: congelar exige snapshot íntegro; abrir a allowlist exige snapshot congelado (autoridade);
 * transição só pela matriz da máquina + porteiros de horário da autoridade.
 */
export type AcaoAdmin =
  | { tipo: "pausar" } | { tipo: "retomar" }
  | { tipo: "transicao"; evento: Exclude<EventoVenda, "pausar" | "retomar" | "congelar_allowlist"> }
  | { tipo: "congelar_snapshot"; snapshot: SnapshotAlocacao };

export interface ConfigAdmin {
  validadeMs: number;
  exigeSegundoOperador: boolean;
  /** Abstração de identidade: quem pode operar. Fora da lista = recusado e auditado. */
  operadoresAutorizados: readonly string[];
  motivoMinimo: number;
}

interface Pedido { id: string; acao: AcaoAdmin; frase: string; solicitante: string; motivo: string; criadoEm: number; versao: number; usado: boolean }

export type ErroAdmin =
  | "nao_autorizado" | "motivo_ausente" | "pedido_inexistente" | "pedido_usado" | "pedido_expirado" | "frase_incorreta"
  | "mesmo_operador" | "snapshot_adulterado" | "snapshot_ja_congelado" | ErroAutoridade;

export type ResultadoAdmin = { ok: true; antes: EstadoAutoritativo; depois: EstadoAutoritativo } | { ok: false; erro: ErroAdmin };

function frasePara(a: AcaoAdmin): string {
  switch (a.tipo) {
    case "pausar":            return "PAUSAR VENDA";
    case "retomar":           return "RETOMAR VENDA";
    case "transicao":         return `TRANSICAO ${a.evento.toUpperCase()}`;
    case "congelar_snapshot": return `CONGELAR SNAPSHOT V${a.snapshot.versao}`;
  }
}

export class AdminDaVenda {
  private pedidos = new Map<string, Pedido>();
  private seq = 0;
  private snapshotCongelado: SnapshotAlocacao | null = null;

  constructor(
    private readonly autoridade: VendaAutoritativa,
    private readonly cfg: ConfigAdmin,
    private readonly evidencia: CadeiaDeEvidencia,
    private readonly agora: () => number,
  ) {}

  estado(): EstadoAutoritativo { return this.autoridade.ler(); }
  snapshot(): SnapshotAlocacao | null { return this.snapshotCongelado; }

  private auditar(evento: string, dados: Record<string, unknown>): void {
    const e = this.autoridade.ler();
    this.evidencia.emitir("admin_audit", { evento, estado_venda: e.venda.estado, versao: e.versao, em: this.agora(), ...dados });
  }

  solicitar(acao: AcaoAdmin, operador: string, motivo: string): { ok: true; id: string; frase: string } | { ok: false; erro: ErroAdmin } {
    if (!this.cfg.operadoresAutorizados.includes(operador)) {
      this.auditar("recusado", { motivo_recusa: "nao_autorizado", acao: acao.tipo, operador });
      return { ok: false, erro: "nao_autorizado" };
    }
    if (typeof motivo !== "string" || motivo.trim().length < this.cfg.motivoMinimo) {
      this.auditar("recusado", { motivo_recusa: "motivo_ausente", acao: acao.tipo, operador });
      return { ok: false, erro: "motivo_ausente" };
    }
    const versao = this.autoridade.ler().versao;
    const id = createHash("sha256").update(`pedido\0${++this.seq}\0${operador}\0${this.agora()}`).digest("hex").slice(0, 16);
    const frase = frasePara(acao);
    this.pedidos.set(id, { id, acao, frase, solicitante: operador, motivo: motivo.trim(), criadoEm: this.agora(), versao, usado: false });
    this.auditar("solicitado", { pedido: id, acao: acao.tipo, ...(acao.tipo === "transicao" ? { transicao: acao.evento } : {}), operador, motivo: motivo.trim() });
    return { ok: true, id, frase };
  }

  async confirmar(id: string, operador: string, fraseDigitada: string): Promise<ResultadoAdmin> {
    const p = this.pedidos.get(id);
    const recusar = (erro: ErroAdmin): ResultadoAdmin => {
      this.auditar("recusado", { pedido: id, motivo_recusa: erro, operador });
      return { ok: false, erro };
    };
    if (!this.cfg.operadoresAutorizados.includes(operador)) return recusar("nao_autorizado");
    if (!p) return recusar("pedido_inexistente");
    if (p.usado) return recusar("pedido_usado");
    if (this.agora() - p.criadoEm > this.cfg.validadeMs) return recusar("pedido_expirado");
    if (fraseDigitada !== p.frase) return recusar("frase_incorreta");
    if (this.cfg.exigeSegundoOperador && operador === p.solicitante) return recusar("mesmo_operador");
    p.usado = true;
    const a = p.acao;
    const antes = this.autoridade.ler();
    let evento: EventoVenda;
    let snapshotId: string | undefined;
    if (a.tipo === "congelar_snapshot") {
      if (this.snapshotCongelado) return recusar("snapshot_ja_congelado");
      if (!snapshotIntegro(a.snapshot)) return recusar("snapshot_adulterado");
      evento = "congelar_allowlist"; snapshotId = a.snapshot.id;
    } else {
      evento = a.tipo === "transicao" ? a.evento : a.tipo;
    }
    const r = await this.autoridade.transicionar(evento, { versaoEsperada: p.versao, snapshotId, origem: `admin:${operador}` });
    if (!r.ok) return recusar(r.erro);
    if (a.tipo === "congelar_snapshot") this.snapshotCongelado = congelar(a.snapshot, this.agora());
    this.auditar("executado", {
      pedido: id, acao: a.tipo, operador, solicitante: p.solicitante, motivo: p.motivo,
      de: antes.venda.estado, para: r.estado.venda.estado, versao_antes: antes.versao, versao_depois: r.estado.versao,
      ...(snapshotId ? { snapshot_id: snapshotId, snapshot_versao: (a as { snapshot: SnapshotAlocacao }).snapshot.versao } : {}),
    });
    return { ok: true, antes, depois: r.estado };
  }
}
