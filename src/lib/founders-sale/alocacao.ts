/**
 * LIVRO DE RESERVAS DA VENDA — sem oversell, idempotente, serializado.
 *
 * Independente de decisão: supply, teto por carteira e validade da reserva
 * entram como CONFIGURAÇÃO (nenhum default de negócio aqui). Preço e moeda nem
 * aparecem: a reserva é de UNIDADES.
 *
 * Invariantes (testados):
 *   · reservadas_ativas + confirmadas ≤ supply, sempre — inclusive com muitas
 *     chamadas concorrentes (todas as mutações passam por uma fila única);
 *   · unidades (ativas + confirmadas) por carteira ≤ maxPorCarteira;
 *   · a mesma `chave` de idempotência devolve o MESMO resultado (replay/duplo
 *     clique não reserva duas vezes);
 *   · reserva expirada libera as unidades; confirmar reserva expirada falha.
 *
 * ⚠️ Em memória. A versão persistente (migration) precisará das mesmas
 * invariantes no BANCO (constraint/lock), não só aqui — fica para depois das
 * decisões de elegibilidade e tetos.
 */
export interface ConfigAlocacao {
  supply:         number;
  maxPorCarteira: number;
  validadeMs:     number;
}

export type StatusReserva = "ativa" | "confirmada" | "expirada" | "liberada";

export interface Reserva {
  id:        string;
  chave:     string;
  carteira:  string;
  unidades:  number;
  criadaEm:  number;
  status:    StatusReserva;
}

export type ErroReserva =
  | "parametro_invalido" | "venda_fechada" | "esgotado" | "teto_da_carteira" | "nao_elegivel";

export type ResultadoReserva = { ok: true; reserva: Reserva; replay: boolean } | { ok: false; erro: ErroReserva };

export class LivroDeReservas {
  private readonly reservas = new Map<string, Reserva>();
  private readonly porChave = new Map<string, ResultadoReserva>();
  private fila: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(private readonly cfg: ConfigAlocacao, private readonly agora: () => number = Date.now) {
    for (const [k, v] of Object.entries(cfg)) {
      if (!Number.isInteger(v) || v <= 0) throw new Error(`config_invalida:${k}`);
    }
  }

  /** Serializa: a próxima mutação só começa quando a anterior terminou. */
  private emFila<T>(fn: () => T): Promise<T> {
    const p = this.fila.then(fn, fn);
    this.fila = p.catch(() => undefined);
    return p;
  }

  private expirar(): void {
    const t = this.agora();
    for (const r of this.reservas.values()) {
      if (r.status === "ativa" && t - r.criadaEm >= this.cfg.validadeMs) r.status = "expirada";
    }
  }

  private ocupadas(carteira?: string): number {
    let n = 0;
    for (const r of this.reservas.values()) {
      if ((r.status === "ativa" || r.status === "confirmada") && (carteira === undefined || r.carteira === carteira)) n += r.unidades;
    }
    return n;
  }

  reservar(p: { chave: string; carteira: string; unidades: number; vendaAberta: boolean; elegivel: boolean }): Promise<ResultadoReserva> {
    return this.emFila(() => {
      const anterior = this.porChave.get(p.chave);
      if (anterior) return anterior.ok ? { ...anterior, replay: true } : anterior;
      this.expirar();
      let r: ResultadoReserva;
      if (!p.chave || !p.carteira || !Number.isInteger(p.unidades) || p.unidades <= 0) r = { ok: false, erro: "parametro_invalido" };
      else if (!p.vendaAberta) r = { ok: false, erro: "venda_fechada" };
      else if (!p.elegivel) r = { ok: false, erro: "nao_elegivel" };
      else if (this.ocupadas(p.carteira) + p.unidades > this.cfg.maxPorCarteira) r = { ok: false, erro: "teto_da_carteira" };
      else if (this.ocupadas() + p.unidades > this.cfg.supply) r = { ok: false, erro: "esgotado" };
      else {
        const reserva: Reserva = { id: `res-${++this.seq}`, chave: p.chave, carteira: p.carteira, unidades: p.unidades, criadaEm: this.agora(), status: "ativa" };
        this.reservas.set(reserva.id, reserva);
        r = { ok: true, reserva: { ...reserva }, replay: false };
      }
      // Recusas por estado transitório (fechada/esgotado) NÃO são memorizadas: a mesma chave pode tentar de novo.
      if (r.ok || r.erro === "parametro_invalido" || r.erro === "nao_elegivel") this.porChave.set(p.chave, r);
      return r;
    });
  }

  confirmar(id: string): Promise<{ ok: true } | { ok: false; erro: "inexistente" | "expirada" | "ja_confirmada" | "liberada" }> {
    return this.emFila(() => {
      this.expirar();
      const r = this.reservas.get(id);
      if (!r) return { ok: false as const, erro: "inexistente" as const };
      if (r.status === "confirmada") return { ok: false as const, erro: "ja_confirmada" as const };
      if (r.status === "expirada") return { ok: false as const, erro: "expirada" as const };
      if (r.status === "liberada") return { ok: false as const, erro: "liberada" as const };
      r.status = "confirmada";
      return { ok: true as const };
    });
  }

  liberar(id: string): Promise<boolean> {
    return this.emFila(() => {
      const r = this.reservas.get(id);
      if (!r || r.status !== "ativa") return false;
      r.status = "liberada";
      return true;
    });
  }

  /** Progresso para a UI: só números agregados. */
  progresso(): { supply: number; confirmadas: number; reservadas: number; restantes: number; esgotado: boolean } {
    this.expirar();
    let confirmadas = 0, reservadas = 0;
    for (const r of this.reservas.values()) {
      if (r.status === "confirmada") confirmadas += r.unidades;
      else if (r.status === "ativa") reservadas += r.unidades;
    }
    const restantes = this.cfg.supply - confirmadas - reservadas;
    return { supply: this.cfg.supply, confirmadas, reservadas, restantes, esgotado: confirmadas >= this.cfg.supply };
  }
}
