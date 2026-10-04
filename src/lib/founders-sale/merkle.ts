/**
 * ÁRVORE DE MERKLE COM HASH INJETADO — sem escolher chain.
 *
 * EVM costuma usar keccak256 com pares ordenados; Solana/Metaplex usam outros
 * esquemas. A função de hash e a CODIFICAÇÃO DA FOLHA são parâmetros: quando o
 * dono decidir a chain (NFT-BRIEFING §7.7), quem integrar escolhe as duas e esta
 * árvore não muda. Pares são ordenados (byte a byte) antes de concatenar, para
 * a prova não precisar carregar o lado.
 */
export type Hash = (dados: Uint8Array) => Uint8Array;
export type CodificarFolha = (item: string) => Uint8Array;

function comparar(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
function par(h: Hash, a: Uint8Array, b: Uint8Array): Uint8Array {
  const [x, y] = comparar(a, b) <= 0 ? [a, b] : [b, a];
  const junto = new Uint8Array(x.length + y.length);
  junto.set(x, 0); junto.set(y, x.length);
  return h(junto);
}
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

export interface ArvoreMerkle {
  raiz: Uint8Array;
  folhas: Uint8Array[];
  niveis: Uint8Array[][];
}

export function construir(itens: readonly string[], hash: Hash, folha: CodificarFolha): ArvoreMerkle {
  if (itens.length === 0) throw new Error("arvore_vazia");
  const folhas = itens.map((i) => hash(folha(i)));
  const niveis: Uint8Array[][] = [folhas];
  let atual = folhas;
  while (atual.length > 1) {
    const prox: Uint8Array[] = [];
    for (let i = 0; i < atual.length; i += 2) {
      prox.push(i + 1 < atual.length ? par(hash, atual[i], atual[i + 1]) : atual[i]); // ímpar sobe sem par
    }
    niveis.push(prox);
    atual = prox;
  }
  return { raiz: atual[0], folhas, niveis };
}

export function prova(arvore: ArvoreMerkle, indice: number): Uint8Array[] {
  if (!Number.isInteger(indice) || indice < 0 || indice >= arvore.folhas.length) throw new Error("indice_invalido");
  const out: Uint8Array[] = [];
  let i = indice;
  for (let n = 0; n < arvore.niveis.length - 1; n++) {
    const nivel = arvore.niveis[n];
    const irmao = i % 2 === 0 ? i + 1 : i - 1;
    if (irmao < nivel.length) out.push(nivel[irmao]);
    i = Math.floor(i / 2);
  }
  return out;
}

export function verificar(raiz: Uint8Array, item: string, caminho: readonly Uint8Array[], hash: Hash, folha: CodificarFolha): boolean {
  let atual = hash(folha(item));
  for (const p of caminho) atual = par(hash, atual, p);
  return hex(atual) === hex(raiz);
}
