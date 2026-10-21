/**
 * W3 (21/10) — o fluxo do swap Solana ponta a ponta, com histórico de tentativas.
 *
 * "Phantom" aqui = uma chave GERADA NO TESTE que assina via a mesma interface (`signTransaction`).
 * O servidor e a rede são falsos. Nenhum teste move fundos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { executarSwapSolana, type DepsSwapSolana } from "@/lib/solana/executar-swap";
import { assinaturaDe } from "@/lib/solana/assinatura";
import { acompanharAteDesfecho, tentativaEmAberto, transmitirAssinada, type Desfecho, type Envio } from "@/lib/solana/transmissao-cliente";
import { reconciliarUma } from "@/lib/hooks/useReconciliacaoSolana";
import { podeTerIdoARede, rotuloDaLinha, statusDaEtapa, type TxHistoryEntry } from "@/lib/store/txHistory";

const JUP = new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
const phantom = Keypair.generate();
const OWNER = phantom.publicKey.toBase58();

function txNaoAssinada() {
  const msg = new TransactionMessage({
    payerKey: phantom.publicKey, recentBlockhash: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }),
      new TransactionInstruction({ programId: JUP, keys: [{ pubkey: phantom.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(8) })],
  }).compileToV0Message();
  return new VersionedTransaction(msg);
}

/** Histórico em memória com a mesma interface do store. */
function historicoMem(inicial: TxHistoryEntry[] = []) {
  let entries = [...inicial];
  let n = 0;
  return {
    get: () => entries,
    api: {
      entries: () => entries,
      push: (e: Omit<TxHistoryEntry, "id" | "ts">) => { const id = `t${++n}`; entries = [{ ...e, id, ts: Date.now() } as TxHistoryEntry, ...entries]; return id; },
      update: (id: string, patch: Partial<TxHistoryEntry>) => { entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e)); },
    },
  };
}

function montar(over: Partial<DepsSwapSolana> & { envio?: (sig: string) => Envio; desfecho?: Desfecho } = {}) {
  const h = historicoMem();
  const ui = { fase: vi.fn(), erro: vi.fn(), nota: vi.fn(), assinatura: vi.fn() };
  const assinar = vi.fn(async (tx: VersionedTransaction) => { tx.sign([phantom]); return tx; });
  const transmitir = vi.fn(async (_b64: string, _o: string, sig: string, _v?: string) => (over.envio ?? ((s: string) => ({ estado: "enviada", assinatura: s }) as Envio))(sig));
  const acompanhar = vi.fn(async () => over.desfecho ?? ({ estado: "confirmada" } as Desfecho));
  const d: DepsSwapSolana = {
    owner: OWNER, tx: txNaoAssinada(), validoAteBloco: 4242,
    registro: { type: "dex_swap", valueUsd: 2.5, fromSymbol: "SOL", fromChain: "solana", fromAmount: "0.01", toSymbol: "USDC", toChain: "solana", route: "jupiter", toAmount: "2.4" },
    historico: h.api, assinar, transmitir, acompanhar, ui, texto: (k) => k,
    ...over,
  };
  return { d, h, ui, assinar, transmitir, acompanhar };
}

describe("⚠️⚠️ o caso real do dono: Phantom assina → envio dá 403", () => {
  it("o histórico TEM a tentativa: assinatura pública, 'Falha no envio', sem volume confirmado, sem link de explorer", async () => {
    const { d, h, ui, transmitir } = montar({ envio: (sig) => ({ estado: "nao_enviada", assinatura: sig, motivo: "proibido" }) });
    const r = await executarSwapSolana(d);
    expect(r.resultado).toBe("envio_falhou");
    const [linha] = h.get();
    expect(linha).toMatchObject({ etapa: "envio_falhou", status: "failed", wallet: OWNER, validoAteBloco: 4242, motivo: "proibido",
      fromSymbol: "SOL", toSymbol: "USDC", route: "jupiter" });
    expect(linha.txHash).toBe(transmitir.mock.calls[0][2]);         // a assinatura pública derivada
    expect(linha.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/);
    expect(statusDaEtapa(linha.etapa!)).not.toBe("confirmed");        // nada de volume/taxa
    expect(rotuloDaLinha(linha)).toBe("Falha no envio");             // ≠ "Falhou na blockchain"
    expect(podeTerIdoARede(linha)).toBe(false);                      // sem link para um hash que a rede não tem
    expect(ui.erro.mock.calls[0][0]).toMatch(/^solSendFailed \(proibido\)/);
    expect(ui.fase).toHaveBeenLastCalledWith("tx_failed");
    // ⚠️ nunca a transação assinada bruta no histórico
    expect(JSON.stringify(h.get())).not.toContain(transmitir.mock.calls[0][0].slice(0, 30));
  });

  it("e ela pode ser tentada de novo (não ficou 'em aberto'): a recusa foi certa, antes da rede", async () => {
    const { d, h } = montar({ envio: (sig) => ({ estado: "nao_enviada", assinatura: sig, motivo: "proibido" }) });
    await executarSwapSolana(d);
    expect(tentativaEmAberto(h.get(), OWNER)).toBeUndefined();
  });
});

describe("ordem: a tentativa existe ANTES da assinatura", () => {
  it("quando a carteira é chamada, a linha 'solicitada' já está no histórico (com carteira e validade)", async () => {
    const h = historicoMem();
    let vistoNaAssinatura: TxHistoryEntry[] = [];
    const { d } = montar({
      historico: h.api,
      assinar: async (tx) => { vistoNaAssinatura = h.get(); tx.sign([phantom]); return tx; },
    });
    await executarSwapSolana(d);
    expect(vistoNaAssinatura).toHaveLength(1);
    expect(vistoNaAssinatura[0]).toMatchObject({ etapa: "solicitada", status: "pending", wallet: OWNER, validoAteBloco: 4242 });
    expect(vistoNaAssinatura[0].txHash).toBeUndefined();   // sem assinatura → sem hash inventado
  });

  it("usuário recusa na Phantom → 'cancelada', nada enviado, erro propagado (mensagem de recusa de sempre)", async () => {
    const { d, h, transmitir } = montar({ assinar: async () => { throw new Error("User rejected the request."); } });
    await expect(executarSwapSolana(d)).rejects.toThrow(/rejected/);
    expect(h.get()[0]).toMatchObject({ etapa: "cancelada", status: "canceled" });
    expect(h.get()[0].txHash).toBeUndefined();
    expect(transmitir).not.toHaveBeenCalled();
  });
});

describe("desfechos on-chain", () => {
  it("enviada + confirmada (err nulo) → 'confirmada' (a ÚNICA que vira volume)", async () => {
    const { d, h, ui } = montar();
    expect((await executarSwapSolana(d)).resultado).toBe("confirmada");
    expect(h.get()[0]).toMatchObject({ etapa: "confirmada", status: "confirmed" });
    expect(ui.fase).toHaveBeenLastCalledWith("tx_confirmed");
  });

  it("⚠️ pousou e REVERTEU → 'Falhou na blockchain', status failed, erro da cadeia junto", async () => {
    const { d, h, ui } = montar({ desfecho: { estado: "falhou_na_rede", erro: '{"InstructionError":[2,{"Custom":6001}]}' } });
    expect((await executarSwapSolana(d)).resultado).toBe("falhou_na_rede");
    expect(h.get()[0]).toMatchObject({ etapa: "falhou_na_rede", status: "failed" });
    expect(rotuloDaLinha(h.get()[0])).toBe("Falhou na blockchain");
    expect(podeTerIdoARede(h.get()[0])).toBe(true);
    expect(ui.erro.mock.calls[0][0]).toContain("Custom");
  });

  it("blockhash expirou sem pousar → 'expirada' (não executou; seguro tentar de novo)", async () => {
    const { d, h } = montar({ desfecho: { estado: "expirada" } });
    expect((await executarSwapSolana(d)).resultado).toBe("expirada");
    expect(h.get()[0]).toMatchObject({ etapa: "expirada", status: "failed" });
    expect(tentativaEmAberto(h.get(), OWNER)).toBeUndefined();
  });

  it("⚠️ envio INCERTO (timeout) → não é falha: fica 'envio_incerto' até o status decidir", async () => {
    const { d, h, ui, acompanhar } = montar({ envio: (sig) => ({ estado: "incerta", assinatura: sig, motivo: "timeout" }), desfecho: { estado: "indefinido", motivo: "desconhecido:timeout" } });
    expect((await executarSwapSolana(d)).resultado).toBe("em_aberto");
    expect(acompanhar).toHaveBeenCalled();                   // consultou a rede, não presumiu
    expect(h.get()[0]).toMatchObject({ etapa: "envio_incerto", status: "pending" });
    expect(ui.nota).toHaveBeenCalledWith("solSendUncertain");
    expect(ui.erro).toHaveBeenLastCalledWith("solStillChecking");
  });

  it("envio incerto que POUSOU → confirmada (o 'erro' do envio não era ausência de transmissão)", async () => {
    const { d, h } = montar({ envio: (sig) => ({ estado: "incerta", assinatura: sig, motivo: "http_500" }), desfecho: { estado: "confirmada" } });
    expect((await executarSwapSolana(d)).resultado).toBe("confirmada");
    expect(h.get()[0].etapa).toBe("confirmada");
  });
});

describe("⚠️ anti-duplicação", () => {
  it("tentativa anterior da MESMA carteira ainda em aberto → nova assinatura bloqueada (carteira nem é chamada)", async () => {
    const aberta = { id: "a", ts: Date.now(), type: "dex_swap", status: "pending", etapa: "envio_incerto", wallet: OWNER, route: "jupiter", txHash: "x", fromSymbol: "SOL", fromChain: "solana", fromAmount: "1", toSymbol: "USDC", toChain: "solana" } as TxHistoryEntry;
    const h = historicoMem([aberta]);
    const { d, assinar } = montar({ historico: h.api });
    expect((await executarSwapSolana(d)).resultado).toBe("bloqueada");
    expect(assinar).not.toHaveBeenCalled();
    expect(h.get()).toHaveLength(1);
  });

  it("em aberto de OUTRA carteira não bloqueia esta (sem mistura)", async () => {
    const outra = { id: "a", ts: Date.now(), type: "dex_swap", status: "pending", etapa: "pendente", wallet: Keypair.generate().publicKey.toBase58(), route: "jupiter", txHash: "x", fromSymbol: "SOL", fromChain: "solana", fromAmount: "1", toSymbol: "USDC", toChain: "solana" } as TxHistoryEntry;
    const { d } = montar({ historico: historicoMem([outra]).api });
    expect((await executarSwapSolana(d)).resultado).toBe("confirmada");
  });

  /**
   * ⚠️ LIMITE DOCUMENTADO (revisão 21/10): a trava é LOCAL — vive no histórico deste navegador.
   * Os dois testes abaixo FIXAM esse limite (se um dia passarem a bloquear, a doc precisa mudar).
   * O que segura de verdade, além dela: (1) a mesma transação assinada só pousa uma vez; (2) o vínculo
   * expira em 3 min e cada cotação tem blockhash próprio. O que NÃO segura: duas cotações diferentes
   * assinadas em dois aparelhos ao mesmo tempo. Proposta (não implementada): trava no servidor por
   * carteira, com validade = lastValidBlockHeight da transação em voo — ver PLANO-W3.
   */
  it("LIMITE: armazenamento local perdido → a tentativa em aberto some e a trava não vê nada", async () => {
    const h = historicoMem([]);   // localStorage limpo / outro perfil do navegador
    const { d, assinar } = montar({ historico: h.api });
    expect((await executarSwapSolana(d)).resultado).toBe("confirmada");
    expect(assinar).toHaveBeenCalledTimes(1);
  });

  it("LIMITE: dois aparelhos com a MESMA carteira — cada um só enxerga o próprio histórico", async () => {
    const aparelho1 = historicoMem([{ id: "x", ts: Date.now(), type: "dex_swap", status: "pending", etapa: "pendente", wallet: OWNER, route: "jupiter", txHash: "S", fromSymbol: "SOL", fromChain: "solana", fromAmount: "1", toSymbol: "USDC", toChain: "solana" } as TxHistoryEntry]);
    const aparelho2 = historicoMem([]);
    expect((await executarSwapSolana(montar({ historico: aparelho1.api }).d)).resultado).toBe("bloqueada");
    expect((await executarSwapSolana(montar({ historico: aparelho2.api }).d)).resultado).toBe("confirmada");
  });

});

describe("Phantom: compatibilidade e não-custódia", () => {
  it("o vínculo da cotação viaja até a transmissão", async () => {
    const { d, transmitir } = montar({ vinculo: "VINCULO-DA-COTACAO" });
    await executarSwapSolana(d);
    expect(transmitir.mock.calls[0][3]).toBe("VINCULO-DA-COTACAO");
  });

  it("a carteira é chamada UMA vez com a transação montada; o que vai ao servidor é exatamente o que ela devolveu", async () => {
    const { d, assinar, transmitir } = montar();
    await executarSwapSolana(d);
    expect(assinar).toHaveBeenCalledTimes(1);
    const enviada = VersionedTransaction.deserialize(Buffer.from(transmitir.mock.calls[0][0], "base64"));
    expect(enviada.message.staticAccountKeys[0].toBase58()).toBe(OWNER);
    expect(enviada.signatures[0].some((b) => b !== 0)).toBe(true);
    expect(transmitir.mock.calls[0][1]).toBe(OWNER);
  });

  it("o fluxo não contém NENHUMA forma de assinar fora da carteira", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/solana/executar-swap.ts", "src/lib/solana/transmissao.ts", "src/lib/solana/transmissao-cliente.ts", "src/app/api/solana/transmitir/route.ts"]) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/Keypair|secretKey|fromSecretKey|\.sign\(\[/);
    }
  });
});

describe("cliente: transmitirAssinada e acompanhar", () => {
  beforeEach(() => vi.unstubAllGlobals());
  const resp = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("queda ao falar com o NOSSO servidor → incerta (pode ter transmitido)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await transmitirAssinada("x", OWNER, "SIG")).toEqual({ estado: "incerta", assinatura: "SIG", motivo: "conexao_com_servidor" });
  });
  it("recusa ESTRUTURADA da aplicação marcada `antes_do_rpc` (400/413/429/503) → nao_enviada", async () => {
    resp(400, { ok: false, fase: "antes_do_rpc", erro: "assinatura_invalida" });
    expect(await transmitirAssinada("x", OWNER, "SIG")).toMatchObject({ estado: "nao_enviada", motivo: "assinatura_invalida" });
    resp(429, { ok: false, fase: "antes_do_rpc", erro: "rate_limited" });
    expect((await transmitirAssinada("x", OWNER, "SIG")).estado).toBe("nao_enviada");
    resp(503, { ok: false, fase: "antes_do_rpc", erro: "ocupado" });
    expect((await transmitirAssinada("x", OWNER, "SIG")).estado).toBe("nao_enviada");
  });

  it("⚠️⚠️ revisão: 503/429/504 de GATEWAY (sem a marca — pode ter vindo DEPOIS de o backend transmitir) → incerta", async () => {
    for (const [st, corpo] of [[503, "<html>Service Unavailable</html>"], [504, "Gateway Timeout"], [429, '{"error":"too many"}'], [502, ""], [400, '{"ok":false,"erro":"sem marca"}']] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(corpo, { status: st })));
      expect(await transmitirAssinada("x", OWNER, "SIG"), String(st)).toMatchObject({ estado: "incerta", assinatura: "SIG", motivo: `http_${st}` });
    }
  });
  it("500 da nossa rota → incerta; assinatura divergente → incerta", async () => {
    resp(500, {});
    expect((await transmitirAssinada("x", OWNER, "SIG")).estado).toBe("incerta");
    resp(200, { ok: true, estado: "enviada", assinatura: "OUTRA" });
    expect(await transmitirAssinada("x", OWNER, "SIG")).toMatchObject({ estado: "incerta", motivo: "assinatura_divergente" });
  });

  it("acompanhar: pendente → pendente → confirmada", async () => {
    const seq = ["pendente", "pendente", "confirmada"];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, estado: seq.shift() })));
    expect(await acompanharAteDesfecho("SIG", 10, { dormir: async () => {} })).toEqual({ estado: "confirmada" });
  });
  it("acompanhar: status desconhecido até o prazo → indefinido (não falha)", async () => {
    let t = 0;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, estado: "desconhecido", motivo: "timeout" })));
    expect(await acompanharAteDesfecho("SIG", 10, { dormir: async () => {}, agora: () => (t += 50_000), prazoMs: 120_000 }))
      .toEqual({ estado: "indefinido", motivo: "desconhecido:timeout" });
  });
});

describe("reconciliação depois de recarregar a página", () => {
  const base = { id: "a", type: "dex_swap", wallet: OWNER, route: "jupiter", fromSymbol: "SOL", fromChain: "solana", fromAmount: "1", toSymbol: "USDC", toChain: "solana", validoAteBloco: 10 } as const;
  const estado = (e: string, extra: object = {}) => vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, estado: e, ...extra })));

  it("em aberto + rede diz confirmada → confirmada; falhou → falhou_na_rede; expirada → expirada", async () => {
    estado("confirmada");
    expect(await reconciliarUma({ ...base, ts: 0, status: "pending", etapa: "envio_incerto", txHash: "S" } as TxHistoryEntry)).toMatchObject({ etapa: "confirmada", status: "confirmed" });
    estado("falhou_na_rede", { erro: "E" });
    expect(await reconciliarUma({ ...base, ts: 0, status: "pending", etapa: "pendente", txHash: "S" } as TxHistoryEntry)).toMatchObject({ etapa: "falhou_na_rede" });
    estado("expirada");
    expect(await reconciliarUma({ ...base, ts: 0, status: "pending", etapa: "assinada", txHash: "S" } as TxHistoryEntry)).toMatchObject({ etapa: "expirada" });
  });

  it("⚠️ status desconhecido → NADA muda (continua em aberto, bloqueando nova assinatura)", async () => {
    estado("desconhecido", { motivo: "timeout" });
    expect(await reconciliarUma({ ...base, ts: 0, status: "pending", etapa: "envio_incerto", txHash: "S" } as TxHistoryEntry)).toBeNull();
  });

  it("'solicitada' abandonada há > 10 min (nunca assinada) → cancelada; registros antigos sem etapa → intocados", async () => {
    expect(await reconciliarUma({ ...base, ts: 0, status: "pending", etapa: "solicitada" } as TxHistoryEntry, 11 * 60_000)).toMatchObject({ etapa: "cancelada" });
    expect(await reconciliarUma({ ...base, ts: 0, status: "pending" } as TxHistoryEntry)).toBeNull();
  });
});

/**
 * ⚠️⚠️ W3-B (2ª auditoria, 21/10): NENHUM CAMINHO DE ENVIO CONTORNA O SERVIDOR.
 * `NEXT_PUBLIC_SOLANA_JITO` está "on" nos bundles servidos (Preview e Production); o caminho Jito
 * mandava a transação do navegador ao block engine sem vínculo/taxa/programas. Estas travas falham se
 * alguém religar um envio alternativo sem paridade com `/api/solana/transmitir`.
 */
describe("⚠️⚠️ W3-B: um único caminho de envio — o servidor com vínculo", () => {
  it("mesmo com NEXT_PUBLIC_SOLANA_JITO=on, o swap é transmitido SÓ por `transmitir`, com o vínculo da cotação", async () => {
    vi.stubEnv("NEXT_PUBLIC_SOLANA_JITO", "on");
    const fetchEspiao = vi.fn();
    vi.stubGlobal("fetch", fetchEspiao);
    const { d, transmitir } = montar({ vinculo: "V" });
    await executarSwapSolana(d);
    expect(transmitir).toHaveBeenCalledTimes(1);
    expect(transmitir.mock.calls[0][3]).toBe("V");
    expect(fetchEspiao).not.toHaveBeenCalled();   // nenhuma chamada de rede fora do transmissor
    vi.unstubAllEnvs(); vi.unstubAllGlobals();
  });

  it("o fluxo não tem dependência de envio alternativo (sem `enviarJito` nas dependências)", async () => {
    const { readFileSync } = await import("node:fs");
    // Remove só comentários de bloco e LINHAS de comentário (um `//` dentro de URL não é comentário).
    const fluxo = readFileSync("src/lib/solana/executar-swap.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(fluxo).not.toMatch(/enviarJito|sendViaJito|block-engine|sendRawTransaction|sendTransaction\(/);
    expect([...fluxo.matchAll(/await transmitir\(/g)]).toHaveLength(1);
  });

  it("nenhum código do navegador chama a Jito ou envia transação Solana direto à rede", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const path = await import("node:path");
    const fontes = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = path.join(dir, n);
      return statSync(p).isDirectory() ? fontes(p) : /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
    const ofensores = fontes("src").filter((f) => !f.endsWith(path.join("swap", "jito.ts"))).filter((f) => {
      const t = readFileSync(f, "utf8");
      return /sendViaJito\(|\.sendRawTransaction\(|\.sendTransaction\(\s*(signed|tx|transaction)\b/.test(t) && /"use client"/.test(t);
    });
    expect(ofensores).toEqual([]);
  });
});


describe("Lighthouse original message snapshot", () => {
  it("keeps the authenticated original when the wallet mutates its input in place", async () => {
    const { d, transmitir } = montar();
    const original = Buffer.from(d.tx.message.serialize()).toString("base64");
    d.assinar = async (t) => {
      const message = TransactionMessage.decompile(t.message);
      message.instructions.push(new TransactionInstruction({
        programId: new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95"),
        keys: [{ pubkey: phantom.publicKey, isSigner: false, isWritable: false }],
        data: Buffer.from([5, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0]),
      }));
      t.message = message.compileToV0Message();
      t.sign([phantom]);
      return t;
    };
    await executarSwapSolana(d);
    expect(Buffer.from(d.tx.message.serialize()).toString("base64")).not.toBe(original);
    expect(transmitir).toHaveBeenCalledWith(expect.any(String), OWNER, expect.any(String), undefined, original);
  });
});
