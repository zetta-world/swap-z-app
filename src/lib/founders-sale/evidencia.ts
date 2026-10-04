import { createHash } from "node:crypto";

/**
 * EVIDÊNCIA IMUTÁVEL DA VENDA (local) — JSON canônico + sha256, encadeado.
 *
 * Cada registro tem `tipo`, `dados`, `anterior` (hash do registro anterior,
 * ou "GENESIS") e `hash` = sha256(JSON canônico de {tipo, versao, dados,
 * anterior}). Alterar qualquer byte de qualquer registro quebra a cadeia
 * dali em diante (`verificarCadeia`). Os objetos são congelados em
 * profundidade: o código não consegue "corrigir" evidência depois de emitida.
 */
export const TIPOS_EVIDENCIA = [
  "allowlist_snapshot", "merkle_root", "proof_version", "sale_config_fingerprint",
  "mock_tx_lifecycle", "admin_audit", "sold_out_reconciliation",
] as const;
export type TipoEvidencia = (typeof TIPOS_EVIDENCIA)[number];

export const VERSAO_EVIDENCIA = 1;

export interface RegistroEvidencia {
  readonly tipo: TipoEvidencia;
  readonly versao: number;
  readonly dados: Readonly<Record<string, unknown>>;
  readonly anterior: string;
  readonly hash: string;
}

/** JSON canônico: chaves ordenadas em todos os níveis; recusa undefined/funções/NaN. */
export function canonico(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("numero_nao_finito");
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonico).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => {
      if (o[k] === undefined) throw new Error(`indefinido:${k}`);
      return `${JSON.stringify(k)}:${canonico(o[k])}`;
    }).join(",")}}`;
  }
  throw new Error(`tipo_nao_serializavel:${typeof v}`);
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

function congelar<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) congelar(v);
  }
  return o;
}

export class CadeiaDeEvidencia {
  private readonly registros: RegistroEvidencia[] = [];

  emitir(tipo: TipoEvidencia, dados: Record<string, unknown>): RegistroEvidencia {
    if (!TIPOS_EVIDENCIA.includes(tipo)) throw new Error("tipo_invalido");
    const copia = JSON.parse(canonico(dados)) as Record<string, unknown>;
    const anterior = this.registros.length ? this.registros[this.registros.length - 1].hash : "GENESIS";
    const hash = sha256Hex(canonico({ tipo, versao: VERSAO_EVIDENCIA, dados: copia, anterior }));
    const r = congelar({ tipo, versao: VERSAO_EVIDENCIA, dados: copia, anterior, hash });
    this.registros.push(r);
    return r;
  }

  todos(): readonly RegistroEvidencia[] { return Object.freeze([...this.registros]); }
}

export function verificarCadeia(regs: readonly RegistroEvidencia[]): { ok: true } | { ok: false; indice: number; motivo: string } {
  let anterior = "GENESIS";
  for (let i = 0; i < regs.length; i++) {
    const r = regs[i];
    if (r.anterior !== anterior) return { ok: false, indice: i, motivo: "elo_quebrado" };
    const h = sha256Hex(canonico({ tipo: r.tipo, versao: r.versao, dados: r.dados, anterior: r.anterior }));
    if (h !== r.hash) return { ok: false, indice: i, motivo: "conteudo_alterado" };
    anterior = r.hash;
  }
  return { ok: true };
}

/** Impressão da configuração da venda: muda se QUALQUER parâmetro mudar. */
export function impressaoConfig(config: Record<string, unknown>): string {
  return sha256Hex(`founders-sale-config-v1\0${canonico(config)}`);
}
