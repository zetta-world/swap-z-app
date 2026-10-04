import { createHash } from "node:crypto";

/**
 * SNAPSHOT VERSIONADO DA ALLOWLIST — independente de chain.
 *
 * O normalizador de endereço é INJETADO: a chain não foi decidida (NFT-BRIEFING
 * §7.7) e EVM (checksum/lowercase) e Solana (base58, case-sensitive) normalizam
 * de jeitos incompatíveis. Escolher um aqui seria travar a chain.
 *
 * O id do snapshot é o sha256 do conteúdo canônico (versão + endereços
 * ordenados): dois snapshots com o mesmo conteúdo têm o mesmo id, e qualquer
 * mudança muda o id — é isso que permite auditar "qual lista valeu".
 */
export type Normalizador = (endereco: string) => string | null;

export interface SnapshotAllowlist {
  versao:    number;
  enderecos: readonly string[];
  id:        string;
  /** Entradas recusadas pelo normalizador (contagem; as cruas não ficam guardadas). */
  recusados: number;
}

export function criarSnapshot(versao: number, brutos: Iterable<string>, normalizar: Normalizador): SnapshotAllowlist {
  if (!Number.isInteger(versao) || versao < 1) throw new Error("versao_invalida");
  const set = new Set<string>();
  let recusados = 0;
  for (const b of brutos) {
    const n = normalizar(b);
    if (n === null || n === "") { recusados++; continue; }
    set.add(n);
  }
  const enderecos = Object.freeze([...set].sort());
  const id = createHash("sha256").update(`founders-allowlist-v1\0${versao}\0${enderecos.join("\n")}`).digest("hex");
  return Object.freeze({ versao, enderecos, id, recusados });
}

export function contem(s: SnapshotAllowlist, endereco: string, normalizar: Normalizador): boolean {
  const n = normalizar(endereco);
  if (!n) return false;
  // busca binária: `enderecos` está ordenado
  let lo = 0, hi = s.enderecos.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, c = s.enderecos[m];
    if (c === n) return true;
    if (c < n) lo = m + 1; else hi = m - 1;
  }
  return false;
}

export function diff(antes: SnapshotAllowlist, depois: SnapshotAllowlist): { entraram: string[]; sairam: string[] } {
  const a = new Set(antes.enderecos), d = new Set(depois.enderecos);
  return {
    entraram: depois.enderecos.filter((x) => !a.has(x)),
    sairam:   antes.enderecos.filter((x) => !d.has(x)),
  };
}
