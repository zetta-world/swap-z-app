import { describe, it, expect } from "vitest";
import { configDeEnsaio, montarEnsaio, abrirAteAllowlist, comprar, acompanharAte, inscricaoSintetica, carteiraSintetica, adminExecuta, T0 } from "./cenario-local";
import { ServicoDaVenda } from "./servico";
import { ProvedorReferenciaFixo } from "./preco";
import { CadeiaFalsa } from "./carteira";
import { RelogioDaVenda, contagem } from "./relogio";
import { provaPara } from "./allowlist-hibrida";

/** CAOS — falhas injetadas; o sistema falha FECHADO e nunca fabrica sucesso nem vende além do supply. */
const W = (n: number | string) => carteiraSintetica(n);
const ins = (n = 6) => Array.from({ length: n }, (_, i) => inscricaoSintetica(i, "PRO"));

describe("caos", () => {
  it("banco indisponível: compra e transição recusam, sem exceção vazando", async () => {
    let fora = false;
    const base = montarEnsaio();
    await abrirAteAllowlist(base, ins());
    const estado = base.servico.autoridade.ler();
    const s = new ServicoDaVenda({ cfg: base.cfg, relogio: base.relogio.agora, provedor: new ProvedorReferenciaFixo(150, base.relogio.agora),
      armazem: { ler: () => { if (fora) throw new Error("db"); return estado; }, gravar: () => { if (fora) throw new Error("db"); } } });
    fora = true;
    expect(await s.comprar({ carteira: W(0), tier: "PRO", unidades: 1, chave: "db1", rede: "solana:localnet-fake", lamports: "1", precoFingerprint: "x" })).toEqual({ ok: false, erro: "armazenamento_indisponivel" });
    expect(await s.autoridade.transicionar("pausar", { versaoEsperada: estado.versao })).toMatchObject({ ok: false, erro: "armazenamento_indisponivel" });
  });
  it("chain falsa fora: compra recusa e libera a reserva; recibo durante a queda = PENDING", async () => {
    const m = montarEnsaio();
    await abrirAteAllowlist(m, ins());
    const a = await comprar(m, W(0), "PRO", "ch1");
    if (!a.ok) throw new Error();
    m.cadeia.derrubar(true);
    expect(await m.servico.acompanhar(a.assinatura)).toEqual({ status: "PENDING" });
    expect(await comprar(m, W(1), "PRO", "ch2")).toEqual({ ok: false, erro: "cadeia_indisponivel" });
    expect(m.servico.progresso().porTier.PRO.reserved).toBe(1); // só a primeira, a segunda foi liberada
    m.cadeia.derrubar(false);
    expect((await acompanharAte(m, a.assinatura)).status).toBe("CONFIRMED");
  });
  it("fonte de preço fora: fase não congela e nenhuma compra passa", async () => {
    const m = montarEnsaio();
    m.provedor.derrubar(true);
    await expect(abrirAteAllowlist(m, ins())).rejects.toThrow("preco:provedor_indisponivel");
    m.provedor.derrubar(false);
    expect(await comprar(m, W(0), "PRO", "pr1")).toMatchObject({ ok: false });
  });
  it("relógio do cliente discorda do servidor: contagem usa só o servidor", () => {
    const servidor = T0 + 1000;
    const r = new RelogioDaVenda(() => 0);
    r.sincronizar(servidor);
    const original = Date.now;
    Date.now = () => T0 + 999_999_999;
    try { expect(contagem({ inicioMs: T0 + 5000, fimMs: null }, r.agora())).toMatchObject({ tipo: "antes", s: 4 }); }
    finally { Date.now = original; }
  });
  it("requisição duplicada e refresh no meio do fluxo: mesma chave retoma a mesma reserva e assinatura", async () => {
    const m = montarEnsaio({ cadeia: { ticksAteConfirmar: 3 } });
    await abrirAteAllowlist(m, ins());
    const a = await comprar(m, W(0), "PRO", "refresh-1");
    if (!a.ok) throw new Error();
    await m.servico.acompanhar(a.assinatura); // "navegador recarregou" aqui
    const b = await comprar(m, W(0), "PRO", "refresh-1");
    expect(b.ok && b.replay && b.assinatura === a.assinatura).toBe(true);
    expect((await acompanharAte(m, a.assinatura)).status).toBe("CONFIRMED");
    expect(m.servico.progresso().porTier.PRO.minted).toBe(1);
  });
  it("falha do armazenamento de reservas: recusa sem mudar estado", async () => {
    let falhar = false;
    const m = montarEnsaio({ opcoesLivro: { falhaArmazenamento: () => falhar } });
    await abrirAteAllowlist(m, ins());
    falhar = true;
    expect(await comprar(m, W(0), "PRO", "st1")).toEqual({ ok: false, erro: "armazenamento_indisponivel" });
    expect(m.servico.progresso().total.reserved).toBe(0);
    falhar = false;
    expect((await comprar(m, W(0), "PRO", "st1")).ok).toBe(true);
  });
  it("confirmação atrasada além da validade: reconciliação, sem oversell, sem sucesso fabricado", async () => {
    const m = montarEnsaio({ validadeReservaMs: 500, cadeia: { ticksAteConfirmar: 5 } });
    await abrirAteAllowlist(m, ins());
    const a = await comprar(m, W(0), "PRO", "late");
    if (!a.ok) throw new Error();
    m.relogio.avancar(600);
    expect((await acompanharAte(m, a.assinatura)).status).toBe("RECONCILIATION_REQUIRED");
    expect(m.servico.onboarding(W(0)).founder).toBe(false);
  });
  it("admin pausa no meio da transação: a tx já enviada confirma (verdade on-chain); compras novas recusadas", async () => {
    const m = montarEnsaio({ cadeia: { ticksAteConfirmar: 2 } });
    await abrirAteAllowlist(m, ins());
    const a = await comprar(m, W(0), "PRO", "mid");
    if (!a.ok) throw new Error();
    expect((await adminExecuta(m.servico, { tipo: "pausar" })).ok).toBe(true);
    expect(await comprar(m, W(1), "PRO", "mid2")).toEqual({ ok: false, erro: "venda_fechada" });
    expect((await acompanharAte(m, a.assinatura)).status).toBe("CONFIRMED");
  });
  it("snapshot divergente: prova com id de outro snapshot é recusada", async () => {
    const m = montarEnsaio();
    await abrirAteAllowlist(m, ins());
    const vig = m.servico.admin.snapshot()!;
    const p = provaPara(vig, W(0), "PRO")!;
    const pr = m.servico.precos.precoDaFase("allowlist")!;
    expect(await m.servico.comprar({ carteira: W(0), tier: "PRO", unidades: 1, chave: "sm", rede: "solana:localnet-fake", prova: { ...p, snapshotId: "0".repeat(64) }, lamports: pr.tiers.PRO.lamports, precoFingerprint: pr.fingerprint })).toEqual({ ok: false, erro: "prova_invalida" });
  });
  it("resposta local corrompida (recibo malformado) = PENDING, nunca CONFIRMED", async () => {
    const cadeia = new CadeiaFalsa({ corromper: new Set(["corr"]) });
    const m = montarEnsaio();
    (m as { cadeia: CadeiaFalsa }).cadeia = cadeia;
    const s = new ServicoDaVenda({ cfg: configDeEnsaio(), relogio: m.relogio.agora, provedor: m.provedor, cadeia });
    const mm = { ...m, servico: s, cadeia };
    await abrirAteAllowlist(mm, ins());
    const a = await comprar(mm, W(0), "PRO", "corr");
    if (!a.ok) throw new Error();
    expect((await acompanharAte(mm, a.assinatura)).status).toBe("PENDING");
  });
});
