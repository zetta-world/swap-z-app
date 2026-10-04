import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { configDeEnsaio, montarEnsaio, abrirAteAllowlist, abrirPublica, comprar, acompanharAte, inscricaoSintetica, carteiraSintetica, adminExecuta, T0 } from "./cenario-local";
import { verificarProva, provaPara, snapshotIntegro } from "./allowlist-hibrida";
import { contagem, RelogioDaVenda } from "./relogio";
import { verificarCadeia } from "./evidencia";
import { funil } from "./funil";
import { TIERS, type TierVenda } from "./config";

/**
 * ENSAIO LOCAL FOUNDERS (fase 28) — identidades sintéticas, carteiras/SOL/mint/e-mail/tempo falsos, nada externo.
 * Cada flag é CALCULADA do que aconteceu no ensaio (nada é afirmado sem medir). Com FOUNDERS_ENSAIO_OUT grava o
 * relatório JSON da evidência. COPY_GUARDS e SECURITY_TESTS vêm das suítes próprias (guardas-*, adversarial).
 */
const h = (s: string, n = 64) => createHash("sha256").update(s).digest("hex").slice(0, n);

describe("ensaio local Founders — relatório de flags", () => {
  it("todas as flags do ensaio calculadas e PASS; OVERSELL = 0", async () => {
    const cfg = configDeEnsaio({ supplyPago: { PRO: 30, TRADER: 10, PILOT: 3 } });
    const m = montarEnsaio({ cfg });
    const s = m.servico;
    const flags: Record<string, string | number> = {};
    const tel = (sessao: string, e: Record<string, unknown>) => s.registrar({ sessao: h(sessao, 16), ...e });

    // inscrição → e-mail falso → assinatura falsa → elegibilidade → tier
    const ins = [...Array.from({ length: 15 }, (_, i) => inscricaoSintetica(i, "PRO")), ...Array.from({ length: 5 }, (_, i) => inscricaoSintetica(100 + i, "TRADER")), ...Array.from({ length: 2 }, (_, i) => inscricaoSintetica(200 + i, "PILOT")),
      inscricaoSintetica(300, "indeciso"), inscricaoSintetica(301, "PRO", { pais: "YY" })];
    for (const i of ins) { tel(i.id, { nome: "founders_page_view", pagina: "founders", idioma: "pt", origem: "direto" }); tel(i.id, { nome: "whitelist_start", origem: "landing" }); }
    const snap = await abrirAteAllowlist(m, ins, [{ carteira: carteiraSintetica("curado"), tier: "PILOT", motivo: "apoiador fundador (ensaio)" }]);
    for (const i of ins) { tel(i.id, { nome: "email_verified", inscricao_hash: h(i.id) }); tel(i.id, { nome: "tier_preference_selected", inscricao_hash: h(i.id), tier: i.preferenciaTier === "indeciso" ? "PRO" : i.preferenciaTier! }); }
    flags.ALLOWLIST_FLOW = snap.entradas.length === 15 + 5 + 2 + 1 && s.todasInscricoes().every((i) => i.emailVerificado && i.carteiraAssinada) ? "PASS" : "FAIL";
    flags.SNAPSHOT_FREEZE = snap.congelado && Object.isFrozen(snap.entradas) && snapshotIntegro(snap) && s.autoridade.ler().snapshotId === snap.id ? "PASS" : "FAIL";
    flags.MERKLE_PROOF = snap.entradas.every((e) => verificarProva(snap, provaPara(snap, e.carteira, e.tier)!))
      && !verificarProva(snap, { ...provaPara(snap, snap.entradas[0].carteira, snap.entradas[0].tier)!, entrada: { ...snap.entradas[0], quantidade: 9 } }) ? "PASS" : "FAIL";
    const pzA = s.precos.precoDaFase("allowlist")!;
    m.provedor.definir(9999);
    flags.PRICE_FREEZE = s.precos.precoDaFase("allowlist")!.fingerprint === pzA.fingerprint && Object.isFrozen(pzA) && (await s.precos.congelarFase("allowlist")).ok === false ? "PASS" : "FAIL";
    m.provedor.definir(150);
    const rc = new RelogioDaVenda(() => 0); rc.sincronizar(m.relogio.t);
    const c = contagem({ inicioMs: cfg.horarios.publicaAbre, fimMs: cfg.horarios.vendaFecha }, rc.agora());
    flags.COUNTDOWN = c.tipo === "antes" && c.restanteMs === cfg.horarios.publicaAbre! - m.relogio.t ? "PASS" : "FAIL";

    // venda allowlist: alocação 1 por tier; transações confirmadas só com recibo
    let alocOk = true, txOk = true;
    for (const e of snap.entradas) {
      tel(e.carteira, { nome: "wallet_connected", carteira_hash: h(e.carteira), tipo_carteira: "falsa", rede_ok: true });
      tel(e.carteira, { nome: "wallet_signed", carteira_hash: h(e.carteira), inscricao_hash: h(e.carteira) });
      tel(e.carteira, { nome: "eligibility_checked", carteira_hash: h(e.carteira), resultado: "eligible", snapshot_id: snap.id });
      const r = await comprar(m, e.carteira, e.tier, `al-${e.carteira}-${e.tier}`);
      if (!r.ok) { alocOk = false; continue; }
      tel(e.carteira, { nome: "purchase_intent", carteira_hash: h(e.carteira), tier: e.tier, unidades: 1, intencao_hash: h(r.reservaId) });
      tel(e.carteira, { nome: "wallet_prompt", intencao_hash: h(r.reservaId) });
      tel(e.carteira, { nome: "tx_submitted", intencao_hash: h(r.reservaId), tx_hash_ref: h(r.assinatura) });
      const a1 = await s.acompanhar(r.assinatura);
      if (a1.status === "CONFIRMED") txOk = false; // 1º recibo ainda é pending: confirmação não pode ser imediata
      const a = await acompanharAte(m, r.assinatura);
      if (a.status !== "CONFIRMED") txOk = false;
      else tel(e.carteira, { nome: "tx_confirmed", intencao_hash: h(r.reservaId), tx_hash_ref: h(a.txId), duracao_ms: 1 });
      if ((await comprar(m, e.carteira, e.tier, `al2-${e.carteira}-${e.tier}`)).ok) alocOk = false; // teto 1 na allowlist
    }
    flags.ALLOCATION = alocOk ? "PASS" : "FAIL";

    // pausa do admin (2 operadores) e retomada
    const p = await adminExecuta(s, { tipo: "pausar" });
    const bloqueada = await comprar(m, carteiraSintetica("x"), "PRO", "pausa-x");
    const rr = await adminExecuta(s, { tipo: "retomar" });
    flags.ADMIN_PAUSE = p.ok && !bloqueada.ok && rr.ok && s.autoridade.ler().publico === "ALLOWLIST_SALE" ? "PASS" : "FAIL";

    // pública até esgotar; corrida concorrente pela sobra
    await abrirPublica(m);
    const corrida = await Promise.all(Array.from({ length: 200 }, (_, i) => comprar(m, carteiraSintetica(`corrida-${i}`), (i % 2 ? "TRADER" : "PRO") as TierVenda, `corrida-${i}`)));
    for (const r of corrida) if (r.ok) { const a = await acompanharAte(m, r.assinatura); if (a.status !== "CONFIRMED") txOk = false; }
    flags.TX_LIFECYCLE = txOk ? "PASS" : "FAIL";
    const fim = s.progresso();
    flags.OVERSELL = TIERS.reduce((acc, t) => acc + Math.max(0, fim.porTier[t].minted + fim.porTier[t].reserved - fim.porTier[t].paid_supply), 0);
    flags.SOLD_OUT = s.autoridade.ler().publico === "SOLD_OUT" && fim.total.available === 0 && fim.total.reserved === 0 ? "PASS" : "FAIL";
    flags.SALE_STATE_MACHINE = verificarCadeia(s.evidencia.todos()).ok
      && s.evidencia.todos().filter((x) => x.dados.evento === "transicao_autoritativa").map((x) => x.dados.para).join(">") === "inscricao_aberta>allowlist_congelada>allowlist_aberta>pausada>allowlist_aberta>publica_aberta>esgotada" ? "PASS" : "FAIL";
    const ob = s.onboarding(snap.entradas[0].carteira);
    flags.POST_PURCHASE = ob.founder && ob.janelaPremium.estado === "DEFINIDA" && ob.beneficios.every((b) => b.grupo !== "C_EXCLUIDO") ? "PASS" : "FAIL";
    const f = funil(s.telemetria);
    flags.TELEMETRY = s.telemetriaRecusada === 0 && f.sessoesPorEtapa.PURCHASE === snap.entradas.length && f.eventosDescartados === 0 ? "PASS" : "FAIL";

    for (const [k, v] of Object.entries(flags)) expect(v, k).toBe(k === "OVERSELL" ? 0 : "PASS");
    const rel = { gerado_em_simulado: new Date(T0).toISOString(), supply_de_simulacao: cfg.supplyPago, inscricoes: ins.length, snapshot: { id: snap.id, raiz: snap.raiz, entradas: snap.entradas.length },
      vendido: Object.fromEntries(TIERS.map((t) => [t, fim.porTier[t]])), corrida_concorrente: { pedidos: corrida.length, aceitos: corrida.filter((r) => r.ok).length },
      funil: f.sessoesPorEtapa, eventos_de_evidencia: s.evidencia.todos().length, flags };
    const out = process.env.FOUNDERS_ENSAIO_OUT;
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(join(out, "ensaio-local.json"), JSON.stringify(rel, null, 2)); }
  });
});
