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
/**
 * W3-C: banco falso com a MESMA semântica de `solana_tx_reservar`/`solana_tx_marcar` (0077). A
 * atomicidade real (advisory lock + índice único) é provada contra PostgreSQL em
 * `supabase/tests/24_solana_tx_em_voo.sql` — aqui se prova o comportamento da ROTA.
 */
const banco = vi.hoisted(() => {
  type Linha = { carteira: string; assinatura: string; lvbh: number; estado: string; desfecho: string | null; hash?: string };
  const b = { linhas: [] as Linha[], fora: false, consultaFora: false, chamadas: [] as string[] };
  const rpc = async (nome: string, a: Record<string, unknown>) => {
    b.chamadas.push(nome);
    if (b.fora) return { data: null, error: { message: "banco fora" } };
    if (nome === "solana_tx_reservar") {
      const propria = b.linhas.find((l) => l.assinatura === a.p_assinatura);
      if (propria) {
        if (propria.estado !== "resolvida") return { data: { resultado: "retransmissao" }, error: null };
        if (propria.desfecho !== "nao_enviada") return { data: { resultado: "ja_resolvida", desfecho: propria.desfecho }, error: null };
      }
      const aberta = b.linhas.find((l) => l.carteira === a.p_carteira && l.estado !== "resolvida" && l.assinatura !== a.p_assinatura);
      if (aberta) return { data: { resultado: "bloqueada", assinatura: aberta.assinatura, valido_ate_bloco: aberta.lvbh }, error: null };
      if (propria) { propria.estado = "reservada"; propria.desfecho = null; }
      else b.linhas.push({ carteira: String(a.p_carteira), assinatura: String(a.p_assinatura), lvbh: Number(a.p_valido_ate_bloco), estado: "reservada", desfecho: null, hash: String(a.p_hash) });
      return { data: { resultado: "reservada" }, error: null };
    }
    if (nome === "solana_tx_marcar") {
      const l = b.linhas.find((x) => x.assinatura === a.p_assinatura && x.estado !== "resolvida");
      if (!l) return { data: false, error: null };
      l.estado = String(a.p_estado); l.desfecho = (a.p_desfecho as string | null) ?? null;
      return { data: true, error: null };
    }
    return { data: null, error: { message: "rpc desconhecida" } };
  };
  /**
   * `from("solana_tx_em_voo").select(…).eq(…).eq(…).neq(…).or("a.op.v,b.op.v").limit(n)` — a consulta "uma cotação,
   * um swap", com a semântica do PostgREST: filtros em AND, `or` entre os termos, `limit` corta o resultado.
   */
  const from = (tabela: string) => {
    type Termo = [op: string, coluna: string, valor: unknown];
    const filtros: Termo[] = [];
    let ou: Termo[] | null = null;
    const coluna = (l: Linha, c: string) => c === "hash_mensagem" ? l.hash : (l as Record<string, unknown>)[c];
    const vale = (l: Linha, [op, c, v]: Termo) => op === "eq" ? coluna(l, c) === v : op === "neq" ? coluna(l, c) !== v : false;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros.push(["eq", c, v]); return q; },
      neq: (c: string, v: unknown) => { filtros.push(["neq", c, v]); return q; },
      or: (expr: string) => { ou = expr.split(",").map((t) => { const [c, op, v] = t.split("."); return [op, c, v] as Termo; }); return q; },
      limit: async (n: number) => {
        b.chamadas.push(`from:${tabela}`);
        if (b.fora || b.consultaFora || tabela !== "solana_tx_em_voo") return { data: null, error: { message: "banco fora" } };
        const data = b.linhas.filter((l) => filtros.every((f) => vale(l, f)) && (!ou || ou.some((f) => vale(l, f))))
          .slice(0, n).map((l) => ({ assinatura: l.assinatura, estado: l.estado, desfecho: l.desfecho }));
        return { data, error: null };
      },
    };
    return q;
  };
  return { b, rpc, from };
});
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({ rpc: banco.rpc, from: banco.from }) }));
vi.mock("@/lib/rate-limit", () => ({
  rateLimitDurable: async () => ({ ok: s.rl, retryAfter: 30, remaining: 0, resetAt: 0 }),
  getClientId: () => "ip",
}));

import { consultarStatus, transmitir, validarTransacaoAssinada, assinaturaDe, base58 } from "@/lib/solana/transmissao";
import { POST } from "@/app/api/solana/transmitir/route";
import { conferirVinculo, emitirVinculo } from "@/lib/solana/vinculo";
import { GET } from "@/app/api/solana/status/route";
import { reservarTransmissao } from "@/lib/solana/em-voo";
import { createHash } from "node:crypto";

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
/** O vínculo que o SERVIDOR emitiria na cotação para a mensagem desta transação. */
const vin = (tx: VersionedTransaction, bps = 100, f: string | null = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo") =>
  emitirVinculo({ mensagem: tx.message.serialize(), owner: tx.message.staticAccountKeys[0].toBase58(), bps, feeAccount: f, validoAteBloco: LVBH })!;
const LVBH = 300_000_000;

type Corpo = { method: string; params: unknown[] };
let pedidos: { url: string; headers: Headers; corpo: Corpo }[] = [];
let rpc: (c: Corpo) => Response | Promise<Response>;
const ok = (result: unknown) => Response.json({ jsonrpc: "2.0", id: 1, result });

beforeEach(() => {
  s.rl = true; pedidos = [];
  banco.b.linhas = []; banco.b.fora = false; banco.b.consultaFora = false; banco.b.chamadas = [];
  vi.stubEnv("HELIUS_RPC_URL", RPC_SECRETO);
  vi.stubEnv("AUTH_JWT_SECRET", "segredo-de-sessao-de-teste-0123456789");
  vi.stubEnv("TX_VINCULO_SECRET", "");
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
    expect(validarTransacaoAssinada(grande, dono.publicKey.toBase58())).toEqual({ ok: false, motivo: "tamanho", detalhe: `b64:${grande.length}` });
    // 1233–1236 bytes passam no corte do base64 e caem no de bytes — com o tamanho no detalhe.
    expect(validarTransacaoAssinada(Buffer.alloc(1234, 1).toString("base64"), dono.publicKey.toBase58()))
      .toEqual({ ok: false, motivo: "formato", detalhe: "bytes:1234" });
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

  it("⚠️ erro visto só em 'processed' (ou sem status) NÃO é falha final → pendente; status desconhecido → desconhecido", async () => {
    rpc = status({ slot: 9, err: { InstructionError: [2, { Custom: 6001 }] }, confirmationStatus: "processed" });
    expect(await consultarStatus(SIG, 2000)).toEqual({ estado: "pendente", alturaAtual: null });
    rpc = status({ slot: 9, err: { InstructionError: [2, { Custom: 6001 }] }, confirmationStatus: null });
    expect(await consultarStatus(SIG, 2000)).toEqual({ estado: "pendente", alturaAtual: null });
    rpc = status({ slot: 9, err: { InstructionError: [2, { Custom: 6001 }] }, confirmationStatus: "talvez" });
    expect(await consultarStatus(SIG, 2000)).toEqual({ estado: "desconhecido", motivo: "resposta_inconsistente" });
    rpc = status({ slot: 9, err: { InstructionError: [2, { Custom: 6001 }] }, confirmationStatus: "finalized" });
    expect(await consultarStatus(SIG, 2000)).toMatchObject({ estado: "falhou_na_rede" });
  });

  it("sem registro e altura ≤ lastValidBlockHeight → pendente (ainda pode pousar)", async () => {
    rpc = status(null);
    expect(await consultarStatus(SIG, 1000)).toEqual({ estado: "pendente", alturaAtual: 1000 });
  });

  it("⚠️ sem registro e altura > lastValidBlockHeight → expirada (não pode mais pousar)", async () => {
    rpc = status(null);
    expect(await consultarStatus(SIG, 999)).toEqual({ estado: "expirada", alturaAtual: 1000 });
  });

  it("⚠️ revisão: resposta SEM o campo `err` (ou undefined) NUNCA vira confirmada", async () => {
    rpc = status({ slot: 9, confirmationStatus: "finalized" });
    expect(await consultarStatus(SIG, 2000)).toEqual({ estado: "desconhecido", motivo: "resposta_incompleta" });
    rpc = status({ slot: 9, err: undefined, confirmationStatus: "confirmed" });
    expect(await consultarStatus(SIG, 2000)).toEqual({ estado: "desconhecido", motivo: "resposta_incompleta" });
  });

  it("⚠️ revisão: estrutura inconsistente → desconhecido (nunca confirmada)", async () => {
    for (const result of [{ value: [] }, { value: [null, null] }, { value: "x" }, {}, { value: [{ err: null, confirmationStatus: "finalized" }] },
      { value: [{ slot: "9", err: null, confirmationStatus: "finalized" }] }, { value: [{ slot: 9, err: null, confirmationStatus: "talvez" }] }, { value: [7] }]) {
      rpc = (c) => c.method === "getSignatureStatuses" ? ok(result) : ok(1);
      const r = await consultarStatus(SIG, 2000);
      expect(r.estado, JSON.stringify(result)).toBe("desconhecido");
    }
  });

  it("`confirmationStatus: null` com err nulo → pendente (não confirmada)", async () => {
    rpc = status({ slot: 9, err: null, confirmationStatus: null });
    expect(await consultarStatus(SIG, 2000)).toMatchObject({ estado: "pendente" });
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
    const r = await postar({ tx: b64(tx), owner: dono.publicKey.toBase58(), vinculo: vin(tx) });
    expect(r.status).toBe(200);
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ ok: true, estado: "enviada", assinatura: assinaturaDe(tx) });
    expect(corpo).not.toContain("SEGREDO");
    expect(corpo).not.toContain(b64(tx).slice(0, 40));
    expect(JSON.stringify([vi.mocked(console.info).mock.calls, vi.mocked(console.warn).mock.calls])).not.toContain("SEGREDO");
  });

  it("transação inválida → 400 marcada `antes_do_rpc`, e o RPC NÃO é chamado", async () => {
    const r = await postar({ tx: b64(txSwap()), owner: Keypair.generate().publicKey.toBase58() });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ ok: false, fase: "antes_do_rpc" });
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
    await postar({ tx: b64(tx), owner: dono.publicKey.toBase58(), vinculo: vin(tx), method: "requestAirdrop", rpc: "https://evil" });
    expect(pedidos.map((p) => p.corpo.method)).toEqual(["sendTransaction"]);
    expect(pedidos[0].url).toBe(RPC_SECRETO);
  });
});

describe("⚠️ preservação: o servidor transmite BYTE A BYTE o que a carteira assinou", () => {
  it("a transação enviada ao RPC é idêntica à recebida (taxa Z-SWAP e instrução de swap intactas)", async () => {
    const tx = txSwap({ dados: 72 });   // instrução de swap com dados de taxa (formato da Jupiter)
    rpc = () => ok(assinaturaDe(tx));
    await postar({ tx: b64(tx), owner: dono.publicKey.toBase58(), vinculo: vin(tx) });
    expect(pedidos[0].corpo.params[0]).toBe(b64(tx));
  });
});

describe("sincronização de operações (volume/receita) — só confirmada, só da carteira certa", () => {
  it("useOperationSync envia apenas status confirmed E apenas da carteira conectada", async () => {
    const { readFileSync } = await import("node:fs");
    const t = readFileSync("src/lib/hooks/useOperationSync.ts", "utf8");
    expect(t).toMatch(/e\.status === "confirmed"/);
    expect(t).toMatch(/pendentesParaSincronizar\(entries, synced, conectadas\)/);
    expect(t).toMatch(/wallet:    e\.wallet,/);   // a carteira de ORIGEM, nunca a conectada
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

describe("⚠️⚠️ revisão: vínculo cotação ↔ transação (taxa decidida no servidor)", () => {
  const owner = () => dono.publicKey.toBase58();

  it("sem vínculo → recusada antes do RPC", async () => {
    const r = await postar({ tx: b64(txSwap()), owner: owner() });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ fase: "antes_do_rpc", erro: "vinculo_ausente" });
    expect(pedidos).toHaveLength(0);
  });

  it("⚠️ transação ADULTERADA (ex.: sem a taxa) e RE-ASSINADA pela carteira → assinatura válida, mas mensagem ≠ cotada → recusada", async () => {
    const cotada = txSwap({ dados: 72 });                 // com dados de taxa
    const adulterada = txSwap({ dados: 56 });             // "sem taxa", assinada de verdade pelo dono
    expect(validarTransacaoAssinada(b64(adulterada), owner()).ok).toBe(true);   // a assinatura sozinha não pega
    const r = await postar({ tx: b64(adulterada), owner: owner(), vinculo: vin(cotada) });
    expect(await r.json()).toMatchObject({ erro: "vinculo_mensagem_diferente" });
    expect(pedidos).toHaveLength(0);
  });

  it("vínculo forjado (sem o segredo) → recusado", async () => {
    const tx = txSwap();
    const [corpo] = vin(tx).split(".");
    const forjado = `${corpo}.${Buffer.alloc(32, 9).toString("base64url")}`;
    expect(await (await postar({ tx: b64(tx), owner: owner(), vinculo: forjado })).json()).toMatchObject({ erro: "vinculo_assinatura" });
  });

  it("corpo do vínculo trocado (ex.: bps 0 → 100) com a assinatura antiga → recusado", async () => {
    const tx = txSwap();
    const [, mac] = vin(tx, 0, null).split(".");
    const d = { ...JSON.parse(Buffer.from(vin(tx, 0, null).split(".")[0], "base64url").toString()), b: 100, f: "x" };
    const trocado = `${Buffer.from(JSON.stringify(d)).toString("base64url")}.${mac}`;
    expect(await (await postar({ tx: b64(tx), owner: owner(), vinculo: trocado })).json()).toMatchObject({ erro: "vinculo_assinatura" });
  });

  it("vínculo expirado → recusado", () => {
    const tx = txSwap();
    expect(conferirVinculo(vin(tx), tx, Date.now() + 4 * 60_000)).toEqual({ ok: false, motivo: "vinculo_expirado" });
  });

  it("vínculo de OUTRO pagador → recusado", () => {
    const outro = Keypair.generate();
    const txOutro = txSwap({ pagador: outro });
    const tx = txSwap();
    const v = emitirVinculo({ mensagem: tx.message.serialize(), owner: outro.publicKey.toBase58(), bps: 100, feeAccount: "f", validoAteBloco: LVBH })!;
    expect(conferirVinculo(v, tx)).toEqual({ ok: false, motivo: "vinculo_pagador" });
    void txOutro;
  });

  it("fail-open legítimo (servidor decidiu SEM taxa: b=0, f=null) → aceito", async () => {
    const tx = txSwap();
    rpc = () => ok(assinaturaDe(tx));
    const r = await postar({ tx: b64(tx), owner: owner(), vinculo: vin(tx, 0, null) });
    expect(await r.json()).toMatchObject({ ok: true, estado: "enviada" });
  });

  it("sem segredo no servidor → nada é emitido e a transmissão recusa (falha fechada)", async () => {
    vi.stubEnv("AUTH_JWT_SECRET", "");
    const tx = txSwap();
    expect(emitirVinculo({ mensagem: tx.message.serialize(), owner: owner(), bps: 0, feeAccount: null, validoAteBloco: LVBH })).toBeNull();
    expect(await (await postar({ tx: b64(tx), owner: owner(), vinculo: "a.b" })).json()).toMatchObject({ erro: "vinculo_indisponivel" });
  });

  it("o token não carrega segredo nem a transação: só hash, pagador, bps, conta, validade", () => {
    const tx = txSwap();
    const d = JSON.parse(Buffer.from(vin(tx).split(".")[0], "base64url").toString());
    expect(Object.keys(d).sort()).toEqual(["b", "f", "h", "l", "o", "v", "x"]);
    expect(JSON.stringify(d)).not.toContain("segredo");
  });
});

describe("W3-C · trava DURÁVEL por carteira (entre aparelhos)", () => {
  const owner = () => dono.publicKey.toBase58();
  const assinaturasEnviadas = () => pedidos.filter((p) => p.corpo.method === "sendTransaction").length;

  it("⚠️ reprodução do achado: 2 transações DIFERENTES da mesma carteira (2 aparelhos) → só a 1ª vai ao RPC", async () => {
    const a = txSwap({ dados: 16 }), b = txSwap({ dados: 17 });
    rpc = (c) => c.method === "sendTransaction" ? ok(c.params[0] === b64(a) ? assinaturaDe(a) : assinaturaDe(b))
      : c.method === "getSignatureStatuses" ? ok({ value: [null] }) : ok(LVBH - 10);   // A ainda pode pousar
    expect(await (await postar({ tx: b64(a), owner: owner(), vinculo: vin(a) })).json()).toMatchObject({ estado: "enviada" });
    const r = await postar({ tx: b64(b), owner: owner(), vinculo: vin(b) });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ fase: "antes_do_rpc", erro: "anterior_em_aberto", assinaturaEmAberto: assinaturaDe(a) });
    expect(assinaturasEnviadas()).toBe(1);
  });

  it("retransmissão da MESMA transação é permitida (a rede aceita a assinatura uma vez só)", async () => {
    const a = txSwap();
    rpc = (c) => c.method === "sendTransaction" ? ok(assinaturaDe(a)) : ok(null);
    await postar({ tx: b64(a), owner: owner(), vinculo: vin(a) });
    expect(await (await postar({ tx: b64(a), owner: owner(), vinculo: vin(a) })).json()).toMatchObject({ estado: "enviada" });
    expect(assinaturasEnviadas()).toBe(2);
  });

  it("⚠️ SEM TTL: a anterior continua em aberto enquanto a altura não passou do valido_ate_bloco GRAVADO", async () => {
    const a = txSwap({ dados: 16 }), b = txSwap({ dados: 18 });
    banco.b.linhas.push({ carteira: owner(), assinatura: assinaturaDe(a), lvbh: LVBH, estado: "incerta", desfecho: null });
    rpc = (c) => c.method === "getSignatureStatuses" ? ok({ value: [null] }) : c.method === "getBlockHeight" ? ok(LVBH) : ok(assinaturaDe(b));
    expect((await postar({ tx: b64(b), owner: owner(), vinculo: vin(b) })).status).toBe(409);
    expect(assinaturasEnviadas()).toBe(0);
  });

  it("a anterior EXPIROU (altura > valido_ate_bloco gravado, sem registro on-chain) → encerra e a nova vai", async () => {
    const a = txSwap({ dados: 16 }), b = txSwap({ dados: 19 });
    banco.b.linhas.push({ carteira: owner(), assinatura: assinaturaDe(a), lvbh: LVBH, estado: "incerta", desfecho: null });
    rpc = (c) => c.method === "getSignatureStatuses" ? ok({ value: [null] }) : c.method === "getBlockHeight" ? ok(LVBH + 1) : ok(assinaturaDe(b));
    expect(await (await postar({ tx: b64(b), owner: owner(), vinculo: vin(b) })).json()).toMatchObject({ estado: "enviada" });
    expect(banco.b.linhas.find((l) => l.assinatura === assinaturaDe(a))).toMatchObject({ estado: "resolvida", desfecho: "expirada" });
  });

  it("a anterior CONFIRMOU on-chain → encerra e a nova vai", async () => {
    const a = txSwap({ dados: 16 }), b = txSwap({ dados: 20 });
    banco.b.linhas.push({ carteira: owner(), assinatura: assinaturaDe(a), lvbh: LVBH, estado: "enviada", desfecho: null });
    rpc = (c) => c.method === "getSignatureStatuses" ? ok({ value: [{ slot: 9, err: null, confirmationStatus: "confirmed" }] }) : ok(assinaturaDe(b));
    expect(await (await postar({ tx: b64(b), owner: owner(), vinculo: vin(b) })).json()).toMatchObject({ estado: "enviada" });
  });

  it("RPC fora ao checar a anterior → continua bloqueada (desconhecido não libera)", async () => {
    const a = txSwap({ dados: 16 }), b = txSwap({ dados: 21 });
    banco.b.linhas.push({ carteira: owner(), assinatura: assinaturaDe(a), lvbh: LVBH, estado: "incerta", desfecho: null });
    rpc = () => new Response("x", { status: 502 });
    expect((await postar({ tx: b64(b), owner: owner(), vinculo: vin(b) })).status).toBe(409);
  });

  it("⚠️ banco fora → FALHA FECHADA: 503 antes do RPC, nada transmitido", async () => {
    banco.b.fora = true;
    const a = txSwap();
    const r = await postar({ tx: b64(a), owner: owner(), vinculo: vin(a) });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ fase: "antes_do_rpc", erro: "trava_indisponivel" });
    expect(assinaturasEnviadas()).toBe(0);
  });

  it("recusa certa do RPC (preflight) → encerra como nao_enviada e a carteira fica livre", async () => {
    const a = txSwap({ dados: 16 }), b = txSwap({ dados: 22 });
    rpc = (c) => c.method === "sendTransaction" && c.params[0] === b64(a)
      ? Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "sim", data: { err: "x" } } })
      : ok(assinaturaDe(b));
    expect(await (await postar({ tx: b64(a), owner: owner(), vinculo: vin(a) })).json()).toMatchObject({ estado: "nao_enviada" });
    expect(await (await postar({ tx: b64(b), owner: owner(), vinculo: vin(b) })).json()).toMatchObject({ estado: "enviada" });
  });

  it("⚠️ terceiro não trava a carteira de outra pessoa: sem a assinatura dela nada é reservado", async () => {
    const forjada = txSwap();
    forjada.signatures[0] = new Uint8Array(64).fill(9);   // pagador = dono, assinatura que NÃO é dele
    const r = await postar({ tx: b64(forjada), owner: owner(), vinculo: vin(forjada) });
    expect(r.status).toBe(400);
    expect(banco.b.chamadas).toEqual([]);
  });

  it("vínculo sem `l` (formato antigo) → recusado antes de reservar", async () => {
    const tx = txSwap();
    const [corpo] = vin(tx).split(".");
    const d = JSON.parse(Buffer.from(corpo, "base64url").toString()); delete d.l;
    const c2 = Buffer.from(JSON.stringify(d)).toString("base64url");
    const { createHmac } = await import("node:crypto");
    const k = createHmac("sha256", "segredo-de-sessao-de-teste-0123456789").update("zswap:tx-vinculo:v1").digest();
    const tok = `${c2}.${createHmac("sha256", k).update(c2).digest("base64url")}`;
    expect(await (await postar({ tx: b64(tx), owner: owner(), vinculo: tok })).json()).toMatchObject({ erro: "vinculo_formato" });
    expect(banco.b.chamadas).toEqual([]);
  });

  it("status: confirmada encerra a trava; ⚠️ `expirada` com lvbh DA URL não encerra", async () => {
    const a = txSwap();
    banco.b.linhas.push({ carteira: owner(), assinatura: assinaturaDe(a), lvbh: LVBH, estado: "enviada", desfecho: null });
    rpc = (c) => c.method === "getSignatureStatuses" ? ok({ value: [null] }) : ok(LVBH - 5);
    await GET(new NextRequest(`http://x/api/solana/status?sig=${assinaturaDe(a)}&lvbh=1`));
    expect(banco.b.linhas[0].estado).toBe("enviada");
    rpc = () => ok({ value: [{ slot: 9, err: null, confirmationStatus: "finalized" }] });
    await GET(new NextRequest(`http://x/api/solana/status?sig=${assinaturaDe(a)}`));
    expect(banco.b.linhas[0]).toMatchObject({ estado: "resolvida", desfecho: "confirmada" });
  });
});


describe("Lighthouse passa pelo vínculo e pela reserva W3-C", () => {
  it("extensão autenticada transmite bytes assinados exatos; outra assinatura permanece bloqueada", async () => {
    const original = txSwap();
    const extra = new TransactionInstruction({
      programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"),
      keys: [{ pubkey: dono.publicKey, isSigner: false, isWritable: false }],
      data: Buffer.from([5, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0]),
    });
    const signed = txSwap({ extra: [extra] });
    rpc = () => ok(assinaturaDe(signed));
    const request = (t: VersionedTransaction) => POST(new NextRequest("http://x/api/solana/transmitir", {
      method: "POST", body: JSON.stringify({tx: b64(t), owner: dono.publicKey.toBase58(), vinculo: vin(original),
        mensagemOriginal: Buffer.from(original.message.serialize()).toString("base64")}),
    }));
    const r = await request(signed);
    expect(await r.json()).toMatchObject({estado:"enviada", assinatura:assinaturaDe(signed)});
    expect(pedidos[0].corpo.params[0]).toBe(b64(signed));
    expect(banco.b.chamadas).toContain("solana_tx_reservar");
    extra.data[3] = 101;
    const second = txSwap({extra:[extra]});
    expect((await request(second)).status).toBe(409);
    expect(pedidos.filter(p=>p.corpo.method==="sendTransaction")).toHaveLength(1);
  });
});

describe("Lighthouse v2 (24/10): o formato REAL da Phantom pela rota", () => {
  const L = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
  /** AssertAccountInfoMulti, log 4, [KnownOwner == System, DataLength == 0] — de uma tx real de mainnet. */
  const pagadorPhantom = () => new TransactionInstruction({ programId: L, data: Buffer.from("06040203000001000000000000000000", "hex"),
    keys: [{ pubkey: dono.publicKey, isSigner: false, isWritable: false }] });
  /** AssertTokenAccountMulti, log 4, [Amount >= n] — a parte que a Phantom tira da PRÓPRIA simulação. */
  const saldoPhantom = (n: number) => new TransactionInstruction({ programId: L,
    data: Buffer.from([10, 4, 1, 2, n, 0, 0, 0, 0, 0, 0, 0, 4]), keys: [{ pubkey: dono.publicKey, isSigner: false, isWritable: false }] });
  /** A cotada, assinada pela "Phantom" com estas instruções a mais no fim. */
  const comAssercoes = (cotada: VersionedTransaction, extras: TransactionInstruction[]) => {
    const t = new VersionedTransaction(new TransactionMessage({ payerKey: dono.publicKey, recentBlockhash: BLOCKHASH,
      instructions: [...TransactionMessage.decompile(cotada.message).instructions, ...extras] }).compileToV0Message());
    t.sign([dono]);
    return t;
  };
  const corpoDe = (assinada: VersionedTransaction, cotada: VersionedTransaction) => ({
    tx: b64(assinada), owner: dono.publicKey.toBase58(), vinculo: vin(cotada),
    mensagemOriginal: Buffer.from(cotada.message.serialize()).toString("base64"),
  });
  const logs = () => [...vi.mocked(console.info).mock.calls, ...vi.mocked(console.warn).mock.calls].flat().join("\n");
  /** Nenhum log carrega bytes assinados, a mensagem original, o token (corpo ou MAC), o pagador ou a conta de taxa. */
  const semSegredosNoLog = (corpo: { tx: string; vinculo?: string; mensagemOriginal?: string }) => {
    const [tokenCorpo, tokenMac] = (corpo.vinculo ?? ".").split(".");
    for (const segredo of [corpo.tx.slice(0, 40), corpo.tx.slice(-40), corpo.mensagemOriginal?.slice(0, 40), tokenCorpo?.slice(0, 40), tokenMac,
      dono.publicKey.toBase58(), "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo"]) {
      if (segredo) expect(logs()).not.toContain(segredo);
    }
  };
  const enviadas = () => pedidos.filter((p) => p.corpo.method === "sendTransaction").length;

  it("⚠️ asserção antes E depois da rota + limite de CU elevado → transmitida byte a byte", async () => {
    const cotada = txSwap();
    const msg = new TransactionMessage({ payerKey: dono.publicKey, recentBlockhash: BLOCKHASH, instructions: [
      pagadorPhantom(), ComputeBudgetProgram.setComputeUnitLimit({ units: 260_000 }), ...TransactionMessage.decompile(cotada.message).instructions.slice(1),
      pagadorPhantom(),
    ] }).compileToV0Message();
    const assinada = new VersionedTransaction(msg); assinada.sign([dono]);
    rpc = (c) => c.method === "sendTransaction" ? ok(assinaturaDe(assinada)) : ok(null);
    const corpo = corpoDe(assinada, cotada);
    const r = await postar(corpo);
    expect(await r.json()).toMatchObject({ ok: true, estado: "enviada", assinatura: assinaturaDe(assinada) });
    expect(pedidos[0].corpo.params[0]).toBe(b64(assinada));
    expect(logs()).toContain('"cuElevado":true');
    expect(logs()).toContain('"variantes":["6/4","6/4"]');
    semSegredosNoLog(corpo);
  });

  it("recusa diz a REGRA (resposta e log) — sem bytes assinados, token ou chave de conta no log", async () => {
    const cotada = txSwap();
    const outroBloco = new TransactionMessage({ payerKey: dono.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(),
      instructions: [...TransactionMessage.decompile(cotada.message).instructions, pagadorPhantom()] }).compileToV0Message();
    const assinada = new VersionedTransaction(outroBloco); assinada.sign([dono]);
    const corpo = corpoDe(assinada, cotada);
    const r = await postar(corpo);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ fase: "antes_do_rpc", erro: "vinculo_mensagem_diferente", detalhe: "blockhash" });
    expect(logs()).toContain('"detalhe":"blockhash"');
    expect(logs()).toContain("L2TE:1:16:6/4");
    semSegredosNoLog(corpo);
    expect(pedidos).toHaveLength(0);
    expect(banco.b.chamadas).toEqual([]);
  });

  it("instrução Lighthouse proibida → 400 com detalhe; nada reservado nem transmitido; nada secreto no log", async () => {
    const memoryWrite = new TransactionInstruction({ programId: L, data: Buffer.from([0, 0, 255, 0, 2, 7, 1, 0, 0, 0, 0, 0, 0, 0]),
      keys: [{ pubkey: dono.publicKey, isSigner: false, isWritable: false }] });
    const corpo = { tx: b64(txSwap({ extra: [memoryWrite] })), owner: dono.publicKey.toBase58() };
    const r = await postar(corpo);
    expect(await r.json()).toMatchObject({ erro: "lighthouse_instrucao_nao_permitida", detalhe: "ix2:op0:log0:c1:opcode:0" });
    expect(logs()).toContain("L2TE:1:14:0/0");
    semSegredosNoLog(corpo);
    expect(pedidos).toHaveLength(0);
    expect(banco.b.chamadas).toEqual([]);
  });

  it("assinatura INVÁLIDA + instrução proibida → recusa antes de olhar instruções: sem `forma` nem `detalhe` no log", async () => {
    const memoryWrite = new TransactionInstruction({ programId: L, data: Buffer.from([0, 0, 255, 0, 2, 7, 1, 0, 0, 0, 0, 0, 0, 0]),
      keys: [{ pubkey: dono.publicKey, isSigner: false, isWritable: false }] });
    const t = txSwap({ extra: [memoryWrite] });
    t.signatures[0] = new Uint8Array(64).fill(3);
    const r = await postar({ tx: b64(t), owner: dono.publicKey.toBase58() });
    expect(await r.json()).toMatchObject({ erro: "assinatura_invalida" });
    expect(logs()).toContain('"recusada":"assinatura_invalida","detalhe":null,"forma":null');
  });

  describe("⚠️⚠️ uma cotação, um swap (auditoria 24/10)", () => {
    it("reassinar a MESMA cotação (outras asserções) depois que a 1ª confirmou → 409, a 2ª NÃO vai à rede", async () => {
      const cotada = txSwap();
      const v1 = comAssercoes(cotada, [pagadorPhantom(), saldoPhantom(5)]), v2 = comAssercoes(cotada, [pagadorPhantom(), saldoPhantom(9)]);
      expect(assinaturaDe(v1)).not.toBe(assinaturaDe(v2));
      rpc = (c) => c.method === "sendTransaction" ? ok(c.params[0] === b64(v1) ? assinaturaDe(v1) : assinaturaDe(v2))
        : c.method === "getSignatureStatuses" ? ok({ value: [{ slot: 9, err: null, confirmationStatus: "confirmed" }] }) : ok(LVBH - 10);
      expect(await (await postar(corpoDe(v1, cotada))).json()).toMatchObject({ estado: "enviada" });
      // a 1ª ainda em aberto (enviada) → recusada pela cotação
      const r2 = await postar(corpoDe(v2, cotada));
      expect(r2.status).toBe(409);
      expect(await r2.json()).toMatchObject({ fase: "antes_do_rpc", erro: "cotacao_ja_enviada", assinaturaDaCotacao: assinaturaDe(v1) });
      // a 1ª já encerrada como CONFIRMADA (pelo /status) → continua recusada
      banco.b.linhas[0].estado = "resolvida"; banco.b.linhas[0].desfecho = "confirmada";
      expect((await postar(corpoDe(v2, cotada))).status).toBe(409);
      expect(enviadas()).toBe(1);
      expect(logs()).toContain('"recusada":"cotacao_ja_enviada"');
      semSegredosNoLog(corpoDe(v2, cotada));
      semSegredosNoLog(corpoDe(v1, cotada));
    });

    it("o ramo `bloqueada` confere a cotação DE NOVO depois de encerrar a anterior (janela entre as idas ao banco)", async () => {
      const chamadas: string[] = [];
      let consultas = 0;
      const r = await reservarTransmissao(
        { carteira: dono.publicKey.toBase58(), assinatura: "SIG2", hashMensagem: "h".repeat(64), blockhash: BLOCKHASH, validoAteBloco: LVBH },
        {
          // 1ª consulta não vê a anterior; depois de encerrada como confirmada, ela aparece
          cotacao: async () => { chamadas.push("cotacao"); return ++consultas === 1 ? null : { assinatura: "SIG1" }; },
          reservar: async () => { chamadas.push("reservar"); return { resultado: "bloqueada", assinatura: "SIG1", validoAteBloco: LVBH }; },
          status: async () => ({ estado: "confirmada", slot: 9, confirmacao: "confirmed" }),
          marcar: async () => { chamadas.push("marcar"); return true; },
        });
      expect(r).toEqual({ resultado: "cotacao_usada", assinatura: "SIG1" });
      expect(chamadas).toEqual(["cotacao", "reservar", "marcar", "cotacao"]);
    });

    it("muitas tentativas recusadas da mesma cotação não escondem a CONFIRMADA (critério no SQL, sem janela)", async () => {
      const cotada = txSwap(), h = createHash("sha256").update(cotada.message.serialize()).digest("hex");
      for (let i = 0; i < 25; i++) {
        banco.b.linhas.push({ carteira: dono.publicKey.toBase58(), assinatura: `RECUSADA${i}`, lvbh: LVBH, estado: "resolvida", desfecho: "nao_enviada", hash: h });
      }
      banco.b.linhas.push({ carteira: dono.publicKey.toBase58(), assinatura: "A_CONFIRMADA", lvbh: LVBH, estado: "resolvida", desfecho: "confirmada", hash: h });
      const v = comAssercoes(cotada, [saldoPhantom(7)]);
      rpc = () => ok(assinaturaDe(v));
      const r = await postar(corpoDe(v, cotada));
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ erro: "cotacao_ja_enviada", assinaturaDaCotacao: "A_CONFIRMADA" });
      expect(enviadas()).toBe(0);
    });

    it("a 1ª FALHOU na rede (não executou o swap) → reassinar a mesma cotação é permitido", async () => {
      const cotada = txSwap(), v1 = comAssercoes(cotada, [saldoPhantom(5)]), v2 = comAssercoes(cotada, [saldoPhantom(9)]);
      banco.b.linhas.push({ carteira: dono.publicKey.toBase58(), assinatura: assinaturaDe(v1), lvbh: LVBH, estado: "resolvida",
        desfecho: "falhou_na_rede", hash: createHash("sha256").update(cotada.message.serialize()).digest("hex") });
      rpc = () => ok(assinaturaDe(v2));
      expect(await (await postar(corpoDe(v2, cotada))).json()).toMatchObject({ estado: "enviada", assinatura: assinaturaDe(v2) });
    });

    it("outra cotação da mesma carteira não é afetada pela regra da cotação (só pela trava de sempre)", async () => {
      const a = txSwap({ dados: 16 }), b = txSwap({ dados: 23 });
      banco.b.linhas.push({ carteira: dono.publicKey.toBase58(), assinatura: assinaturaDe(a), lvbh: LVBH, estado: "resolvida",
        desfecho: "confirmada", hash: createHash("sha256").update(a.message.serialize()).digest("hex") });
      rpc = () => ok(assinaturaDe(b));
      expect(await (await postar({ tx: b64(b), owner: dono.publicKey.toBase58(), vinculo: vin(b) })).json()).toMatchObject({ estado: "enviada" });
    });

    it("⚠️ consulta da cotação falhou → FALHA FECHADA: 503 antes do RPC, nada reservado nem transmitido", async () => {
      banco.b.consultaFora = true;
      const a = txSwap();
      const r = await postar({ tx: b64(a), owner: dono.publicKey.toBase58(), vinculo: vin(a) });
      expect(r.status).toBe(503);
      expect(await r.json()).toMatchObject({ fase: "antes_do_rpc", erro: "trava_indisponivel" });
      expect(banco.b.chamadas).not.toContain("solana_tx_reservar");
      expect(enviadas()).toBe(0);
    });
  });
});
