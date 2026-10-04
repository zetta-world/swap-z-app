import { describe, it, expect } from "vitest";
import { CONFIG_APROVADA, validarConfig, fingerprintConfig, pendencias, grossTeoricoUsd, reservaEfetiva, configurado, type ConfigVenda } from "./config";
import { VendaAutoritativa, ArmazemEmMemoria, estadoInicial } from "./autoridade";
import { cotar, lamportsPara, formatarSol, PrecosDaVenda, ProvedorReferenciaFixo } from "./preco";
import { EstoqueDaVenda } from "./estoque";
import { avaliar, alocar, criarSnapshotAlocacao, congelar, snapshotIntegro, provaPara, verificarProva, normalizarSolana } from "./allowlist-hibrida";
import { relatorio, avaliarDemanda, pacoteDeValidacao, minimosDemanda, minimoInteiro, fingerprintRegraDemanda } from "./demanda";
import { proximoEstadoCarteira, AssinadorFalso, CadeiaFalsa, lerRecibo, mensagemDePosse, REDE_DA_VENDA, type EstadoCarteira, type EventoCarteira } from "./carteira";
import { somarMesesUtc, janelaPremium, premiumAtivo, beneficiosPublicaveis, BENEFICIOS, TAXA_SWAP_BPS, relacaoPlanoMensal } from "./beneficios";
import { funil } from "./funil";
import { estadoTxPublico, ESTADOS_TX_PUBLICOS } from "./ciclo-tx";
import { configDeEnsaio, carteiraSintetica, inscricaoSintetica, RelogioManual, T0, PARAMETROS_CONVERSAO_TESTE } from "./cenario-local";
import { TIER_FEE_BPS } from "@/lib/tier/fees";

const H = 3_600_000;

describe("configuração: aprovado como dado, pendente como estado", () => {
  it("valores aprovados pelo dono e gross teórico (cenário) = 796.250", () => {
    expect(CONFIG_APROVADA.supplyPago).toEqual({ PRO: 2000, TRADER: 750, PILOT: 100 });
    expect(CONFIG_APROVADA.precoUsd).toEqual({ PRO: 149, TRADER: 399, PILOT: 1990 });
    expect(CONFIG_APROVADA.statusPreco).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    expect(grossTeoricoUsd(CONFIG_APROVADA)).toEqual({ porTier: { PRO: 298000, TRADER: 299250, PILOT: 199000 }, total: 796250 });
    expect(validarConfig(CONFIG_APROVADA)).toEqual([]);
  });
  it("pendências explícitas e nunca lidas como valor", () => {
    const p = pendencias(CONFIG_APROVADA);
    const refs = new Set(p.map((x) => x.ref));
    for (const r of ["OD-NFT-02", "OD-NFT-08", "OD-NFT-11", "OD-NFT-16", "OD-NFT-17", "OD-NFT-21", "OD-NFT-22"]) expect([...refs].some((x) => x.includes(r.slice(3)))).toBe(true);
    // decididos em 04/10 (rev. 4): não aparecem mais como pendência
    for (const c of ["reserva", "royalty.percentual", "relacaoPlanoMensal"]) expect(p.find((x) => x.campo === c)).toBeUndefined();
    expect(p.find((x) => x.campo === "juridico.paisesPermitidos")?.estado).toBe("PENDING_LEGAL");
    // única pendência do DONO: identidades humanas dos signatários
    expect(p.filter((x) => x.estado === "PENDING_OWNER").map((x) => x.campo)).toEqual(["tesouraria.signatarios"]);
    expect(reservaEfetiva(CONFIG_APROVADA)).toEqual({ porTier: { PRO: 30, TRADER: 10, PILOT: 0 }, origem: "CONFIGURADA" });
  });
  it("validação recusa rede real, royalty a holders, premium ≠ 36, preço FINAL sem validação, reserva sem finalidade, horários fora de ordem", () => {
    const bad = (o: Partial<ConfigVenda>) => validarConfig({ ...CONFIG_APROVADA, ...o });
    expect(bad({ rede: "solana:mainnet-beta" as never })).toContain("rede_nao_permitida");
    expect(bad({ royalty: { ...CONFIG_APROVADA.royalty, distribuicaoAHolders: true as never } })).toContain("royalty_fora_da_politica");
    expect(bad({ premium: { meses: 24 as never, inicio: "ENCERRAMENTO_OFICIAL_DA_VENDA" } })).toContain("premium_fora_da_politica");
    expect(bad({ statusPreco: "FINAL" })).toContain("preco_final_sem_validacao_de_demanda");
    const fins = ["PARCEIRO_ESTRATEGICO_ECOSSISTEMA"] as const;
    expect(bad({ reserva: configurado({ PRO: [{ quantidade: 5, finalidade: "", finalidadesPermitidas: fins }], TRADER: [], PILOT: [] }, "t") })).toContain("reserva_sem_finalidade:PRO");
    expect(bad({ reserva: configurado({ PRO: [{ quantidade: 5, finalidade: "alocação da equipe", finalidadesPermitidas: ["EQUIPE" as never] }], TRADER: [], PILOT: [] }, "t") })).toContain("reserva_finalidade_fora_da_politica:PRO");
    expect(bad({ reserva: configurado({ PRO: [], TRADER: [], PILOT: [{ quantidade: 1, finalidade: "sorteio de Pilot", finalidadesPermitidas: fins }] }, "t") })).toContain("reserva_pilot_proibida");
    expect(bad({ reserva: configurado({ PRO: [{ quantidade: 31, finalidade: "parceiros do ecossistema", finalidadesPermitidas: fins }], TRADER: [], PILOT: [] }, "t") })).toContain("reserva_acima_do_aprovado:PRO");
    expect(bad({ royalty: { ...CONFIG_APROVADA.royalty, publico: true as never } })).toContain("royalty_nao_pode_ser_beneficio_publico");
    expect(bad({ validacaoDemanda: { ...CONFIG_APROVADA.validacaoDemanda, regra: { ...CONFIG_APROVADA.validacaoDemanda.regra, qualificadoBps: 3000 as never } } })).toContain("regra_de_demanda_alterada_sem_nova_versao");
    expect(bad({ tesouraria: { ...CONFIG_APROVADA.tesouraria, limiarPlanejado: { m: 1 as never, n: 3 } } })).toContain("tesouraria_signatario_unico");
    expect(bad({ horarios: { inscricaoAbre: 10, inscricaoFecha: 5, allowlistAbre: null, publicaAbre: null, vendaFecha: null } })).toContain("horario_fora_de_ordem:inscricaoFecha");
  });
  it("fingerprint determinístico e sensível a qualquer mudança", () => {
    expect(fingerprintConfig(CONFIG_APROVADA)).toBe(fingerprintConfig(JSON.parse(JSON.stringify(CONFIG_APROVADA))));
    expect(fingerprintConfig({ ...CONFIG_APROVADA, precoUsd: { ...CONFIG_APROVADA.precoUsd, PRO: 150 } })).not.toBe(fingerprintConfig(CONFIG_APROVADA));
  });
});

describe("autoridade: servidor manda, relógio do servidor, versão otimista", () => {
  const mk = (cfg = configDeEnsaio()) => { const r = new RelogioManual(T0); return { r, a: new VendaAutoritativa(cfg, r.agora, new ArmazemEmMemoria(estadoInicial(T0))) }; };

  it("config aprovada sem datas NÃO abre (sem_horario) — OD-NFT-08", async () => {
    const { a } = mk(CONFIG_APROVADA);
    expect((await a.transicionar("abrir_inscricao", { versaoEsperada: 0 })).ok).toBe(false);
    expect(a.ler().publico).toBe("COMING_SOON");
  });
  it("fluxo completo com horários; abertura antecipada recusada; abertura atrasada aceita", async () => {
    const { r, a } = mk();
    const h = configDeEnsaio().horarios;
    r.ir(h.inscricaoAbre! - 1);
    expect(await a.transicionar("abrir_inscricao", { versaoEsperada: 0 })).toMatchObject({ ok: false, erro: "cedo_demais" });
    r.ir(h.inscricaoAbre! + 5 * H); // atrasado: ok
    expect((await a.transicionar("abrir_inscricao", { versaoEsperada: 0 })).ok).toBe(true);
    expect(await a.transicionar("congelar_allowlist", { versaoEsperada: 1, snapshotId: "s" })).toMatchObject({ ok: false, erro: "cedo_demais" });
    r.ir(h.inscricaoFecha!);
    expect(await a.transicionar("congelar_allowlist", { versaoEsperada: 1 })).toMatchObject({ ok: false, erro: "snapshot_necessario" });
    expect((await a.transicionar("congelar_allowlist", { versaoEsperada: 1, snapshotId: "snap" })).ok).toBe(true);
    r.ir(h.allowlistAbre!);
    expect((await a.transicionar("abrir_allowlist", { versaoEsperada: 2 })).ok).toBe(true);
    expect(a.ler().publico).toBe("ALLOWLIST_SALE");
    r.ir(h.publicaAbre!);
    expect((await a.tick()).publico).toBe("PUBLIC_SALE");
    expect((await a.tick()).versao).toBe(4); // idempotente
    r.ir(h.vendaFecha!);
    expect((await a.tick()).publico).toBe("ENDED");
  });
  it("pausa/retoma; fase expira mesmo em pausa; transição inválida", async () => {
    const { r, a } = mk();
    const h = configDeEnsaio().horarios;
    r.ir(h.inscricaoAbre!); await a.transicionar("abrir_inscricao", { versaoEsperada: 0 });
    r.ir(h.inscricaoFecha!); await a.transicionar("congelar_allowlist", { versaoEsperada: 1, snapshotId: "s" });
    r.ir(h.allowlistAbre!); await a.transicionar("abrir_allowlist", { versaoEsperada: 2 });
    expect(await a.transicionar("abrir_inscricao", { versaoEsperada: 3 })).toMatchObject({ ok: false, erro: "transicao_proibida" });
    expect((await a.transicionar("pausar", { versaoEsperada: 3 })).ok).toBe(true);
    expect((await a.transicionar("retomar", { versaoEsperada: 4 })).estado.publico).toBe("ALLOWLIST_SALE");
    await a.transicionar("pausar", { versaoEsperada: 5 });
    r.ir(h.vendaFecha!);
    expect((await a.tick()).publico).toBe("ENDED");
  });
  it("replay e 20 transições concorrentes com a mesma versão: exatamente UMA vence", async () => {
    const { r, a } = mk();
    r.ir(configDeEnsaio().horarios.inscricaoAbre!);
    const rs = await Promise.all(Array.from({ length: 20 }, () => a.transicionar("abrir_inscricao", { versaoEsperada: 0 })));
    expect(rs.filter((x) => x.ok)).toHaveLength(1);
    expect(rs.filter((x) => !x.ok && x.erro === "versao_desatualizada")).toHaveLength(19);
    expect(a.ler().versao).toBe(1);
  });
  it("banco indisponível falha fechado", async () => {
    const r = new RelogioManual(configDeEnsaio().horarios.inscricaoAbre!);
    const a = new VendaAutoritativa(configDeEnsaio(), r.agora, { ler: () => { throw new Error("db"); }, gravar: () => { throw new Error("db"); } });
    expect(await a.transicionar("abrir_inscricao", { versaoEsperada: 0 })).toMatchObject({ ok: false, erro: "armazenamento_indisponivel" });
  });
});

describe("preço: âncora USD, snapshot-e-congela, lamports arredondados para cima", () => {
  it("arredondamento exato (inteiros) — 149/399/1990 a SOL=150", () => {
    expect(lamportsPara(14900n, 150_000_000n)).toBe(993_333_334n);
    expect(lamportsPara(39900n, 150_000_000n)).toBe(2_660_000_000n);
    expect(lamportsPara(199000n, 150_000_000n)).toBe(13_266_666_667n);
    expect(formatarSol(993_333_334n)).toBe("0.993333334");
    expect(formatarSol(2_660_000_000n)).toBe("2.66");
  });
  it("referência ausente, inválida e velha não congelam", () => {
    expect(cotar(CONFIG_APROVADA, "allowlist", null, T0, 60_000)).toEqual({ ok: false, erro: "referencia_ausente" });
    for (const solUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(cotar(CONFIG_APROVADA, "allowlist", { solUsd, em: T0, fonte: "f" }, T0, 60_000)).toEqual({ ok: false, erro: "referencia_invalida" });
    expect(cotar(CONFIG_APROVADA, "allowlist", { solUsd: 150, em: T0 - 60_001, fonte: "f" }, T0, 60_000)).toEqual({ ok: false, erro: "referencia_velha" });
    expect(cotar(CONFIG_APROVADA, "allowlist", { solUsd: 150, em: T0 + 1, fonte: "f" }, T0, 60_000)).toEqual({ ok: false, erro: "referencia_velha" });
  });
  it("mudança de taxa antes do congelamento conta; depois, não; congelado é imutável; recongelar recusa", async () => {
    const r = new RelogioManual(T0);
    const prov = new ProvedorReferenciaFixo(150, r.agora);
    const precos = new PrecosDaVenda(CONFIG_APROVADA, prov, r.agora);
    prov.definir(200); // antes do congelamento
    const a = await precos.congelarFase("allowlist");
    if (!a.ok) throw new Error(a.erro);
    expect(a.preco.tiers.PRO.lamports).toBe(lamportsPara(14900n, 200_000_000n).toString());
    prov.definir(10); // depois
    expect(precos.precoDaFase("allowlist")!.tiers.PRO.lamports).toBe(a.preco.tiers.PRO.lamports);
    expect(Object.isFrozen(a.preco) && Object.isFrozen(a.preco.tiers) && Object.isFrozen(a.preco.tiers.PRO)).toBe(true);
    expect(() => { (a.preco.tiers.PRO as { lamports: string }).lamports = "1"; }).toThrow();
    expect(await precos.congelarFase("allowlist")).toEqual({ ok: false, erro: "fase_ja_congelada" });
    const b = await precos.congelarFase("publica"); // transição de fase: novo snapshot, nova taxa
    expect(b.ok && b.preco.tiers.PRO.lamports).toBe(lamportsPara(14900n, 10_000_000n).toString());
    expect(a.preco.fingerprint).not.toBe(b.ok ? b.preco.fingerprint : "");
  });
  it("adulteração de preço, tier errado, fase não congelada, provedor fora", async () => {
    const r = new RelogioManual(T0);
    const prov = new ProvedorReferenciaFixo(150, r.agora);
    const precos = new PrecosDaVenda(CONFIG_APROVADA, prov, r.agora);
    expect(precos.conferir("allowlist", "PRO", "1", "x")).toEqual({ ok: false, erro: "fase_nao_congelada" });
    prov.derrubar(true);
    expect(await precos.congelarFase("allowlist")).toEqual({ ok: false, erro: "provedor_indisponivel" });
    prov.derrubar(false);
    const a = await precos.congelarFase("allowlist"); if (!a.ok) throw new Error();
    expect(precos.conferir("allowlist", "GOLD", a.preco.tiers.PRO.lamports, a.preco.fingerprint)).toEqual({ ok: false, erro: "tier_invalido" });
    expect(precos.conferir("allowlist", "PRO", "1", a.preco.fingerprint)).toEqual({ ok: false, erro: "preco_adulterado" });
    expect(precos.conferir("allowlist", "PRO", a.preco.tiers.TRADER.lamports, a.preco.fingerprint)).toEqual({ ok: false, erro: "preco_adulterado" });
    expect(precos.conferir("allowlist", "PRO", a.preco.tiers.PRO.lamports, "f".repeat(64))).toEqual({ ok: false, erro: "preco_adulterado" });
    expect(precos.conferir("allowlist", "PRO", a.preco.tiers.PRO.lamports, a.preco.fingerprint).ok).toBe(true);
  });
});

describe("estoque: sem oversell, tetos por fase, reservas", () => {
  const mk = (supplyPro = 2000, validade = 60_000) => {
    const r = new RelogioManual(T0);
    const cfg = { ...CONFIG_APROVADA, supplyPago: { ...CONFIG_APROVADA.supplyPago, PRO: supplyPro } };
    return { r, e: new EstoqueDaVenda(cfg, r.agora, validade) };
  };
  it("500 pedidos concorrentes por 100 unidades: OVERSOLD = 0 e a conta fecha", async () => {
    const { e } = mk(100);
    const rs = await Promise.all(Array.from({ length: 500 }, (_, i) => e.reservar({ tier: "PRO", carteira: carteiraSintetica(i), unidades: 1, chave: `k${i}`, fase: "publica", vendaAberta: true, elegivel: true })));
    const ok = rs.filter((x) => x.ok);
    expect(ok).toHaveLength(100);
    expect(rs.filter((x) => !x.ok && x.erro === "esgotado")).toHaveLength(400);
    const s = e.resumo().porTier.PRO;
    expect(s.minted + s.reserved + s.available).toBe(s.paid_supply);
    expect(s.minted + s.reserved).toBeLessThanOrEqual(s.paid_supply);
    expect(Math.max(0, s.minted + s.reserved - s.paid_supply)).toBe(0); // OVERSOLD
  });
  it("corrida pela última unidade: 50 concorrentes, 1 vence; fronteira de esgotado", async () => {
    const { e } = mk(1);
    const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => e.reservar({ tier: "PRO", carteira: carteiraSintetica(i), unidades: 1, chave: `u${i}`, fase: "publica", vendaAberta: true, elegivel: true })));
    expect(rs.filter((x) => x.ok)).toHaveLength(1);
    const venc = rs.find((x) => x.ok)!;
    if (!venc.ok) throw new Error();
    expect((await e.confirmar("PRO", venc.reserva.id)).ok).toBe(true);
    expect(e.resumo().porTier.PRO).toMatchObject({ minted: 1, reserved: 0, available: 0 });
  });
  it("mesma carteira simultânea e retry: teto cumulativo e idempotência", async () => {
    const { e } = mk();
    const w = carteiraSintetica("x");
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => e.reservar({ tier: "PRO", carteira: w, unidades: 1, chave: `w${i}`, fase: "publica", vendaAberta: true, elegivel: true })));
    expect(rs.filter((x) => x.ok)).toHaveLength(2); // teto público Pro = 2
    const retry = await e.reservar({ tier: "PRO", carteira: w, unidades: 1, chave: "w0", fase: "publica", vendaAberta: true, elegivel: true });
    expect(retry.ok && retry.replay).toBe(true);
    expect(e.alocacao(w, "PRO", "publica", null)).toEqual({ granted: 2, used: 2, remaining: 0 });
  });
  it("allowlist: teto = min(fase, concedido); concedido 0 = nada; Pilot fora da allowlist recusado", async () => {
    const { e } = mk();
    const w = carteiraSintetica("y");
    expect(await e.reservar({ tier: "PRO", carteira: w, unidades: 1, chave: "a0", fase: "allowlist", vendaAberta: true, elegivel: true, concedido: 0 })).toMatchObject({ ok: false, erro: "teto_da_carteira" });
    expect((await e.reservar({ tier: "PRO", carteira: w, unidades: 1, chave: "a1", fase: "allowlist", vendaAberta: true, elegivel: true, concedido: 5 })).ok).toBe(true);
    expect(await e.reservar({ tier: "PRO", carteira: w, unidades: 1, chave: "a2", fase: "allowlist", vendaAberta: true, elegivel: true, concedido: 5 })).toMatchObject({ ok: false, erro: "teto_da_carteira" });
    expect(await e.reservar({ tier: "PILOT", carteira: w, unidades: 1, chave: "p1", fase: "publica", vendaAberta: true, elegivel: true })).toEqual({ ok: false, erro: "tier_fora_da_fase" });
    expect(await e.reservar({ tier: "GOLD", carteira: w, unidades: 1, chave: "g", fase: "publica", vendaAberta: true, elegivel: true })).toEqual({ ok: false, erro: "tier_invalido" });
  });
  it("reserva expirada e cancelada liberam unidade; confirmar expirada falha", async () => {
    const { r, e } = mk(1, 1000);
    const a = await e.reservar({ tier: "PRO", carteira: carteiraSintetica(1), unidades: 1, chave: "e1", fase: "publica", vendaAberta: true, elegivel: true });
    if (!a.ok) throw new Error();
    r.avancar(1000);
    expect(e.resumo().porTier.PRO.available).toBe(1);
    expect(await e.confirmar("PRO", a.reserva.id)).toEqual({ ok: false, erro: "expirada" });
    const b = await e.reservar({ tier: "PRO", carteira: carteiraSintetica(2), unidades: 1, chave: "e2", fase: "publica", vendaAberta: true, elegivel: true });
    if (!b.ok) throw new Error();
    expect(await e.cancelar("PRO", b.reserva.id)).toBe(true);
    expect(e.resumo().porTier.PRO.available).toBe(1);
  });
});

describe("allowlist híbrida: elegibilidade, alocação, snapshot, Merkle", () => {
  const cfg = configDeEnsaio();
  const q = (n: number, extra = {}) => inscricaoSintetica(n, "PRO", { emailVerificado: true, carteiraAssinada: true, ...extra });

  it("elegibilidade: motivos, política de país configurável, PENDING_LEGAL sem política", () => {
    expect(avaliar(q(1), cfg).estado).toBe("ELIGIBLE");
    expect(avaliar(q(2, { emailVerificado: false }), cfg).motivos).toContain("email_nao_verificado");
    expect(avaliar(q(3, { carteiraAssinada: false }), cfg).motivos).toContain("carteira_nao_assinada");
    expect(avaliar(q(4, { carteira: "0xabc" }), cfg).motivos).toContain("carteira_invalida");
    expect(avaliar(q(5, { preferenciaTier: "indeciso" }), cfg).motivos).toContain("sem_preferencia");
    expect(avaliar(q(6, { pais: "YY" }), cfg)).toMatchObject({ estado: "NOT_ELIGIBLE", motivos: ["pais_nao_permitido"] });
    expect(avaliar(q(7), CONFIG_APROVADA).estado).toBe("PENDING_LEGAL");
    expect(normalizarSolana(carteiraSintetica(1))).toBe(carteiraSintetica(1));
  });
  it("alocação determinística (ordem de entrada não importa), curada vence duplicata, recusas contadas", () => {
    const ins = [q(3), q(1), q(2), q(9, { emailVerificado: false })];
    const a1 = alocar(ins, [{ carteira: carteiraSintetica(1), tier: "PRO", motivo: "apoiador fundador" }, { carteira: carteiraSintetica(50), tier: "PILOT", motivo: "apoiador fundador" }], cfg);
    const a2 = alocar([...ins].reverse(), [{ carteira: carteiraSintetica(50), tier: "PILOT", motivo: "apoiador fundador" }, { carteira: carteiraSintetica(1), tier: "PRO", motivo: "apoiador fundador" }], cfg);
    expect(a1).toEqual(a2);
    expect(a1.entradas).toHaveLength(4);
    expect(a1.recusadas).toBe(1);
    expect(a1.entradas.find((e) => e.carteira === carteiraSintetica(1))?.origem).toBe("curada");
    expect(a1.entradas.every((e) => e.quantidade === 1)).toBe(true);
    expect(criarSnapshotAlocacao(1, a1.entradas).id).toBe(criarSnapshotAlocacao(1, a2.entradas).id);
  });
  it("congelar é imutável; mutação aparece; prova válida; prova de snapshot antigo, adulterada ou de outra carteira falha", () => {
    const { entradas } = alocar([q(1), q(2), q(3), q(4), q(5)], [], cfg);
    const s = criarSnapshotAlocacao(1, entradas);
    expect(() => verificarProva(s, provaPara(s, carteiraSintetica(1), "PRO")!)).not.toThrow();
    expect(verificarProva(s, provaPara(s, carteiraSintetica(1), "PRO")!)).toBe(false); // não congelado
    const c = congelar(s, T0);
    expect(Object.isFrozen(c.entradas) && Object.isFrozen(c.entradas[0])).toBe(true);
    expect(() => { (c.entradas as unknown as object[]).push({}); }).toThrow();
    expect(() => congelar(c, T0)).toThrow("snapshot_ja_congelado");
    for (const e of entradas) expect(verificarProva(c, provaPara(c, e.carteira, "PRO")!)).toBe(true);
    const p = provaPara(c, carteiraSintetica(2), "PRO")!;
    expect(verificarProva(c, { ...p, entrada: { ...p.entrada, quantidade: 2 } })).toBe(false);
    expect(verificarProva(c, { ...p, entrada: { ...p.entrada, carteira: carteiraSintetica(99) } })).toBe(false);
    const longa = c.entradas.map((e) => provaPara(c, e.carteira, "PRO")!).find((x) => x.caminho.length >= 2 && x.caminho[0] !== x.caminho[x.caminho.length - 1])!;
    expect(verificarProva(c, longa)).toBe(true);
    expect(verificarProva(c, { ...longa, caminho: [...longa.caminho].reverse() })).toBe(false);
    expect(verificarProva(c, { ...longa, caminho: longa.caminho.slice(1) })).toBe(false);
    const c2 = congelar(criarSnapshotAlocacao(2, alocar([q(1), q(2)], [], cfg).entradas), T0);
    expect(verificarProva(c2, provaPara(c, carteiraSintetica(1), "PRO")!)).toBe(false); // prova velha
    const mutado = { ...s, entradas: [...s.entradas.slice(1)] };
    expect(snapshotIntegro(s)).toBe(true);
    expect(snapshotIntegro(mutado)).toBe(false);
  });
});

describe("validação de demanda: limiar do dono, sem inventar", () => {
  const ins = [
    ...Array.from({ length: 30 }, (_, i) => inscricaoSintetica(i, "PRO", { emailVerificado: true, carteiraAssinada: true, intencao: i % 2 ? "talvez" : "pretende_comprar" })),
    ...Array.from({ length: 10 }, (_, i) => inscricaoSintetica(100 + i, "TRADER", { emailVerificado: true, carteiraAssinada: true })),
    ...Array.from({ length: 5 }, (_, i) => inscricaoSintetica(200 + i, "PILOT", { emailVerificado: true, carteiraAssinada: true })),
    ...Array.from({ length: 5 }, (_, i) => inscricaoSintetica(300 + i, "indeciso", { emailVerificado: true })),
  ];
  it("relatório por tier, razões e funil", () => {
    const r = relatorio(ins, configDeEnsaio());
    expect(r).toMatchObject({ inscricoes: 50, emailsVerificados: 50, carteirasAssinadas: 45, qualificadas: 45 });
    expect(r.interesseQualificadoPorTier).toEqual({ PRO: 30, TRADER: 10, PILOT: 5 });
    expect(r.razaoInteresseSupply).toEqual({ PRO: 0.015, TRADER: 0.0133, PILOT: 0.05 });
    expect(r.intencaoQualificadaPorTier.PRO).toBe(15);
    expect(r.aviso).toBe("INTENCAO_NAO_VINCULANTE");
  });
  it("regra v1 pré-registrada: mínimos inteiros ⌈35 %⌉ e ⌈20 %⌉ do supply PAGO", () => {
    expect(minimosDemanda(CONFIG_APROVADA)).toEqual({ PRO: { qualificados: 700, intencao: 400 }, TRADER: { qualificados: 263, intencao: 150 }, PILOT: { qualificados: 35, intencao: 20 } });
    expect(minimoInteiro(750, 3500)).toBe(263); // 262,5 → teto
    expect(minimoInteiro(100, 2000)).toBe(20);
    expect(CONFIG_APROVADA.validacaoDemanda.regra).toEqual({ versao: 1, qualificadoBps: 3500, intencaoBps: 2000, arredondamento: "TETO_INTEIRO", passExige: "TODOS_OS_TIERS" });
  });
  it("sem coleta real → AWAITING_REAL_COLLECTION; janela aberta → COLLECTING (sem veredito parcial)", () => {
    const cfg = configDeEnsaio();
    expect(avaliarDemanda(relatorio(ins, cfg), cfg, T0).status).toBe("AWAITING_REAL_COLLECTION");
    const comJanela = configDeEnsaio({ validacaoDemanda: { ...CONFIG_APROVADA.validacaoDemanda, janela: configurado({ inicio: T0, fim: T0 + 1000 }, "TESTE") } });
    expect(avaliarDemanda(relatorio(ins, comJanela), comJanela, T0 + 500).status).toBe("COLLECTING");
  });
  it("PASS / INCONCLUSIVE / FAIL pela regra v1 (contagens sintéticas), com versão e fingerprint da regra", () => {
    const cfg = configDeEnsaio({ validacaoDemanda: { ...CONFIG_APROVADA.validacaoDemanda, janela: configurado({ inicio: T0, fim: T0 + 1000 }, "TESTE") } });
    const base = relatorio([], cfg);
    const com = (q: [number, number, number], i: [number, number, number]) => ({ ...base,
      interesseQualificadoPorTier: { PRO: q[0], TRADER: q[1], PILOT: q[2] }, intencaoQualificadaPorTier: { PRO: i[0], TRADER: i[1], PILOT: i[2] } });
    const fim = T0 + 1000;
    const pass = avaliarDemanda(com([700, 263, 35], [400, 150, 20]), cfg, fim);
    expect(pass).toMatchObject({ status: "PASS", versaoRegra: 1 });
    expect(pass.fingerprintRegra).toBe(fingerprintRegraDemanda(cfg));
    // um tier abaixo, demanda agregada material → INCONCLUSIVE
    expect(avaliarDemanda(com([800, 263, 34], [450, 150, 19]), cfg, fim).status).toBe("INCONCLUSIVE");
    // intenção abaixo num tier mesmo com qualificados acima → não é PASS
    expect(avaliarDemanda(com([700, 263, 35], [400, 149, 20]), cfg, fim).status).not.toBe("PASS");
    // agregado abaixo da soma dos mínimos → FAIL
    expect(avaliarDemanda(com([300, 100, 10], [100, 40, 5]), cfg, fim).status).toBe("FAIL");
    // jurídico não final ou política mudada na janela → INCONCLUSIVE, mesmo com números de PASS
    const semJuridico = { ...cfg, juridico: CONFIG_APROVADA.juridico };
    expect(avaliarDemanda(com([700, 263, 35], [400, 150, 20]), semJuridico, fim).status).toBe("INCONCLUSIVE");
    expect(avaliarDemanda(com([700, 263, 35], [400, 150, 20]), cfg, fim, { politicaJuridicaMudouNaJanela: true }).status).toBe("INCONCLUSIVE");
    // regra mexida depois de ver os dados → INVALID_RULE (falha fechada)
    const mexida = { ...cfg, validacaoDemanda: { ...cfg.validacaoDemanda, regra: { ...cfg.validacaoDemanda.regra, qualificadoBps: 1000 as never } } };
    expect(avaliarDemanda(com([300, 100, 10], [100, 40, 5]), mexida, fim).status).toBe("INVALID_RULE");
  });
  it("intenção só conta ao preço provisório declarado do tier", () => {
    const cfg = configDeEnsaio();
    const certo = inscricaoSintetica(9001, "PRO", { emailVerificado: true, carteiraAssinada: true });
    const outroPreco = inscricaoSintetica(9002, "PRO", { emailVerificado: true, carteiraAssinada: true, precoIntencaoUsd: 99 });
    const semPreco = inscricaoSintetica(9003, "PRO", { emailVerificado: true, carteiraAssinada: true, precoIntencaoUsd: null });
    const r = relatorio([certo, outroPreco, semPreco], cfg);
    expect(r.interesseQualificadoPorTier.PRO).toBe(3);
    expect(r.intencaoQualificadaPorTier.PRO).toBe(1);
  });
  it("pacote de validação traz os 6 relatórios e os mínimos pré-registrados", () => {
    const p = pacoteDeValidacao(ins, configDeEnsaio(), T0);
    expect(Object.keys(p)).toEqual(expect.arrayContaining(["demandaPorTier", "carteirasQualificadas", "preferencias", "intencaoNaoVinculante", "coberturaDeSupply", "funil", "avaliacao"]));
    expect(p.coberturaDeSupply.PRO).toMatchObject({ minimoQualificados: 700, minimoIntencao: 400 });
    expect(p.avaliacao.status).toBe("AWAITING_REAL_COLLECTION");
    expect(p.statusPreco).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
  });
});

describe("carteira e chain falsas: sucesso só com recibo confirmado", () => {
  const seq = (evs: EventoCarteira[], de: EstadoCarteira = "disconnected") => evs.reduce(proximoEstadoCarteira, de);
  it("estados da carteira, rede errada, limite, recusa, timeout", () => {
    expect(seq([{ t: "conectar" }, { t: "conectou", rede: "solana:mainnet-beta" }])).toBe("wrong_network");
    expect(seq([{ t: "conectar" }, { t: "conectou", rede: REDE_DA_VENDA }, { t: "checar_elegibilidade" }, { t: "elegibilidade", elegivel: true, restante: 0 }])).toBe("allocation_exhausted");
    expect(seq([{ t: "assinar" }, { t: "recusou" }], "eligible")).toBe("signing_rejected");
    expect(seq([{ t: "assinar" }, { t: "enviou" }, { t: "tempo_esgotado" }], "eligible")).toBe("timeout");
    expect(seq([{ t: "assinar" }, { t: "enviou" }, { t: "recibo", status: "pending" }, { t: "recibo", status: "confirmed" }], "eligible")).toBe("confirmed");
    expect(seq([{ t: "assinar" }, { t: "recibo", status: "confirmed" }], "eligible")).toBe("signing"); // assinar ≠ sucesso
  });
  it("assinatura de posse: verifica, rejeita mensagem alterada", () => {
    const a = new AssinadorFalso("segredo-local");
    const m = mensagemDePosse(carteiraSintetica(1), "n1", T0);
    expect(a.verificar(m, a.assinar(m))).toBe(true);
    expect(a.verificar(m.replace("n1", "n2"), a.assinar(m))).toBe(false);
  });
  it("recibo: pending → confirmed; corrompido/desconhecido nunca é sucesso; reenvio = mesma assinatura", () => {
    const c = new CadeiaFalsa({ ticksAteConfirmar: 2, corromper: new Set(["bad"]) });
    const tx = { chave: "k", carteira: carteiraSintetica(1), tier: "PRO", lamports: "1", rede: REDE_DA_VENDA, precoFingerprint: "f" };
    const e = c.enviar(tx); if (!e.ok) throw new Error();
    expect(c.enviar(tx)).toEqual(e);
    expect(lerRecibo(c.reciboCru(e.assinatura), e.assinatura).status).toBe("pending");
    expect(lerRecibo(c.reciboCru(e.assinatura), e.assinatura).status).toBe("confirmed");
    const b = c.enviar({ ...tx, chave: "bad" }); if (!b.ok) throw new Error();
    expect(lerRecibo(c.reciboCru(b.assinatura), b.assinatura).status).toBe("unknown");
    expect(lerRecibo({ assinatura: "outra", status: "confirmed" }, e.assinatura).status).toBe("unknown");
    expect(lerRecibo("lixo", e.assinatura).status).toBe("unknown");
    expect(c.enviar({ ...tx, rede: "solana:mainnet-beta" })).toEqual({ ok: false, erro: "rede_errada" });
  });
  it("estados públicos da transação", () => {
    expect(ESTADOS_TX_PUBLICOS).toEqual(["IDLE", "PREPARING", "WALLET_CONFIRMATION", "SUBMITTED", "PENDING", "CONFIRMED", "FAILED", "EXPIRED", "CANCELLED"]);
    expect(estadoTxPublico("rejeitada")).toBe("CANCELLED");
  });
});

describe("benefícios: 36 meses do encerramento, só utilidade real", () => {
  it("36 meses de calendário (inclui fim de mês e bissexto)", () => {
    expect(new Date(somarMesesUtc(Date.UTC(2030, 0, 31), 36)).toISOString()).toBe("2033-01-31T00:00:00.000Z");
    expect(new Date(somarMesesUtc(Date.UTC(2030, 10, 30), 3)).toISOString()).toBe("2031-02-28T00:00:00.000Z");
    expect(new Date(somarMesesUtc(Date.UTC(2031, 1, 29 - 1), 12)).toISOString()).toBe("2032-02-28T00:00:00.000Z");
    const j = janelaPremium(CONFIG_APROVADA, Date.UTC(2030, 5, 1));
    expect(j).toEqual({ estado: "DEFINIDA", inicio: Date.UTC(2030, 5, 1), fim: Date.UTC(2033, 5, 1) });
    expect(janelaPremium(CONFIG_APROVADA, null)).toEqual({ estado: "AGUARDANDO_ENCERRAMENTO_DA_VENDA" });
    expect(premiumAtivo(CONFIG_APROVADA, Date.UTC(2030, 5, 1), Date.UTC(2033, 5, 1) - 1, true)).toBe(true);
    expect(premiumAtivo(CONFIG_APROVADA, Date.UTC(2030, 5, 1), Date.UTC(2033, 5, 1), true)).toBe(false);
    expect(premiumAtivo(CONFIG_APROVADA, null, T0, false)).toBe(false);
  });
  it("grupo C nunca publicável; taxas espelham tier/fees.ts; plano mensal = produto separado (+30 % não vinculante)", () => {
    for (const t of ["PRO", "TRADER", "PILOT"] as const) expect(beneficiosPublicaveis(t).some((b) => b.grupo === "C_EXCLUIDO")).toBe(false);
    expect(BENEFICIOS.filter((b) => b.grupo === "C_EXCLUIDO").map((b) => b.id)).toEqual(expect.arrayContaining(["royalty_distribution_to_holders", "treasury_governance"]));
    expect(TAXA_SWAP_BPS).toEqual({ FREE: TIER_FEE_BPS.free, PRO: TIER_FEE_BPS.pro, TRADER: TIER_FEE_BPS.trader, PILOT: TIER_FEE_BPS.pilot });
    expect(relacaoPlanoMensal(CONFIG_APROVADA)).toEqual({ estado: "CONFIGURADO", valor: { modelo: "PRODUTOS_COMERCIAIS_SEPARADOS", regraMais30: "NON_BINDING_PRICING_GUIDANCE", assinaturaDisponivelParaNaoHolders: true, garantiaDePremioFuturoSobreONft: false } });
  });
});

describe("funil: só a partir de eventos válidos", () => {
  it("conta sessões por etapa e descarta evento inválido/PII", () => {
    const s = (n: number) => String(n).padStart(16, "0");
    const evs: unknown[] = [];
    for (let i = 0; i < 10; i++) evs.push({ nome: "founders_page_view", sessao: s(i), pagina: "founders", idioma: "pt", origem: i < 4 ? "twitter" : "direto" });
    for (let i = 0; i < 6; i++) evs.push({ nome: "tier_view", sessao: s(i), tier: "PRO" });
    for (let i = 0; i < 3; i++) evs.push({ nome: "whitelist_start", sessao: s(i), origem: "landing" });
    evs.push({ nome: "tx_confirmed", sessao: s(0), intencao_hash: "a".repeat(64), tx_hash_ref: "b".repeat(64), duracao_ms: 10 });
    evs.push({ nome: "whitelist_complete", sessao: s(1), inscricao_hash: "c".repeat(64), email: "x@y.co" });
    const f = funil(evs);
    expect(f.sessoesPorEtapa).toMatchObject({ DISCOVERY: 4, LANDING: 10, VALUE_UNDERSTANDING: 6, WHITELIST_APPLICATION: 3, PURCHASE: 1 });
    expect(f.conversaoDaEtapaAnteriorPct.VALUE_UNDERSTANDING).toBe(60);
    expect(f.eventosDescartados).toBe(1);
  });
});

describe("tesouraria: só verificação, signatários pendentes", () => {
  it("papéis 2-de-3 definidos, identidades pendentes; nenhum signatário sozinho", () => {
    expect(CONFIG_APROVADA.tesouraria).toMatchObject({ modo: "MULTISIG_REQUIRED", limiarPlanejado: { m: 2, n: 3 },
      papeisSignatarios: ["A_CEO_AUTORIDADE_CORPORATIVA", "B_INDEPENDENTE_FINANCEIRO_SEGURANCA", "C_INDEPENDENTE_RECUPERACAO_CONTINUIDADE"],
      signatarios: { estado: "PENDING_OWNER" }, endereco: { estado: "PENDING_CHAIN" },
      politicaConversao: { principio: "OBRIGACOES_OPERACIONAIS_FORA_DO_RISCO_SOL", parametros: { estado: "PENDING_LEGAL" } } });
  });
  it("config aprovada → PENDING_OWNER; declarado × observado detecta divergência; OK só com tudo igual", async () => {
    const { verificarTesouraria } = await import("./tesouraria");
    expect(verificarTesouraria(CONFIG_APROVADA, null)).toMatchObject({ estado: "PENDING_OWNER" });
    const donos = [carteiraSintetica("s1"), carteiraSintetica("s2"), carteiraSintetica("s3")];
    const end = carteiraSintetica("multisig-teste");
    const soSignatarios: ConfigVenda = { ...CONFIG_APROVADA, tesouraria: { ...CONFIG_APROVADA.tesouraria, signatarios: configurado(donos, "TESTE") } };
    expect(verificarTesouraria(soSignatarios, null)).toMatchObject({ estado: "PENDING_LEGAL" }); // parâmetros de conversão
    const cfg: ConfigVenda = { ...CONFIG_APROVADA, tesouraria: { ...CONFIG_APROVADA.tesouraria,
      signatarios: configurado(donos, "TESTE"), endereco: configurado(end, "TESTE"),
      politicaConversao: { principio: "OBRIGACOES_OPERACIONAIS_FORA_DO_RISCO_SOL", parametros: configurado(PARAMETROS_CONVERSAO_TESTE, "TESTE") } } };
    expect(verificarTesouraria(cfg, null)).toMatchObject({ estado: "PENDING_EXTERNAL" });
    expect(verificarTesouraria(cfg, { endereco: end, donos, limiar: 2, simulacaoAprovada: true }).estado).toBe("OK");
    expect(verificarTesouraria(cfg, { endereco: carteiraSintetica("outro"), donos, limiar: 1, simulacaoAprovada: false })).toEqual({ estado: "DIVERGENTE", diferencas: ["endereco", "limiar", "simulacao"] });
    expect(verificarTesouraria(cfg, { endereco: end, donos: donos.slice(0, 2), limiar: 2, simulacaoAprovada: true })).toEqual({ estado: "DIVERGENTE", diferencas: ["donos"] });
  });
});
