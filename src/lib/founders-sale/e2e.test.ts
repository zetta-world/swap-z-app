import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { configDeEnsaio, montarEnsaio, abrirAteAllowlist, abrirPublica, comprar, acompanharAte, inscricaoSintetica, carteiraSintetica, adminExecuta, T0 } from "./cenario-local";
import { contagem, RelogioDaVenda } from "./relogio";
import { estadoDaUI, visaoProgresso } from "./visao";
import { verificarCadeia } from "./evidencia";
import { pacoteDeValidacao } from "./demanda";
import { funil } from "./funil";
import { TIERS, type TierVenda } from "./config";

/**
 * ENSAIO PONTA A PONTA LOCAL — identidades sintéticas, carteiras/SOL/mint/e-mail/tempo falsos, nada externo.
 * inscrição → e-mail falso → assinatura falsa → elegibilidade → tier → snapshot → congelamento → Merkle →
 * preço congelado → venda allowlist → reserva → pagamento/mint falso → confirmação → progresso → pública →
 * esgotado → onboarding. Supply reduzido SÓ no ensaio (para esgotar em teste); a config aprovada fica intacta.
 */
const h16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const h64 = (s: string) => createHash("sha256").update(s).digest("hex");

async function ensaioCompleto(semente: string) {
  const cfg = configDeEnsaio({ supplyPago: { PRO: 24, TRADER: 8, PILOT: 2 } });
  const m = montarEnsaio({ cfg });
  const s = m.servico;
  const ins = [
    ...Array.from({ length: 12 }, (_, i) => inscricaoSintetica(i, "PRO")),
    ...Array.from({ length: 4 }, (_, i) => inscricaoSintetica(100 + i, "TRADER")),
    inscricaoSintetica(200, "PILOT"),
    inscricaoSintetica(300, "PRO", { pais: "YY" }),      // país fora da política sintética
  ];
  const tel = (e: Record<string, unknown>) => s.registrar({ sessao: h16(semente + JSON.stringify(e)).slice(0, 16), ...e });
  tel({ nome: "founders_page_view", pagina: "founders", idioma: "pt", origem: "direto" });
  const snap = await abrirAteAllowlist(m, ins, [{ carteira: carteiraSintetica("curado-pilot"), tier: "PILOT", motivo: "apoiador fundador (ensaio)" }]);
  const elegiveis = snap.entradas;
  // countdown: projeção do relógio do servidor
  const rc = new RelogioDaVenda(() => 0); rc.sincronizar(m.relogio.t);
  const cont = contagem({ inicioMs: cfg.horarios.publicaAbre, fimMs: cfg.horarios.vendaFecha }, rc.agora());
  // allowlist: cada elegível compra 1
  const recibos: string[] = [];
  for (const e of elegiveis) {
    const r = await comprar(m, e.carteira, e.tier, `al-${e.carteira}-${e.tier}`);
    if (!r.ok) throw new Error(`compra_allowlist:${r.erro}`);
    const a = await acompanharAte(m, r.assinatura);
    if (a.status !== "CONFIRMED") throw new Error(`confirmacao:${a.status}`);
    recibos.push(a.txId);
    tel({ nome: "tx_confirmed", intencao_hash: h64(e.carteira), tx_hash_ref: h64(a.txId), duracao_ms: 1000 });
  }
  const aposAllowlist = s.progresso();
  // pública: compradores novos até esgotar Pro e Trader (Pilot não vende na pública)
  await abrirPublica(m);
  let n = 1000;
  for (const tier of ["PRO", "TRADER"] as TierVenda[]) {
    while (s.progresso().porTier[tier].available > 0) {
      const w = carteiraSintetica(`pub-${semente}-${n++}`);
      const r = await comprar(m, w, tier, `pb-${w}`, { unidades: 1 });
      if (!r.ok) throw new Error(`compra_publica:${r.erro}`);
      const a = await acompanharAte(m, r.assinatura);
      if (a.status !== "CONFIRMED") throw new Error(`conf_publica:${a.status}`);
    }
  }
  return { m, s, snap, cont, recibos, aposAllowlist, final: s.progresso(), estado: s.autoridade.ler(), ins };
}

describe("ensaio ponta a ponta local", () => {
  it("fluxo completo: allowlist → pública → esgotado (Pro/Trader) e Pilot não vendido fica não mintado", async () => {
    const r = await ensaioCompleto("a");
    expect(r.snap.congelado).toBe(true);
    expect(r.snap.entradas.length).toBe(18); // 12 Pro + 4 Trader + 1 Pilot (EA) + 1 Pilot curado; país YY fora
    expect(r.cont.tipo).toBe("antes");
    expect(r.aposAllowlist.porTier).toMatchObject({ PRO: { minted: 12, available: 12 }, TRADER: { minted: 4, available: 4 }, PILOT: { minted: 2, available: 0 } });
    expect(r.final.porTier).toMatchObject({ PRO: { minted: 24, reserved: 0, available: 0 }, TRADER: { minted: 8, available: 0 }, PILOT: { minted: 2, available: 0 } });
    expect(r.estado.publico).toBe("SOLD_OUT");
    for (const t of TIERS) { const p = r.final.porTier[t]; expect(p.minted + p.reserved + p.available).toBe(p.paid_supply); }
    expect(verificarCadeia(r.s.evidencia.todos())).toEqual({ ok: true });
    const tipos = new Set(r.s.evidencia.todos().map((x) => x.tipo));
    for (const t of ["allowlist_snapshot", "merkle_root", "proof_version", "sale_config_fingerprint", "mock_tx_lifecycle", "admin_audit", "sold_out_reconciliation"]) expect(tipos.has(t as never)).toBe(true);
    // onboarding do holder: tier, Founder, janela de 36 meses a partir do encerramento oficial (= esgotamento)
    const ob = r.s.onboarding(r.snap.entradas[0].carteira);
    expect(ob.founder).toBe(true);
    expect(ob.janelaPremium.estado).toBe("DEFINIDA");
    expect(ob.regraPremium).toMatch(/36 meses/);
    expect(ob.beneficios.every((b) => b.grupo !== "C_EXCLUIDO")).toBe(true);
    // projeção da UI a partir do estado autoritativo
    const p = r.final.porTier.PRO;
    expect(visaoProgresso({ supply: p.paid_supply, mintados: p.minted, reservados: p.reserved })).toMatchObject({ tipo: "ok", percentualMintado: 100 });
    expect(estadoDaUI({ venda: r.estado.venda, contagem: { tipo: "durante", restanteMs: null }, elegibilidade: "desconhecida", tx: "ocioso", txId: null })).toBe("SOLD_OUT");
  });

  it("três execuções independentes: mesmo snapshot, mesma raiz, mesmos totais (determinístico)", async () => {
    const rs = await Promise.all(["x", "y", "z"].map(ensaioCompleto));
    expect(new Set(rs.map((r) => r.snap.id)).size).toBe(1);
    expect(new Set(rs.map((r) => r.snap.raiz)).size).toBe(1);
    expect(new Set(rs.map((r) => JSON.stringify(r.final))).size).toBe(1);
  });

  it("validação de demanda e funil sobre o ensaio: sem coleta real não há veredito, nada FINAL", async () => {
    const r = await ensaioCompleto("d");
    const pacote = pacoteDeValidacao(r.ins, r.m.cfg, r.m.relogio.t);
    expect(pacote.avaliacao.status).toBe("AWAITING_REAL_COLLECTION");
    expect(pacote.avaliacao.versaoRegra).toBe(1);
    expect(pacote.statusPreco).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    const f = funil(r.s.telemetria);
    expect(f.sessoesPorEtapa.LANDING).toBe(1);
    expect(f.sessoesPorEtapa.PURCHASE).toBe(18);
    expect(r.s.telemetriaRecusada).toBe(0);
  });

  it("negativos: fora da allowlist, rede errada, preço adulterado, antes de abrir, em pausa, depois de encerrar", async () => {
    const m = montarEnsaio();
    const ins = Array.from({ length: 4 }, (_, i) => inscricaoSintetica(i, "PRO"));
    expect(await comprar(m, carteiraSintetica(0), "PRO", "cedo")).toEqual({ ok: false, erro: "venda_fechada" });
    await abrirAteAllowlist(m, ins);
    expect(await comprar(m, carteiraSintetica("intruso"), "PRO", "n1")).toEqual({ ok: false, erro: "prova_ausente" });
    expect(await comprar(m, carteiraSintetica(0), "PRO", "n2", { rede: "solana:mainnet-beta" })).toEqual({ ok: false, erro: "rede_errada" });
    const s = m.servico;
    const preco = s.precos.precoDaFase("allowlist")!;
    const { provaPara } = await import("./allowlist-hibrida");
    const prova = provaPara(s.admin.snapshot()!, carteiraSintetica(1), "PRO")!;
    expect(await s.comprar({ carteira: carteiraSintetica(1), tier: "PRO", unidades: 1, chave: "n3", rede: "solana:localnet-fake", prova, lamports: "1", precoFingerprint: preco.fingerprint })).toEqual({ ok: false, erro: "preco_adulterado" });
    await adminExecuta(s, { tipo: "pausar" });
    expect(await comprar(m, carteiraSintetica(1), "PRO", "n4")).toEqual({ ok: false, erro: "venda_fechada" });
    await adminExecuta(s, { tipo: "retomar" });
    expect((await comprar(m, carteiraSintetica(1), "PRO", "n5")).ok).toBe(true);
    m.relogio.ir(m.cfg.horarios.vendaFecha!);
    await s.autoridade.tick();
    expect(s.autoridade.ler().publico).toBe("ENDED");
    expect(await comprar(m, carteiraSintetica(2), "PRO", "n6")).toEqual({ ok: false, erro: "venda_fechada" });
  });
});
