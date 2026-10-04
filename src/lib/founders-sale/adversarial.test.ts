import { describe, it, expect } from "vitest";
import { configDeEnsaio, montarEnsaio, abrirAteAllowlist, abrirPublica, comprar, acompanharAte, inscricaoSintetica, carteiraSintetica, adminExecuta, type MontagemEnsaio } from "./cenario-local";
import { provaPara, criarSnapshotAlocacao } from "./allowlist-hibrida";
import { RelogioDaVenda } from "./relogio";
import { REDE_DA_VENDA } from "./carteira";
import { TIERS } from "./config";

/** SUÍTE ADVERSARIAL FOUNDERS — cada caso tenta quebrar uma garantia e tem de falhar fechado. Nada externo. */
const W = (n: number | string) => carteiraSintetica(n);
const pronta = async (o: Parameters<typeof montarEnsaio>[0] = {}, n = 6): Promise<MontagemEnsaio> => {
  const m = montarEnsaio(o);
  await abrirAteAllowlist(m, Array.from({ length: n }, (_, i) => inscricaoSintetica(i, "PRO")));
  return m;
};
const oversold = (m: MontagemEnsaio) => TIERS.reduce((s, t) => { const p = m.servico.progresso().porTier[t]; return s + Math.max(0, p.minted + p.reserved - p.paid_supply); }, 0);

describe("adversarial", () => {
  it("oversell: 500 compradores concorrentes por 200 unidades na pública → OVERSOLD = 0", async () => {
    const m = await pronta({ cfg: configDeEnsaio({ supplyPago: { PRO: 200, TRADER: 8, PILOT: 2 } }) });
    await abrirPublica(m);
    const rs = await Promise.all(Array.from({ length: 500 }, (_, i) => comprar(m, W(`c${i}`), "PRO", `c${i}`)));
    expect(rs.filter((r) => r.ok)).toHaveLength(200 - 0);
    expect(oversold(m)).toBe(0);
    await Promise.all(rs.filter((r) => r.ok).map((r) => r.ok ? acompanharAte(m, r.assinatura) : null));
    expect(m.servico.progresso().porTier.PRO).toMatchObject({ minted: 200, reserved: 0, available: 0 });
    expect(oversold(m)).toBe(0);
  });
  it("dupla alocação e duplo envio: mesma chave = mesma reserva e mesma assinatura; chave nova barra no teto", async () => {
    const m = await pronta();
    const a = await comprar(m, W(0), "PRO", "dup");
    const b = await comprar(m, W(0), "PRO", "dup");
    expect(a.ok && b.ok && a.reservaId === b.reservaId && a.assinatura === b.assinatura && b.replay).toBe(true);
    expect(await comprar(m, W(0), "PRO", "dup-2")).toEqual({ ok: false, erro: "teto_da_carteira" });
  });
  it("replay de prova: a mesma prova não compra além da alocação concedida", async () => {
    const m = await pronta();
    const p1 = await comprar(m, W(1), "PRO", "r1");
    if (!p1.ok) throw new Error();
    await acompanharAte(m, p1.assinatura);
    expect(await comprar(m, W(1), "PRO", "r2")).toEqual({ ok: false, erro: "teto_da_carteira" });
  });
  it("prova inválida, prova de snapshot antigo/não congelado, prova de outra carteira, tier errado", async () => {
    const m = await pronta();
    const s = m.servico;
    const vig = s.admin.snapshot()!;
    const preco = s.precos.precoDaFase("allowlist")!;
    const base = { unidades: 1, rede: REDE_DA_VENDA, lamports: preco.tiers.PRO.lamports, precoFingerprint: preco.fingerprint };
    const prova = provaPara(vig, W(2), "PRO")!;
    expect(await s.comprar({ ...base, carteira: W(2), tier: "PRO", chave: "i1", prova: { ...prova, caminho: prova.caminho.map(() => "00".repeat(32)) } })).toEqual({ ok: false, erro: "prova_invalida" });
    const antigo = criarSnapshotAlocacao(1, [{ carteira: W(2), tier: "PRO", quantidade: 5, origem: "curada" }]);
    expect(await s.comprar({ ...base, carteira: W(2), tier: "PRO", chave: "i2", prova: provaPara(antigo, W(2), "PRO")! })).toEqual({ ok: false, erro: "prova_invalida" });
    expect(await s.comprar({ ...base, carteira: W(3), tier: "PRO", chave: "i3", prova })).toEqual({ ok: false, erro: "carteira_diferente_da_prova" });
    expect(await s.comprar({ ...base, carteira: W(2), tier: "TRADER", chave: "i4", prova, lamports: preco.tiers.TRADER.lamports })).toEqual({ ok: false, erro: "carteira_diferente_da_prova" });
  });
  it("mutação do snapshot: entrada adulterada não verifica; congelar adulterado é recusado", async () => {
    const m = await pronta();
    const vig = m.servico.admin.snapshot()!;
    const p = provaPara(vig, W(4), "PRO")!;
    expect(await m.servico.comprar({ carteira: W(4), tier: "PRO", unidades: 1, chave: "m1", rede: REDE_DA_VENDA, prova: { ...p, entrada: { ...p.entrada, quantidade: 50 } },
      lamports: m.servico.precos.precoDaFase("allowlist")!.tiers.PRO.lamports, precoFingerprint: m.servico.precos.precoDaFase("allowlist")!.fingerprint })).toEqual({ ok: false, erro: "prova_invalida" });
    expect(() => { (vig.entradas as unknown as Array<{ quantidade: number }>)[0].quantidade = 99; }).toThrow();
  });
  it("estouro de alocação: 2 unidades na allowlist com concessão 1", async () => {
    const m = await pronta();
    expect(await comprar(m, W(5), "PRO", "o1", { unidades: 2 })).toEqual({ ok: false, erro: "teto_da_carteira" });
  });
  it("rede errada, fase não iniciada, fase encerrada, venda pausada, venda esgotada", async () => {
    const m0 = montarEnsaio();
    expect(await comprar(m0, W(0), "PRO", "f0")).toEqual({ ok: false, erro: "venda_fechada" });
    const m = await pronta({ cfg: configDeEnsaio({ supplyPago: { PRO: 1, TRADER: 1, PILOT: 1 } }) });
    expect(await comprar(m, W(0), "PRO", "f1", { rede: "evm:1" })).toEqual({ ok: false, erro: "rede_errada" });
    await adminExecuta(m.servico, { tipo: "pausar" });
    expect(await comprar(m, W(0), "PRO", "f2")).toEqual({ ok: false, erro: "venda_fechada" });
    await adminExecuta(m.servico, { tipo: "retomar" });
    const ok = await comprar(m, W(0), "PRO", "f3");
    if (!ok.ok) throw new Error(ok.erro);
    await acompanharAte(m, ok.assinatura);
    expect(await comprar(m, W(1), "PRO", "f4")).toEqual({ ok: false, erro: "esgotado" });
    m.relogio.ir(m.cfg.horarios.vendaFecha!); await m.servico.autoridade.tick();
    expect(await comprar(m, W(2), "TRADER", "f5")).toEqual({ ok: false, erro: "venda_fechada" });
  });
  it("adulteração de preço: lamports menores, fingerprint trocado, preço de outra fase", async () => {
    const m = await pronta();
    const s = m.servico;
    const vig = s.admin.snapshot()!;
    const pr = s.precos.precoDaFase("allowlist")!;
    const base = { carteira: W(1), tier: "PRO", unidades: 1, rede: REDE_DA_VENDA, prova: provaPara(vig, W(1), "PRO")! };
    expect(await s.comprar({ ...base, chave: "p1", lamports: (BigInt(pr.tiers.PRO.lamports) - 1n).toString(), precoFingerprint: pr.fingerprint })).toEqual({ ok: false, erro: "preco_adulterado" });
    expect(await s.comprar({ ...base, chave: "p2", lamports: pr.tiers.PRO.lamports, precoFingerprint: "0".repeat(64) })).toEqual({ ok: false, erro: "preco_adulterado" });
  });
  it("relógio do cliente adulterado não muda o estado autoritativo nem a contagem", async () => {
    const m = await pronta();
    const antes = m.servico.autoridade.ler();
    const original = Date.now;
    Date.now = () => m.cfg.horarios.vendaFecha! + 10_000_000;
    try {
      await m.servico.autoridade.tick();
      expect(m.servico.autoridade.ler()).toEqual(antes);
      const rc = new RelogioDaVenda(() => 0); rc.sincronizar(m.relogio.t);
      expect(rc.agora()).toBe(m.relogio.t);
    } finally { Date.now = original; }
  });
  it("corrida pela última unidade: 100 concorrentes, 1 vence", async () => {
    const m = await pronta({ cfg: configDeEnsaio({ supplyPago: { PRO: 7, TRADER: 1, PILOT: 1 } }) });
    for (let i = 0; i < 6; i++) { const r = await comprar(m, W(i), "PRO", `pre${i}`); if (r.ok) await acompanharAte(m, r.assinatura); }
    await abrirPublica(m);
    const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => comprar(m, W(`ult${i}`), "PRO", `ult${i}`)));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(oversold(m)).toBe(0);
  });
  it("reserva expira antes da confirmação: unidade volta; confirmação tardia exige reconciliação (sem oversell)", async () => {
    const m = await pronta({ validadeReservaMs: 1000, cadeia: { ticksAteConfirmar: 3 }, cfg: configDeEnsaio({ supplyPago: { PRO: 1, TRADER: 1, PILOT: 1 } }) });
    const a = await comprar(m, W(0), "PRO", "e1");
    if (!a.ok) throw new Error();
    m.relogio.avancar(1500);
    expect(m.servico.progresso().porTier.PRO.available).toBe(1);
    const fim = await acompanharAte(m, a.assinatura);
    expect(fim).toMatchObject({ status: "RECONCILIATION_REQUIRED", motivo: "expirada" });
    expect(oversold(m)).toBe(0);
  });
  it("timeout de transação: chain nunca confirma → PENDING, nunca sucesso", async () => {
    const m = await pronta({ cadeia: { ticksAteConfirmar: 10_000 } });
    const a = await comprar(m, W(0), "PRO", "t1");
    if (!a.ok) throw new Error();
    expect((await acompanharAte(m, a.assinatura, 20)).status).toBe("PENDING");
    expect(m.servico.onboarding(W(0)).founder).toBe(false);
  });
  it("confirmação falsa: assinatura forjada/desconhecida e recibo corrompido nunca viram sucesso", async () => {
    const m = await pronta({ cadeia: { corromper: new Set(["cx"]) } });
    expect(await m.servico.acompanhar("fakesig-" + "f".repeat(40))).toEqual({ status: "FAILED", motivo: "assinatura_desconhecida" });
    const a = await comprar(m, W(0), "PRO", "cx");
    if (!a.ok) throw new Error();
    expect((await acompanharAte(m, a.assinatura)).status).toBe("PENDING");
  });
  it("admin: replay de pedido, ação não autorizada, operador sozinho", async () => {
    const m = await pronta();
    const s = m.servico;
    expect(s.admin.solicitar({ tipo: "pausar" }, "atacante", "tentativa de pausar sem autorização")).toEqual({ ok: false, erro: "nao_autorizado" });
    const p = s.admin.solicitar({ tipo: "pausar" }, "op-alfa", "pausa operacional de teste");
    if (!p.ok) throw new Error();
    expect(await s.admin.confirmar(p.id, "op-alfa", p.frase)).toEqual({ ok: false, erro: "mesmo_operador" });
    expect((await s.admin.confirmar(p.id, "op-beta", p.frase)).ok).toBe(true);
    expect(await s.admin.confirmar(p.id, "op-beta", p.frase)).toEqual({ ok: false, erro: "pedido_usado" });
    expect(await s.admin.confirmar(p.id, "atacante", p.frase)).toEqual({ ok: false, erro: "nao_autorizado" });
  });
});
