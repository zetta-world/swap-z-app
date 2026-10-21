/**
 * W3 (21/10) — transmissão e status Solana pelo SERVIDOR.
 *
 * As transações aqui são REAIS (v0, assinadas com ed25519) mas assinadas por chaves GERADAS NO
 * TESTE, sem fundos; o RPC é falso. Nenhum teste move fundos.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";

const s = vi.hoisted(() => ({ rl: true }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitDurable: async () => ({ ok: s.rl, retryAfter: 30, remaining: 0, resetAt: 0 }),
  getClientId: () => "ip",
}));

import { consultarStatus, transmitir, validarTransacaoAssinada, assinaturaDe, base58 } from "@/lib/solana/transmissao";
import { POST } from "@/app/api/solana/transmitir/route";
import { GET } from "@/app/api/solana/status/route";

const RPC_SECRETO = "https://mainnet.helius-rpc.com/?api-key=SEGREDO-HELIUS-456";
const JUP = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const BLOCKHASH = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
const dono = Keypair.generate();

/** Transação v0 "de swap": compute budget + instrução da Jupiter v6 (dados fictícios). */
function txSwap(opts: { pagador?: Keypair; assinante?: Keypair; extra?: TransactionInstruction[]; semJupiter?: boolean; dados?: number } = {}) {
  const pagador = opts.pagador ?? dono;
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
    ...(opts.semJupiter ? [] : [new TransactionInstruction({ programId: JUP, keys: [{ pubkey: pagador.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(opts.dados ?? 16, 7) })]),
    ...(opts.extra ?? []),
  ];
  const msg = new TransactionMessage({ payerKey: pagador.publicKey, recentBlockhash: BLOCKHASH, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([opts.assinante ?? pagador]);
  return tx;
}
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

type Corpo = { method: string; params: unknown[] };
let pedidos: { url: string; headers: Headers; corpo: Corpo }[] = [];
let rpc: (c: Corpo) => Response | Promise<Response>;
const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  s.rl = true; pedidos = [];
  vi.stubEnv("HELIUS_RPC_URL", RPC_SECRETO);
  rpc = (c) => ok(c.method === "sendTransaction" ? "?" : null);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as Corpo;
    pedidos.push({ url: String(url), headers: new Headers(init?.headers), corpo });
    return rpc(corpo);
  }));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("validação da transação assinada (antes de qualquer RPC)", () => {
  it("swap v0 assinado pelo pagador declarado → ok, e a assinatura pública é a 1ª assinatura", () => {
    const tx = txSwap();
    const v = validarTransacaoAssinada(b64(tx), dono.publicKey.toBase58());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.assinatura).toBe(assinaturaDe(tx));
  });

  it("⚠️ NÃO-CUSTODIAL: sem assinatura da carteira → recusada (o servidor não assina nada)", () => {
    const msg = txSwap().message;
    const naoAssinada = new VersionedTransaction(msg);
    expect(validarTransacaoAssinada(b64(naoAssinada), dono.publicKey.toBase58())).toEqual({ ok: false, motivo: "nao_assinada" });
  });

  it("⚠️ um byte alterado depois da assinatura → assinatura inválida", () => {
    const bytes = Buffer.from(txSwap().serialize());
    bytes[bytes.length - 3] ^= 0xff;
    expect(validarTransacaoAssinada(bytes.toString("base64"), dono.publicKey.toBase58())).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  it("assinatura que não é do pagador sobre esta mensagem → assinatura inválida", () => {
    const tx = txSwap();
    tx.signatures[0] = Uint8Array.from(Buffer.alloc(64, 1));
    expect(validarTransacaoAssinada(b64(tx), dono.publicKey.toBase58())).toMatchObject({ ok: false, motivo: "assinatura_invalida" });
  });

  it("pagador diferente da carteira declarada → recusada", () => {
    expect(validarTransacaoAssinada(b64(txSwap()), Keypair.generate().publicKey.toBase58())).toEqual({ ok: false, motivo: "pagador" });
  });

  it("sem instrução da Jupiter v6 → não é um swap da Z-SWAP", () => {
    const tx = txSwap({ semJupiter: true, extra: [SystemProgram.transfer({ fromPubkey: dono.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 })] });
    expect(validarTransacaoAssinada(b64(tx), dono.publicKey.toBase58())).toEqual({ ok: false, motivo: "sem_jupiter" });
  });

  it("programa fora da lista → recusada, dizendo QUAL (para decidir com evidência)", () => {
    const estranho = Keypair.generate().publicKey;
    const tx = txSwap({ extra: [new TransactionInstruction({ programId: estranho, keys: [], data: Buffer.alloc(1) })] });
    expect(validarTransacaoAssinada(b64(tx), dono.publicKey.toBase58())).toEqual({ ok: false, motivo: `programa_nao_permitido:${estranho.toBase58()}` });
  });

  it("transação legada (não v0) → recusada", () => {
    const t = new Transaction({ feePayer: dono.publicKey, recentBlockhash: BLOCKHASH })
      .add(new TransactionInstruction({ programId: JUP, keys: [], data: Buffer.alloc(4) }));
    t.sign(dono);
    expect(validarTransacaoAssinada(t.serialize().toString("base64"), dono.publicKey.toBase58())).toMatchObject({ ok: false });
  });

  it("acima de 1232 bytes, lixo, vazio, owner inválido → recusada", () => {
    const grande = Buffer.alloc(1300, 1).toString("base64");
    expect(validarTransacaoAssinada(grande, dono.publicKey.toBase58())).toEqual({ ok: false, motivo: "tamanho" });
    expect(validarTransacaoAssinada("@@@", dono.publicKey.toBase58())).toMatchObject({ ok: false });
    expect(validarTransacaoAssinada("", dono.publicKey.toBase58())).toEqual({ ok: false, motivo: "tamanho" });
    expect(validarTransacaoAssinada(b64(txSwap()), "0xabc")).toEqual({ ok: false, motivo: "owner" });
  });
});

describe("envio — 3 desfechos, e HTTP não é sinônimo de 'não enviou'", () => {
  const validada = () => { const v = validarTransacaoAssinada(b64(txSwap()), dono.publicKey.toBase58()); if (!v.ok) throw new Error(v.motivo); return v; };

  it("sucesso: RPC devolve a MESMA assinatura → enviada; pelo RPC do servidor, sem Origin, preflight ligado, UMA chamada", async () => {
    const v = validada();
    rpc = () => ok(v.assinatura);
    expect(await transmitir(v)).toEqual({ estado: "enviada", assinatura: v.assinatura });
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe(RPC_SECRETO);
    expect(pedidos[0].headers.has("origin")).toBe(false);
    expect(pedidos[0].corpo.method).toBe("sendTransaction");
    expect(pedidos[0].corpo.params[1]).toMatchObject({ encoding: "base64", skipPreflight: false });
  });

  for (const [rotulo, resp, estado, motivo] of [
    ["HTTP 403 (o que o RPC público fez com o dono)", () => new Response('{"error":{"code":403}}', { status: 403 }), "nao_enviada", "proibido"],
    ["JSON-RPC 403 em HTTP 200", () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: 403, message: "Access forbidden" } }), "nao_enviada", "proibido"],
    ["HTTP 429", () => new Response("x", { status: 429 }), "nao_enviada", "limite"],
    ["preflight falhou (-32002)", () => Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "Transaction simulation failed", data: { err: { InstructionError: [1, { Custom: 6001 }] } } } }), "nao_enviada", 'simulacao: {"InstructionError":[1,{"Custom":6001}]}'],
    ["HTTP 500", () => new Response("x", { status: 500 }), "incerta", "http_500"],
    ["timeout", () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); }, "incerta", "timeout"],
    ["queda de conexão", () => { throw new TypeError("fetch failed"); }, "incerta", "conexao"],
    ["resposta ilegível", () => new Response("<html>", { status: 200 }), "incerta", "resposta_ilegivel"],
    ["RPC devolve OUTRA assinatura", () => ok("x".repeat(88)), "incerta", "assinatura_divergente"],
  ] as const) {
    it(`${rotulo} → ${estado} (${motivo}), sempre com a assinatura pública`, async () => {
      const v = validada();
      rpc = resp as () => Response;
      expect(await transmitir(v)).toMatchObject({ estado, motivo, assinatura: v.assinatura });
      expect(pedidos).toHaveLength(1);   // sem retry interno
    });
  }
});

describe("status on-chain — confirmada só com err nulo", () => {
  const SIG = base58(new Uint8Array(64).fill(7));
  const status = (v: unknown) => (c: Corpo) => c.method === "getSignatureStatuses" ? ok({ context: { slot: 1 }, value: [v] }) : ok(1000);

  it("confirmed/finalized com err nulo → confirmada", async () => {
    rpc = status({ slot: 9, err: null, confirmationStatus: "confirmed" });
    expect(await consultarStatus(SIG, 2000)).toMatchObject({ estado: "confirmada" });
    rpc = status({ slot: 9, err: null, confirmationStatus: "finalized" });
    expect(await consultarStatus(SIG, 2000)).toMatchObject({ estado: "confirmada", confirmacao: "finalized" });
    expect(pedidos[0].corpo.params[1]).toEqual({ searchTransactionHistory: true });
  });

  it("⚠️ pousou COM erro de execução → falhou_na_rede, mesmo 'confirmed'", async () => {
    rpc = status({ slot: 9, err: { InstructionError: [2, { Custom: 6001 }] }, confirmationStatus: "confirmed" });
    expect(await consultarStatus(SIG, 2000)).toMatchObject({ estado: "falhou_na_rede", erro: '{"InstructionError":[2,{"Custom":6001}]}' });
  });

  it("'processed' ainda pode ser descartada → pendente", async () => {
    rpc = status({ slot: 9, err: null, confirmationStatus: "processed" });
    expect(await consultarStatus(SIG, 2000)).toMatchObject({ estado: "pendente" });
  });

  it("sem registro e altura ≤ lastValidBlockHeight → pendente (ainda pode pousar)", async () => {
    rpc = status(null);
    expect(await consultarStatus(SIG, 1000)).toEqual({ estado: "pendente", alturaAtual: 1000 });
  });

  it("⚠️ sem registro e altura > lastValidBlockHeight → expirada (não pode mais pousar)", async () => {
    rpc = status(null);
    expect(await consultarStatus(SIG, 999)).toEqual({ estado: "expirada", alturaAtual: 1000 });
  });

  it("RPC 403/timeout → desconhecido (NUNCA 'falhou')", async () => {
    rpc = () => new Response("x", { status: 403 });
    expect(await consultarStatus(SIG, 999)).toEqual({ estado: "desconhecido", motivo: "http_403" });
    rpc = () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); };
    expect(await consultarStatus(SIG, 999)).toEqual({ estado: "desconhecido", motivo: "timeout" });
  });
});

const postar = (corpo: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest("http://localhost/api/solana/transmitir", { method: "POST", body: typeof corpo === "string" ? corpo : JSON.stringify(corpo), headers }));

describe("rota /api/solana/transmitir", () => {
  it("transmite e devolve estado + assinatura; nada de transação nem credencial na resposta/log", async () => {
    const tx = txSwap();
    rpc = () => ok(assinaturaDe(tx));
    const r = await postar({ tx: b64(tx), owner: dono.publicKey.toBase58() });
    expect(r.status).toBe(200);
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ ok: true, estado: "enviada", assinatura: assinaturaDe(tx) });
    expect(corpo).not.toContain("SEGREDO");
    expect(corpo).not.toContain(b64(tx).slice(0, 40));
    expect(JSON.stringify([vi.mocked(console.info).mock.calls, vi.mocked(console.warn).mock.calls])).not.toContain("SEGREDO");
  });

  it("transação inválida → 400 e o RPC NÃO é chamado", async () => {
    const r = await postar({ tx: b64(txSwap()), owner: Keypair.generate().publicKey.toBase58() });
    expect(r.status).toBe(400);
    expect(pedidos).toHaveLength(0);
  });

  it("corpo grande → 413; rate limit → 429 — sem tocar o RPC", async () => {
    expect((await postar("x".repeat(5000))).status).toBe(413);
    s.rl = false;
    expect((await postar({ tx: b64(txSwap()), owner: dono.publicKey.toBase58() })).status).toBe(429);
    expect(pedidos).toHaveLength(0);
  });

  it("não é proxy: campos extras não escolhem método nem RPC", async () => {
    const tx = txSwap();
    rpc = () => ok(assinaturaDe(tx));
    await postar({ tx: b64(tx), owner: dono.publicKey.toBase58(), method: "requestAirdrop", rpc: "https://evil" });
    expect(pedidos.map((p) => p.corpo.method)).toEqual(["sendTransaction"]);
    expect(pedidos[0].url).toBe(RPC_SECRETO);
  });
});

describe("⚠️ preservação: o servidor transmite BYTE A BYTE o que a carteira assinou", () => {
  it("a transação enviada ao RPC é idêntica à recebida (taxa Z-SWAP e instrução de swap intactas)", async () => {
    const tx = txSwap({ dados: 72 });   // instrução de swap com dados de taxa (formato da Jupiter)
    rpc = () => ok(assinaturaDe(tx));
    await postar({ tx: b64(tx), owner: dono.publicKey.toBase58() });
    expect(pedidos[0].corpo.params[0]).toBe(b64(tx));
  });
});

describe("sincronização de operações (volume/receita) — só confirmada, só da carteira certa", () => {
  it("useOperationSync envia apenas status confirmed E apenas da carteira conectada", async () => {
    const { readFileSync } = await import("node:fs");
    const t = readFileSync("src/lib/hooks/useOperationSync.ts", "utf8");
    expect(t).toMatch(/e\.status === "confirmed"/);
    expect(t).toMatch(/\(!e\.wallet \|\| e\.wallet === wallet\)/);
  });
});

describe("rota /api/solana/status", () => {
  it("assinatura inválida → 400 (inclusive base58 que não tem 64 bytes — achado no preview); válida → estado", async () => {
    expect((await GET(new NextRequest("http://localhost/api/solana/status?sig=abc"))).status).toBe(400);
    expect((await GET(new NextRequest(`http://localhost/api/solana/status?sig=${"1".repeat(30)}${"2".repeat(57)}`))).status).toBe(400);
    expect(pedidos).toHaveLength(0);
    rpc = (c) => c.method === "getSignatureStatuses" ? ok({ value: [null] }) : ok(1000);
    const r = await GET(new NextRequest(`http://localhost/api/solana/status?sig=${base58(new Uint8Array(64).fill(7))}&lvbh=999`));
    expect(await r.json()).toMatchObject({ ok: true, estado: "expirada" });
  });
});
