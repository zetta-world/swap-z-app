/**
 * Lighthouse v2 (24/10/2026) — o formato REAL da Phantom e a extensão restrita da mensagem cotada.
 *
 * Chaves geradas no teste, sem fundos; nenhum RPC. Vetores de bytes codificados à mão a partir do upstream
 * (Jac0xb/lighthouse@4c579479, borsh 0.10.3, LEB128) e do vetor de mainnet da Phantom (turf-monster PR #758).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Keypair, MessageV0, PublicKey, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  CU_LIMITE_MAXIMO, LIGHTHOUSE, MAX_ASSERCOES_ACRESCENTADAS, assercaoLighthouse, compararExtensao, diagnosticoLighthouse,
  extensaoLighthouse,
} from "./lighthouse";
import { conferirVinculo, emitirVinculo } from "./vinculo";
import { formaDaMensagem, validarTransacaoAssinada } from "./transmissao";

// ── bytes ────────────────────────────────────────────────────────────────────────────────────────────
const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return [...b]; };
const pk = (fill: number) => Array<number>(32).fill(fill);
const leb = (n: number) => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
const B = (xs: number[]) => Buffer.from(xs);

/** Instrução da Phantom decodificada de uma tx REAL de mainnet (16/09/2026): AssertAccountInfoMulti, log 4,
 *  [KnownOwner == System, DataLength == 0] sobre o pagador. Recusada pelo #449 → a falha de produção. */
const PHANTOM_REAL = Buffer.from("06040203000001000000000000000000", "hex");
/** Mesma forma com log 5 (prefixo `06 05` relatado no Seeker). */
const PHANTOM_05 = Buffer.from("06050203000001000000000000000000", "hex");
/** AssertTokenAccountMulti (10), log 4: [Amount >= 5]. */
const PHANTOM_TOKEN = B([10, 4, ...leb(1), 2, ...u64(5n), 4]);
const NOOP = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

// ── transações ───────────────────────────────────────────────────────────────────────────────────────
const owner = Keypair.generate();
const recipient = Keypair.generate().publicKey, fee = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
const jup = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const block = Keypair.generate().publicKey.toBase58();
const cuLimit = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });
const cuPrice = (microLamports: number) => ComputeBudgetProgram.setComputeUnitPrice({ microLamports });
/** Instrução "de swap": pagador, destino e conta de taxa graváveis, mint só leitura; dados = valor/token/slippage. */
const swap = () => new TransactionInstruction({ programId: jup, keys: [
  { pubkey: owner.publicKey, isSigner: true, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: true },
  { pubkey: fee, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
], data: B([1, 10, 25, 50]) });
/** O que o nosso montador produz: SetComputeUnitLimit + SetComputeUnitPrice primeiro, depois a rota. */
const montada = () => [cuLimit(200_000), cuPrice(1_000), swap()];
const lh = (data: Buffer, contas: PublicKey[], gravavel = false) => new TransactionInstruction({
  programId: new PublicKey(LIGHTHOUSE), data, keys: contas.map(pubkey => ({ pubkey, isSigner: false, isWritable: gravavel })),
});
const pagadorPhantom = () => lh(PHANTOM_REAL, [owner.publicKey]);
const tokenPhantom = () => lh(PHANTOM_TOKEN, [recipient]);

function tx(ixs: TransactionInstruction[], o: { tables?: AddressLookupTableAccount[]; blockhash?: string; signers?: Keypair[] } = {}) {
  const t = new VersionedTransaction(new TransactionMessage({ payerKey: owner.publicKey, recentBlockhash: o.blockhash ?? block, instructions: ixs })
    .compileToV0Message(o.tables ?? []));
  t.sign([owner, ...(o.signers ?? [])]);
  return t;
}
/** Re-assina uma mensagem montada à mão (a carteira assina o que tiver na frente). */
const assinar = (m: MessageV0) => { const t = new VersionedTransaction(m); t.sign([owner]); return t; };
const original64 = (t: VersionedTransaction) => Buffer.from(t.message.serialize()).toString("base64");
const wire = (t: VersionedTransaction) => Buffer.from(t.serialize()).toString("base64");
const bind = (t: VersionedTransaction, bps = 25) =>
  emitirVinculo({ mensagem: t.message.serialize(), owner: owner.publicKey.toBase58(), bps, feeAccount: bps ? fee.toBase58() : null, validoAteBloco: 9999 })!;
/** O caminho completo do servidor para (original cotada, assinada pela carteira). */
const conferir = (a: VersionedTransaction, b: VersionedTransaction) => conferirVinculo(bind(a), b, Date.now(), original64(a));
const regra = (a: VersionedTransaction, b: VersionedTransaction) => {
  const r = compararExtensao(a.message as MessageV0, b.message as MessageV0);
  return r.ok ? "ok" : r.regra;
};

beforeEach(() => vi.stubEnv("TX_VINCULO_SECRET", "fixture-only-lighthouse-32-chars-secret"));
afterEach(() => vi.unstubAllEnvs());

describe("decodificador: asserções do upstream, campo a campo", () => {
  it("⚠️ aceita a instrução REAL da Phantom (log 4, KnownOwner) que o #449 recusava — e as variantes 06 05 e 10", () => {
    expect(diagnosticoLighthouse(PHANTOM_REAL, 1)).toBeNull();
    expect(diagnosticoLighthouse(PHANTOM_05, 1)).toBeNull();
    expect(diagnosticoLighthouse(PHANTOM_TOKEN, 1)).toBeNull();
  });

  it("log level é o índice borsh 0..6; o `repr` do Rust (0x10..0x12) e 7 não existem no fio", () => {
    for (let log = 0; log <= 6; log++) expect(diagnosticoLighthouse(B([9, log, 2, ...u64(1n), 0]), 1), `log ${log}`).toBeNull();
    expect(diagnosticoLighthouse(B([9, 7, 2, ...u64(1n), 0]), 1)).toBe("log:7");
    expect(diagnosticoLighthouse(B([9, 0x10, 2, ...u64(1n), 0]), 1)).toBe("log:16");
  });

  it.each<[string, number[], number]>([
    ["AccountData U64>=", [2, 0, ...leb(64), 7, ...u64(1n), 4], 1],
    ["AccountData Bytes==", [2, 0, ...leb(0), 11, ...leb(3), 1, 2, 3, 0], 1],
    ["AccountData Pubkey!=", [2, 0, ...leb(32), 12, ...pk(4), 1], 1],
    ["AccountDataMulti U8 + Bool", [3, 1, ...leb(2), ...leb(0), 1, 1, 0, ...leb(9), 0, 1, 0], 1],
    ["AccountDelta AccountInfo (2 contas)", [4, 0, 0, ...leb(8), 0, ...Array(16).fill(0), 4], 2],
    ["AccountDelta Data Bytes", [4, 2, 1, ...leb(0), ...leb(0), 8, 32, 0, 0], 2],
    ["AccountInfo Lamports>=", [5, 0, 0, ...u64(1000n), 4], 1],
    ["AccountInfo Owner==", [5, 0, 2, ...pk(9), 0], 1],
    ["AccountInfo KnownOwner(Token)", [5, 0, 3, 1, 0], 1],
    ["AccountInfo IsWritable", [5, 0, 6, 1, 0], 1],
    ["AccountInfo VerifyDatahash", [5, 0, 8, ...pk(7), ...leb(0), ...leb(165)], 1],
    ["AccountInfoMulti 17 itens", [6, 0, ...leb(17), ...Array.from({ length: 17 }, () => [0, ...u64(1n), 0]).flat()], 1],
    ["MintAccount Supply>=", [7, 0, 1, ...u64(1n), 4], 1],
    ["MintAccount MintAuthority None", [7, 0, 0, 0, 0], 1],
    ["MintAccountMulti Decimals==", [8, 0, ...leb(1), 2, 6, 0], 1],
    ["TokenAccount Delegate Some", [9, 0, 3, 1, ...pk(5), 0], 1],
    ["TokenAccount State raw u8", [9, 0, 4, 3, 3], 1],
    ["TokenAccount IsNative Some(u64)", [9, 0, 5, 1, ...u64(2n), 1], 1],
    ["TokenAccount OwnerIsDerived", [9, 0, 8], 1],
    ["TokenAccountMulti Mint+Owner+Amount", [10, 0, ...leb(3), 0, ...pk(1), 0, 1, ...pk(2), 0, 2, ...u64(5n), 4], 1],
    ["TokenAccountMulti vazio (no-op válido)", [10, 0, 0], 1],
    ["TokenAccountMulti LEB128 não canônico (0x81 0x00 = 1)", [10, 0, 0x81, 0x00, 2, ...u64(1n), 0], 1],
    ["StakeAccount State==Stake", [11, 0, 0, 2, 0], 1],
    ["StakeAccount Meta Lockup", [11, 0, 1, 3, ...u64(1n), 0], 1],
    ["StakeAccountMulti Stake Voter", [12, 0, ...leb(1), 2, 0, ...pk(3), 0], 1],
    ["UpgradeableLoader State==Program", [13, 0, 0, 2, 0], 1],
    ["UpgradeableLoader ProgramData Authority", [13, 0, 3, 0, 1, ...pk(8), 0], 1],
    ["UpgradeableLoaderMulti Program", [14, 0, ...leb(1), 2, 0, ...pk(8), 1], 1],
    ["SysvarClock Slot<= (sem contas)", [15, 0, 0, ...u64(1n), 5], 0],
    ["BubblegumTreeConfig IsPublic", [17, 0, 4, 1, 0], 1],
    ["contas a mais são ignoradas pelo programa", [9, 0, 2, ...u64(1n), 0], 3],
    ["log 3 com o SPL Noop como 2ª conta", [9, 3, 2, ...u64(1n), 0], 2],
  ])("aceita %s", (_, data, contas) => {
    expect(diagnosticoLighthouse(B(data), contas)).toBeNull();
    expect(assercaoLighthouse(B(data), contas)).toBe(true);
  });

  it.each<[string, number[], number, RegExp]>([
    ["MemoryWrite (escreve + CPI no System)", [0, 0, 255, 0, 2, 7, ...u64(1n)], 5, /^opcode:0$/],
    ["MemoryClose (move lamports)", [1, 0, 255], 3, /^opcode:1$/],
    ["AssertMerkleTree (CPI sempre)", [16, 0, 0, 0, 0], 3, /^opcode:16$/],
    ["opcode 18", [18, 0, 0], 1, /^opcode:18$/],
    ["opcode 255", [255, 0], 1, /^opcode:255$/],
    ["TokenAccount sem conta", [9, 0, 2, ...u64(1n), 0], 0, /^contas:9:0$/],
    ["AccountDelta com 1 conta", [4, 0, 0, ...leb(8), 0, ...Array(16).fill(0), 4], 1, /^contas:4:1$/],
    ["byte sobrando", [9, 0, 2, ...u64(1n), 0, 0], 1, /^sobra:9:1$/],
    ["truncada", [9, 0, 2, ...u64(1n)], 1, /^truncada:9:/],
    ["IntegerOperator 8", [9, 0, 2, ...u64(1n), 8], 1, /^campo:9:/],
    ["EquatableOperator 2", [5, 0, 3, 0, 2], 1, /^campo:5:/],
    ["KnownProgram 9", [5, 0, 3, 9, 0], 1, /^campo:5:/],
    ["bool 2", [5, 0, 5, 2, 0], 1, /^campo:5:/],
    ["Option tag 2", [9, 0, 3, 2, 0], 1, /^campo:9:/],
    ["variante inexistente de AccountInfo (9)", [5, 0, 9], 1, /^campo:5:/],
    ["StakeStateType 4", [11, 0, 0, 4, 0], 1, /^campo:11:/],
    ["Multi com 65 itens", [10, 0, ...leb(65), ...Array.from({ length: 65 }, () => [8]).flat()], 1, /^campo:10:/],
    ["LEB128 longo demais", [2, 0, ...Array(10).fill(0xff), 0x01, 1, 1, 0], 1, /^campo:2:/],
    ["Bytes maior que uma transação", [2, 0, 0, 11, ...leb(1233)], 1, /^campo:2:/],
    ["1 byte", [9], 1, /^tamanho:1$/],
  ])("recusa %s", (_, data, contas, motivo) => {
    expect(diagnosticoLighthouse(B(data), contas)).toMatch(motivo);
    expect(assercaoLighthouse(B(data), contas)).toBe(false);
  });

  it("recusa dados maiores que uma transação", () => {
    expect(diagnosticoLighthouse(Buffer.alloc(1233, 0), 1)).toBe("tamanho:1233");
  });
});

describe("extensão: a mensagem assinada é a cotada + asserções", () => {
  it("sem mudança: o hash da cotação basta (nenhuma extensão)", () => {
    const a = tx(montada());
    expect(conferirVinculo(bind(a), a)).toMatchObject({ ok: true });
    expect(conferirVinculo(bind(a), a)).not.toHaveProperty("extensao");
  });

  it("⚠️ forma da Phantom (sufixo: pagador + token) → aceita, com o MESMO vínculo HMAC", () => {
    const a = tx(montada()), b = tx([...montada(), pagadorPhantom(), tokenPhantom()]);
    expect(validarTransacaoAssinada(wire(b), owner.publicKey.toBase58())).toMatchObject({ ok: true });
    expect(conferir(a, b)).toMatchObject({ ok: true, dados: { b: 25, f: fee.toBase58() }, extensao: { assercoes: 2, cuElevado: false } });
  });

  it("asserções ANTES e ENTRE as instruções originais (formas relatadas) → aceitas", () => {
    const a = tx(montada());
    expect(regra(a, tx([pagadorPhantom(), ...montada()]))).toBe("ok");
    expect(regra(a, tx([cuLimit(200_000), pagadorPhantom(), cuPrice(1_000), swap(), tokenPhantom()]))).toBe("ok");
    expect(regra(a, tx([lh(PHANTOM_05, [owner.publicKey]), ...montada(), lh(PHANTOM_05, [owner.publicKey])]))).toBe("ok");
  });

  it("SetComputeUnitLimit MAIOR (até o teto do runtime) para pagar as asserções → aceito", () => {
    const a = tx(montada());
    const b = tx([cuLimit(260_000), cuPrice(1_000), swap(), pagadorPhantom()]);
    expect(conferir(a, b)).toMatchObject({ ok: true, extensao: { assercoes: 1, cuElevado: true } });
    expect(regra(a, tx([cuLimit(CU_LIMITE_MAXIMO), cuPrice(1_000), swap(), pagadorPhantom()]))).toBe("ok");
  });

  it("conta nova SÓ LEITURA usada pela asserção (alvo novo ou o SPL Noop do log 3) → aceita", () => {
    const a = tx(montada());
    expect(regra(a, tx([...montada(), lh(PHANTOM_REAL, [Keypair.generate().publicKey])]))).toBe("ok");
    expect(regra(a, tx([...montada(), lh(B([9, 3, 2, ...u64(1n), 0]), [recipient, NOOP])]))).toBe("ok");
  });

  it(`até ${MAX_ASSERCOES_ACRESCENTADAS} asserções; uma a mais é recusada`, () => {
    const a = tx(montada());
    const n = (k: number) => tx([...montada(), ...Array.from({ length: k }, () => pagadorPhantom())]);
    expect(regra(a, n(MAX_ASSERCOES_ACRESCENTADAS))).toBe("ok");
    expect(regra(a, n(MAX_ASSERCOES_ACRESCENTADAS + 1))).toBe("assercoes_demais");
  });

  it("taxa zero aprovada no servidor continua valendo com a extensão", () => {
    const a = tx(montada()), b = tx([...montada(), pagadorPhantom()]);
    const r = conferirVinculo(bind(a, 0), b, Date.now(), original64(a));
    expect(r).toMatchObject({ ok: true, dados: { b: 0, f: null } });
  });

  it("compatibilidade: `extensaoLighthouse` dá o mesmo veredito", () => {
    const a = tx(montada());
    expect(extensaoLighthouse(a.message as MessageV0, tx([...montada(), pagadorPhantom()]).message as MessageV0)).toBe(true);
    expect(extensaoLighthouse(a.message as MessageV0, tx([...montada(), swap(), pagadorPhantom()]).message as MessageV0)).toBe(false);
  });
});

describe("⚠️⚠️ extensão: tudo que mexe em dinheiro, privilégio ou validade continua recusado", () => {
  it.each(["destino", "conta de taxa", "sem conta de taxa", "valor", "token", "slippage", "privilégio"])("%s alterado, mesmo re-assinado", what => {
    const a = tx(montada()), ix = swap();
    if (what === "destino") ix.keys[1].pubkey = Keypair.generate().publicKey;
    else if (what === "conta de taxa") ix.keys[2].pubkey = Keypair.generate().publicKey;
    else if (what === "sem conta de taxa") ix.keys.splice(2, 1);
    else if (what === "privilégio") ix.keys[2].isWritable = false;
    else ix.data[{ valor: 1, token: 2, slippage: 3 }[what]!]++;
    const b = tx([cuLimit(200_000), cuPrice(1_000), ix, pagadorPhantom()]);
    expect(conferir(a, b)).toMatchObject({ ok: false, motivo: "vinculo_mensagem_diferente" });
  });

  it.each<[string, () => VersionedTransaction, string | RegExp]>([
    ["blockhash trocado", () => tx([...montada(), pagadorPhantom()], { blockhash: Keypair.generate().publicKey.toBase58() }), "blockhash"],
    ["preço do compute alterado", () => tx([cuLimit(200_000), cuPrice(2_000), swap(), pagadorPhantom()]), "original_alterada:1"],
    ["limite de CU menor", () => tx([cuLimit(100_000), cuPrice(1_000), swap(), pagadorPhantom()]), "cu_limite"],
    ["limite de CU acima do teto", () => tx([cuLimit(CU_LIMITE_MAXIMO + 1), cuPrice(1_000), swap(), pagadorPhantom()]), "cu_limite"],
    ["limite de CU elevado sem asserção", () => tx([cuLimit(260_000), cuPrice(1_000), swap()]), "cu_sem_assercao"],
    ["2º SetComputeUnitLimit acrescentado", () => tx([...montada(), cuLimit(300_000), pagadorPhantom()]), "instrucao_extra:3"],
    ["instrução extra não-Lighthouse", () => tx([...montada(), swap(), pagadorPhantom()]), "instrucao_extra:3"],
    ["instrução extra no meio", () => tx([cuLimit(200_000), cuPrice(1_000), cuPrice(5), swap(), pagadorPhantom()]), "original_alterada:2"],
    ["instruções originais reordenadas", () => tx([cuPrice(1_000), cuLimit(200_000), swap(), pagadorPhantom()]), "original_alterada:0"],
    ["instrução original removida", () => tx([cuLimit(200_000), swap(), pagadorPhantom()]), "original_alterada:1"],
    ["rota removida (contas dela somem)", () => tx([cuLimit(200_000), cuPrice(1_000), pagadorPhantom()]), "conta_original_sumiu"],
    ["MemoryWrite inserido", () => tx([...montada(), lh(B([0, 0, 255, 0, 2, 7, ...u64(1n)]), [owner.publicKey])]), "assercao:opcode:0"],
    ["AssertMerkleTree inserido", () => tx([...montada(), lh(B([16, 0, 0, 0, 0]), [owner.publicKey])]), "assercao:opcode:16"],
    ["asserção mal formada", () => tx([...montada(), lh(B([6, 7, 0]), [owner.publicKey])]), "assercao:log:7"],
    ["conta nova GRAVÁVEL na asserção", () => tx([...montada(), lh(PHANTOM_REAL, [Keypair.generate().publicKey], true)]), "conta_nova_com_privilegio"],
    ["asserção torna gravável uma conta só-leitura original", () => tx([...montada(), lh(PHANTOM_TOKEN, [mint], true)]), "privilegio_alterado"],
    ["programa Lighthouse gravável", () => tx([...montada(), new TransactionInstruction({ programId: new PublicKey(LIGHTHOUSE), data: PHANTOM_REAL,
      keys: [{ pubkey: owner.publicKey, isSigner: false, isWritable: false }, { pubkey: new PublicKey(LIGHTHOUSE), isSigner: false, isWritable: true }] })]),
      "conta_nova_com_privilegio"],
  ])("%s", (_, signed, esperado) => {
    const a = tx(montada()), b = signed();
    expect(regra(a, b)).toMatch(esperado);
    const r = conferir(a, b);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("vinculo_mensagem_diferente");
      expect(r.detalhe).toMatch(esperado);
    }
  });

  it("assinante a mais (mesmo com todas as assinaturas válidas) → recusado", () => {
    const outro = Keypair.generate(), a = tx(montada()), ix = swap();
    ix.keys.push({ pubkey: outro.publicKey, isSigner: true, isWritable: false });
    const b = tx([cuLimit(200_000), cuPrice(1_000), ix, pagadorPhantom()], { signers: [outro] });
    expect(validarTransacaoAssinada(wire(b), owner.publicKey.toBase58()).ok).toBe(true);
    expect(regra(a, b)).toBe("assinantes");
  });

  it("conta nova solta (nenhuma asserção a usa) → recusada; sem asserção nenhuma → `sem_extensao`", () => {
    const a = tx(montada());
    const solta = (ixs: TransactionInstruction[]) => {
      const m = tx(ixs).message as MessageV0;
      return assinar(new MessageV0({
        header: { ...m.header, numReadonlyUnsignedAccounts: m.header.numReadonlyUnsignedAccounts + 1 },
        staticAccountKeys: [...m.staticAccountKeys, Keypair.generate().publicKey], recentBlockhash: m.recentBlockhash,
        compiledInstructions: m.compiledInstructions, addressTableLookups: m.addressTableLookups,
      }));
    };
    expect(regra(a, solta([...montada(), pagadorPhantom()]))).toBe("conta_nova_sem_uso");
    expect(regra(a, solta(montada()))).toBe("sem_extensao");
  });

  it("⚠️ instrução original do FIM trocada por asserção (contas dela seguem usadas) → `original_faltando`", () => {
    // Ex.: o cleanup da Jupiter. Nenhuma conta some e nenhum privilégio muda: só a contagem pega.
    const cleanup = () => new TransactionInstruction({ programId: jup, data: B([9]), keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: true }] });
    const a = tx([...montada(), cleanup()]), b = tx([...montada(), pagadorPhantom()]);
    expect(regra(a, b)).toBe("original_faltando:3");
    expect(conferir(a, b)).toMatchObject({ ok: false, motivo: "vinculo_mensagem_diferente", detalhe: "original_faltando:3" });
  });

  it("chave estática repetida → `chave_duplicada`", () => {
    const a = tx(montada()), m = tx([...montada(), pagadorPhantom()]).message as MessageV0;
    const b = assinar(new MessageV0({
      header: { ...m.header, numReadonlyUnsignedAccounts: m.header.numReadonlyUnsignedAccounts + 1 },
      staticAccountKeys: [...m.staticAccountKeys, jup], recentBlockhash: m.recentBlockhash,
      compiledInstructions: m.compiledInstructions, addressTableLookups: m.addressTableLookups,
    }));
    expect(regra(a, b)).toBe("chave_duplicada");
  });

  it("pagador diferente é recusado antes de comparar", () => {
    const a = tx(montada()), outro = Keypair.generate();
    const b = new VersionedTransaction(new TransactionMessage({ payerKey: outro.publicKey, recentBlockhash: block, instructions: [...montada(), pagadorPhantom()] }).compileToV0Message());
    b.sign([outro, owner]);
    expect(conferir(a, b)).toMatchObject({ ok: false, motivo: "vinculo_pagador" });
  });

  it("a mensagem original é evidência AUTENTICADA: ausente, de outra tx ou com HMAC forjado → recusada", () => {
    const a = tx(montada()), b = tx([...montada(), pagadorPhantom()]);
    expect(conferirVinculo(bind(a), b)).toEqual({ ok: false, motivo: "vinculo_mensagem_diferente", detalhe: "original_ausente" });
    expect(conferirVinculo(bind(a), b, Date.now(), original64(b))).toEqual({ ok: false, motivo: "vinculo_mensagem_diferente", detalhe: "original_hash" });
    expect(conferirVinculo(bind(a), b, Date.now(), ` ${original64(a)}`)).toMatchObject({ ok: false, detalhe: "original_hash" });
    expect(conferirVinculo(`${bind(a)}x`, b, Date.now(), original64(a))).toMatchObject({ ok: false, motivo: "vinculo_assinatura" });
  });
});

describe("extensão com tabelas de endereço (ALT)", () => {
  const extra = Keypair.generate().publicKey;
  const tabela = (key = Keypair.generate().publicKey) => new AddressLookupTableAccount({ key, state: {
    deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0, addresses: [recipient, fee, mint, extra],
  } });
  const t = tabela();
  const a = () => tx(montada(), { tables: [t] });

  it("mesma tabela + asserção → aceita; índice SÓ-LEITURA novo usado pela asserção → aceito", () => {
    expect(a().message.addressTableLookups[0].writableIndexes).toEqual([0, 1]);
    expect(conferir(a(), tx([...montada(), tokenPhantom()], { tables: [t] }))).toMatchObject({ ok: true });
    const b = tx([...montada(), lh(PHANTOM_REAL, [extra])], { tables: [t] });
    expect(b.message.addressTableLookups[0].readonlyIndexes).toEqual([2, 3]);
    expect(regra(a(), b)).toBe("ok");
  });

  it("índice GRAVÁVEL novo, tabela trocada ou removida → recusado", () => {
    expect(regra(a(), tx([...montada(), lh(PHANTOM_REAL, [extra], true)], { tables: [t] }))).toBe("alt_gravavel");
    expect(regra(a(), tx([...montada(), pagadorPhantom()], { tables: [tabela()] }))).toBe("alt_tabelas");
    // Sem a tabela, destino e conta de taxa viram chaves estáticas GRAVÁVEIS novas.
    expect(regra(a(), tx([...montada(), pagadorPhantom()]))).toBe("conta_nova_com_privilegio");
  });

  it("índices graváveis permutados (mesmo conjunto, contas trocadas na rota) → recusado", () => {
    const m = tx([...montada(), pagadorPhantom()], { tables: [t] }).message as MessageV0;
    m.addressTableLookups[0].writableIndexes.reverse();   // destino ↔ conta de taxa
    expect(regra(a(), assinar(m))).toMatch(/^original_alterada:2$/);
  });

  it("índice só-leitura ORIGINAL removido → `alt_leitura_sumiu`", () => {
    const m = tx([...montada(), pagadorPhantom()], { tables: [t] }).message as MessageV0;
    expect(m.addressTableLookups[0].readonlyIndexes).toEqual([2]);
    m.addressTableLookups[0].readonlyIndexes = [];
    expect(regra(a(), assinar(m))).toBe("alt_leitura_sumiu");
  });

  it("mais de 64 contas depois da extensão → `contas_demais`", () => {
    const muitas = Array.from({ length: 70 }, () => Keypair.generate().publicKey);
    const grande = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: {
      deactivationSlot: BigInt("18446744073709551615"), lastExtendedSlot: 1, lastExtendedSlotStartIndex: 0,
      addresses: [recipient, fee, mint, ...muitas] } });
    const a0 = tx(montada(), { tables: [grande] });
    const b = tx([...montada(), lh(PHANTOM_REAL, muitas)], { tables: [grande] });
    expect(b.message.staticAccountKeys.length + (b.message as MessageV0).numAccountKeysFromLookups).toBeGreaterThan(64);
    expect(regra(a0, b)).toBe("contas_demais");
  });

  it("índice só-leitura novo que ninguém usa → recusado", () => {
    const m = tx([...montada(), pagadorPhantom()], { tables: [t] }).message as MessageV0;
    m.addressTableLookups[0].readonlyIndexes.push(3);
    expect(regra(a(), assinar(m))).toBe("conta_nova_sem_uso");
  });
});

describe("validação da transação assinada e diagnóstico", () => {
  it("⚠️ regressão da produção (21/10): a tx com a asserção real da Phantom passa na validação", () => {
    const b = tx([...montada(), pagadorPhantom(), tokenPhantom()]);
    expect(validarTransacaoAssinada(wire(b), owner.publicKey.toBase58())).toMatchObject({ ok: true });
  });

  it("instrução Lighthouse proibida → motivo estável + detalhe com posição, opcode, log e contas", () => {
    const b = tx([...montada(), lh(B([0, 0, 255, 0, 2, 7, ...u64(1n)]), [owner.publicKey])]);
    expect(validarTransacaoAssinada(wire(b), owner.publicKey.toBase58()))
      .toEqual({ ok: false, motivo: "lighthouse_instrucao_nao_permitida", detalhe: "ix3:op0:log0:c1:opcode:0" });
  });

  it("programa desconhecido continua recusado", () => {
    const ix = pagadorPhantom(); ix.programId = Keypair.generate().publicKey;
    expect(validarTransacaoAssinada(wire(tx([...montada(), ix])), owner.publicKey.toBase58()).ok).toBe(false);
  });

  it("`formaDaMensagem` descreve a estrutura sem nenhuma chave de conta", () => {
    const b = tx([...montada(), pagadorPhantom()]);
    const f = formaDaMensagem(b);
    expect(f).toContain("L2TE:1:16:6/4");
    expect(f).toContain("JUP6:4:4");
    for (const k of b.message.staticAccountKeys) expect(f).not.toContain(k.toBase58());
    expect(f).not.toContain(b.message.recentBlockhash);
  });
});
