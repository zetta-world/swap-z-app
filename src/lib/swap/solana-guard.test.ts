import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { VersionedTransaction } from "@solana/web3.js";
import {
  verifyJupiterTransaction, extractProgramIds, JUPITER_ALLOWED_PROGRAMS,
  shouldBlock, type GuardVerdict,
} from "@/lib/swap/solana-guard";

const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const COMPUTE = "ComputeBudget111111111111111111111111111111";
// Um program ID REAL que não está na allowlist (Raydium AMM v4). Serve como
// "programa inesperado no topo da transação": num swap do Jupiter as AMMs são
// chamadas por CPI DENTRO do programa dele, então elas aparecem como contas —
// nunca como instrução de topo. Ver uma aqui é sinal de que a transação não é
// o que diz ser.
const UNKNOWN_PROGRAM = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";

/** Monta o mínimo de uma VersionedTransaction que o guard realmente lê:
 *  as chaves estáticas e os índices de programa das instruções. */
function tx(programIds: string[], opts: { breakIndex?: boolean } = {}): VersionedTransaction {
  const unique = [...new Set(programIds)];
  const staticAccountKeys = unique.map((p) => new PublicKey(p));
  return {
    message: {
      staticAccountKeys,
      compiledInstructions: programIds.map((p) => ({
        // breakIndex simula a instrução cujo programa vem de uma Address Lookup
        // Table: o índice aponta pra fora do array estático.
        programIdIndex: opts.breakIndex ? 99 : unique.indexOf(p),
        accountKeyIndexes: [],
        data: new Uint8Array(),
      })),
    },
  } as unknown as VersionedTransaction;
}

describe("extractProgramIds", () => {
  it("lê os programas invocados", () => {
    expect(extractProgramIds(tx([COMPUTE, JUPITER, TOKEN]))).toEqual([COMPUTE, JUPITER, TOKEN]);
  });

  it("devolve null quando o índice aponta fora das chaves estáticas (ALT)", () => {
    expect(extractProgramIds(tx([JUPITER], { breakIndex: true }))).toBeNull();
  });

  it("devolve null em transação sem chaves (ilegível)", () => {
    const empty = { message: { staticAccountKeys: [], compiledInstructions: [] } } as unknown as VersionedTransaction;
    expect(extractProgramIds(empty)).toBeNull();
  });

  it("nunca lança, mesmo com objeto malformado", () => {
    expect(extractProgramIds({} as VersionedTransaction)).toBeNull();
  });
});

describe("verifyJupiterTransaction — o que pode ser assinado", () => {
  it("APROVA um swap normal do Jupiter", () => {
    const v = verifyJupiterTransaction(tx([COMPUTE, JUPITER, TOKEN]));
    expect(v.ok).toBe(true);
    expect(v.unknownPrograms).toEqual([]);
  });

  it("APROVA usando qualquer programa da lista (cobre a lista inteira)", () => {
    for (const program of Object.keys(JUPITER_ALLOWED_PROGRAMS)) {
      expect(verifyJupiterTransaction(tx([program])).ok).toBe(true);
    }
  });

  it("RECUSA quando há um programa desconhecido junto do swap legítimo", () => {
    // O caso realista de ataque: o swap funciona E a instrução extra passa.
    const v = verifyJupiterTransaction(tx([COMPUTE, JUPITER, TOKEN, UNKNOWN_PROGRAM]));
    expect(v.ok).toBe(false);
    expect(v.unknownPrograms).toEqual([UNKNOWN_PROGRAM]);
    expect(v.reason).toContain("não reconhecido");
  });

  it("RECUSA quando a transação é ilegível (fail-closed)", () => {
    // 'Não consegui verificar' NUNCA pode virar 'então tá liberado'.
    const v = verifyJupiterTransaction(tx([JUPITER], { breakIndex: true }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("Não foi possível");
  });

  it("RECUSA transação sem instrução nenhuma", () => {
    const empty = {
      message: { staticAccountKeys: [new PublicKey(JUPITER)], compiledInstructions: [] },
    } as unknown as VersionedTransaction;
    const v = verifyJupiterTransaction(empty);
    expect(v.ok).toBe(false);
  });

  it("não repete o mesmo programa desconhecido no relatório", () => {
    const v = verifyJupiterTransaction(tx([JUPITER, UNKNOWN_PROGRAM, UNKNOWN_PROGRAM]));
    expect(v.unknownPrograms).toEqual([UNKNOWN_PROGRAM]);
  });

  it("reporta todos os programas vistos, para diagnóstico", () => {
    const v = verifyJupiterTransaction(tx([COMPUTE, JUPITER]));
    expect(v.programs).toContain(JUPITER);
    expect(v.programs).toContain(COMPUTE);
  });
});

describe("shouldBlock — só enforce impede a assinatura", () => {
  const bad: GuardVerdict = { ok: false, programs: [], unknownPrograms: [UNKNOWN_PROGRAM], reason: "x" };
  const good: GuardVerdict = { ok: true, programs: [JUPITER], unknownPrograms: [] };

  it("shadow NÃO bloqueia, mesmo com veredito ruim", () => {
    // É o ponto do modo observação: o guard aprende com tráfego real antes de
    // ter poder de veto. Bloquear por suposição quebraria swap legítimo.
    expect(shouldBlock("shadow", bad)).toBe(false);
  });

  it("off NÃO bloqueia", () => {
    expect(shouldBlock("off", bad)).toBe(false);
  });

  it("enforce bloqueia veredito ruim", () => {
    expect(shouldBlock("enforce", bad)).toBe(true);
  });

  it("enforce deixa passar veredito bom", () => {
    expect(shouldBlock("enforce", good)).toBe(false);
  });
});
