import { createHash } from "node:crypto";
import { transicionar, type Venda, type EventoVenda } from "./maquina";
import type { SnapshotAllowlist } from "./allowlist";
import type { CadeiaDeEvidencia } from "./evidencia";

/**
 * CAMADA DE SEGURANÇA DO ADMIN DA VENDA — modelo LOCAL (nenhuma rota, nenhum provedor).
 *
 * Toda ação sensível é em DOIS passos: `solicitar` devolve um pedido pendente
 * com a FRASE exata que precisa ser digitada; `confirmar` só executa com a
 * frase idêntica, dentro da validade e (se configurado) por OUTRO operador.
 * Cada pedido, confirmação, recusa e execução vira evento `admin_audit` na
 * cadeia de evidência. Exigir segundo operador é decisão do dono: aqui é
 * configurável (`exigeSegundoOperador`), não um padrão inventado.
 *
 * Regras de segurança fixas (independentes de decisão):
 *   · abrir a fase de allowlist exige snapshot CONGELADO;
 *   · snapshot congelado não muda; trocar a lista = nova versão + novo congelamento;
 *   · transição só pela matriz de `maquina.ts`.
 */
export type AcaoAdmin =
  | { tipo: "pausar" } | { tipo: "retomar" }
  | { tipo: "transicao"; evento: Exclude<EventoVenda, "pausar" | "retomar"> }
  | { tipo: "congelar_snapshot"; snapshot: SnapshotAllowlist };

export interface ConfigAdmin { validadeMs: number; exigeSegundoOperador: boolean }

interface Pedido { id: string; acao: AcaoAdmin; frase: string; solicitante: string; criadoEm: number; usado: boolean }

export type ResultadoAdmin =
  | { ok: true; venda: Venda }
  | { ok: false; erro: "pedido_inexistente" | "pedido_usado" | "pedido_expirado" | "frase_incorreta"
      | "mesmo_operador" | "snapshot_nao_congelado" | "snapshot_ja_congelado" | "transicao_proibida" | "estado_terminal" };

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
  private snapshotCongelado: SnapshotAllowlist | null = null;

  constructor(
    private venda: Venda,
    private readonly cfg: ConfigAdmin,
    private readonly evidencia: CadeiaDeEvidencia,
    private readonly agora: () => number,
  ) {}

  estado(): Venda { return this.venda; }
  snapshot(): SnapshotAllowlist | null { return this.snapshotCongelado; }

  private auditar(evento: string, dados: Record<string, unknown>): void {
    this.evidencia.emitir("admin_audit", { evento, estado_venda: this.venda.estado, em: this.agora(), ...dados });
  }

  solicitar(acao: AcaoAdmin, operador: string): { id: string; frase: string } {
    const id = createHash("sha256").update(`pedido\0${++this.seq}\0${operador}\0${this.agora()}`).digest("hex").slice(0, 16);
    const frase = frasePara(acao);
    this.pedidos.set(id, { id, acao, frase, solicitante: operador, criadoEm: this.agora(), usado: false });
    this.auditar("solicitado", { pedido: id, acao: acao.tipo, ...(acao.tipo === "transicao" ? { transicao: acao.evento } : {}), operador });
    return { id, frase };
  }

  confirmar(id: string, operador: string, fraseDigitada: string): ResultadoAdmin {
    const p = this.pedidos.get(id);
    const recusar = (erro: Exclude<ResultadoAdmin, { ok: true }>["erro"]): ResultadoAdmin => {
      this.auditar("recusado", { pedido: id, motivo: erro, operador });
      return { ok: false, erro };
    };
    if (!p) return recusar("pedido_inexistente");
    if (p.usado) return recusar("pedido_usado");
    if (this.agora() - p.criadoEm > this.cfg.validadeMs) return recusar("pedido_expirado");
    if (fraseDigitada !== p.frase) return recusar("frase_incorreta");
    if (this.cfg.exigeSegundoOperador && operador === p.solicitante) return recusar("mesmo_operador");
    p.usado = true;

    const a = p.acao;
    if (a.tipo === "congelar_snapshot") {
      if (this.snapshotCongelado && this.snapshotCongelado.versao >= a.snapshot.versao) return recusar("snapshot_ja_congelado");
      this.snapshotCongelado = a.snapshot;
      this.auditar("executado", { pedido: id, acao: a.tipo, snapshot_id: a.snapshot.id, snapshot_versao: a.snapshot.versao, enderecos: a.snapshot.enderecos.length, operador });
      return { ok: true, venda: this.venda };
    }
    const evento: EventoVenda = a.tipo === "transicao" ? a.evento : a.tipo;
    if (evento === "abrir_allowlist" && !this.snapshotCongelado) return recusar("snapshot_nao_congelado");
    const r = transicionar(this.venda, evento);
    if (!r.ok) return recusar(r.erro);
    const de = this.venda.estado;
    this.venda = r.venda;
    this.auditar("executado", { pedido: id, acao: a.tipo, de, para: r.venda.estado, operador });
    return { ok: true, venda: r.venda };
  }
}
