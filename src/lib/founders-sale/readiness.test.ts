import { describe, it, expect } from "vitest";
import { RelogioDaVenda, contagem } from "./relogio";
import { estadoDaUI, podeMintar, visaoProgresso, visaoAlocacao, ESTADOS_UI, type EntradaVisao } from "./visao";
import { AdminDaVenda } from "./admin";
import { VendaAutoritativa, ArmazemEmMemoria, estadoInicial } from "./autoridade";
import { CONFIG_APROVADA, type ConfigVenda } from "./config";
import { criarSnapshotAlocacao } from "./allowlist-hibrida";
import { CadeiaDeEvidencia, verificarCadeia, canonico, impressaoConfig, type RegistroEvidencia } from "./evidencia";
import { validarEvento, EVENTOS } from "./telemetria";

const H64 = "a".repeat(64), H16 = "b".repeat(16);

describe("relógio: servidor + monotônico, nunca o relógio de parede do cliente", () => {
  it("sem sincronização não há hora (a UI não inventa)", () => {
    expect(new RelogioDaVenda(() => 0).agora()).toBeNull();
  });
  it("avança pelo monotônico a partir do instante do servidor", () => {
    let mono = 1000;
    const r = new RelogioDaVenda(() => mono);
    r.sincronizar(1_800_000_000_000);
    mono = 6000;
    expect(r.agora()).toBe(1_800_000_005_000);
  });
  it("ignora o relógio de parede do cliente mesmo adulterado", () => {
    const original = Date.now;
    Date.now = () => 9_999_999_999_999; // cliente "adiantou" o relógio
    try {
      let mono = 0;
      const r = new RelogioDaVenda(() => mono);
      r.sincronizar(1_000_000);
      mono = 10;
      expect(r.agora()).toBe(1_000_010);
    } finally { Date.now = original; }
  });
  it("monotônico que recua não faz o tempo voltar", () => {
    let mono = 500;
    const r = new RelogioDaVenda(() => mono);
    r.sincronizar(2_000);
    mono = 100;
    expect(r.agora()).toBe(2_000);
  });
  it("contagem: sem horário, antes (d/h/m/s), durante, depois, janela inválida", () => {
    expect(contagem({ inicioMs: null, fimMs: null }, 1)).toEqual({ tipo: "sem_hora" });
    expect(contagem({ inicioMs: 10, fimMs: 5 }, 1)).toEqual({ tipo: "sem_hora" });
    const c = contagem({ inicioMs: 90_061_000 + 1000, fimMs: null }, 1000);
    expect(c).toMatchObject({ tipo: "antes", d: 1, h: 1, m: 1, s: 1 });
    expect(contagem({ inicioMs: 100, fimMs: 200 }, 150)).toEqual({ tipo: "durante", restanteMs: 50 });
    expect(contagem({ inicioMs: 100, fimMs: null }, 150)).toEqual({ tipo: "durante", restanteMs: null });
    expect(contagem({ inicioMs: 100, fimMs: 200 }, 200)).toEqual({ tipo: "depois" });
  });
});

describe("modelo de visão: todos os estados, sem sucesso fabricado", () => {
  const base: EntradaVisao = { venda: { estado: "publica_aberta" }, contagem: { tipo: "durante", restanteMs: null }, elegibilidade: "desconhecida", tx: "ocioso", txId: null };
  const casos: [Partial<EntradaVisao>, string][] = [
    [{ venda: null }, "COMING_SOON"],
    [{ venda: { estado: "rascunho" } }, "COMING_SOON"],
    [{ venda: { estado: "inscricao_aberta" } }, "APPLICATION_OPEN"],
    [{ venda: { estado: "allowlist_aberta" }, elegibilidade: "verificando" }, "ALLOWLIST_CHECK"],
    [{ venda: { estado: "allowlist_aberta" }, elegibilidade: "elegivel" }, "ELIGIBLE"],
    [{ venda: { estado: "allowlist_aberta" }, elegibilidade: "nao_elegivel" }, "NOT_ELIGIBLE"],
    [{ venda: { estado: "allowlist_aberta" }, elegibilidade: "pendente_juridico" }, "ELIGIBILITY_PENDING"],
    [{ venda: { estado: "allowlist_congelada" }, contagem: { tipo: "antes", restanteMs: 5, d: 0, h: 0, m: 0, s: 1 } }, "SALE_NOT_STARTED"],
    [{}, "SALE_ACTIVE"],
    [{ venda: { estado: "pausada", antesDaPausa: "publica_aberta" } }, "PAUSED"],
    [{ venda: { estado: "esgotada" } }, "SOLD_OUT"],
    [{ venda: { estado: "encerrada" } }, "ENDED"],
    [{ venda: { estado: "cancelada" } }, "ENDED"],
    [{ contagem: { tipo: "depois" } }, "ENDED"],
    [{ restante: 0 }, "WALLET_LIMIT_REACHED"],
    [{ redeErrada: true }, "WRONG_NETWORK"],
    [{ precoDisponivel: false }, "PRICE_UNAVAILABLE"],
    [{ configValida: false }, "CONFIG_INVALID"],
    [{ venda: { estado: "desconhecido" as never } }, "UNKNOWN_STATE"],
    [{ tx: "preparando" }, "TRANSACTION_PREPARING"],
    [{ tx: "assinando" }, "WALLET_CONFIRMATION"],
    [{ tx: "enviada" }, "TRANSACTION_PENDING"],
    [{ tx: "confirmada", txId: "fake-abc" }, "TRANSACTION_CONFIRMED"],
    [{ tx: "falhou" }, "TRANSACTION_FAILED"],
    [{ tx: "rejeitada" }, "TRANSACTION_FAILED"],
  ];
  it.each(casos)("%o → %s", (parcial, esperado) => {
    expect(estadoDaUI({ ...base, ...parcial })).toBe(esperado);
  });
  it("todos os estados de UI são alcançáveis", () => {
    const vistos = new Set(casos.map(([p]) => estadoDaUI({ ...base, ...p })));
    expect([...vistos].sort()).toEqual([...ESTADOS_UI].sort());
  });
  it("⚠️ 'confirmada' sem id de transação NÃO vira sucesso", () => {
    expect(estadoDaUI({ ...base, tx: "confirmada", txId: null })).toBe("TRANSACTION_PENDING");
  });
  it("só ELIGIBLE e SALE_ACTIVE oferecem mint", () => {
    expect(ESTADOS_UI.filter(podeMintar)).toEqual(["ELIGIBLE", "SALE_ACTIVE"]);
  });
});

describe("progresso: sem percentual fabricado", () => {
  it("dados ausentes → indisponível (nada de 0% inventado)", () => {
    expect(visaoProgresso({ supply: null, mintados: 3, reservados: 0 })).toEqual({ tipo: "indisponivel" });
  });
  it("inconsistente quando a soma passa do supply ou números não inteiros", () => {
    expect(visaoProgresso({ supply: 10, mintados: 8, reservados: 3 }).tipo).toBe("inconsistente");
    expect(visaoProgresso({ supply: 10, mintados: 1.5, reservados: 0 }).tipo).toBe("inconsistente");
    expect(visaoProgresso({ supply: 0, mintados: 0, reservados: 0 }).tipo).toBe("inconsistente");
  });
  it("percentual arredonda para baixo (nunca anuncia mais vendido)", () => {
    expect(visaoProgresso({ supply: 3, mintados: 2, reservados: 0 })).toMatchObject({ disponiveis: 1, percentualMintado: 66.6 });
    expect(visaoProgresso({ supply: 1000, mintados: 999, reservados: 1 })).toMatchObject({ disponiveis: 0, percentualMintado: 99.9 });
  });
  it("marcos 0/25/50/75/99/última/100 % vêm só do estado", () => {
    for (const m of [0, 25, 50, 75, 99]) {
      expect(visaoProgresso({ supply: 100, mintados: m, reservados: 0 })).toMatchObject({ tipo: "ok", disponiveis: 100 - m, percentualMintado: m });
    }
    // última unidade reservada (não mintada): 0 disponível, mas não é 100 % nem esgotado
    expect(visaoProgresso({ supply: 100, mintados: 99, reservados: 1 })).toMatchObject({ tipo: "ok", disponiveis: 0, percentualMintado: 99 });
    expect(visaoProgresso({ supply: 100, mintados: 100, reservados: 0 })).toMatchObject({ tipo: "ok", disponiveis: 0, percentualMintado: 100 });
  });
});

describe("alocação: campos abstratos, nada inventado", () => {
  it("desconhecida → restante null", () => {
    expect(visaoAlocacao({ alocacao: null, usado: null, elegibilidade: "desconhecida", prova: "ausente" })).toMatchObject({ restante: null, consistente: true });
  });
  it("conhecida → restante; usado > alocação → inconsistente, restante null", () => {
    expect(visaoAlocacao({ alocacao: 3, usado: 1, elegibilidade: "elegivel", prova: "valida" }).restante).toBe(2);
    expect(visaoAlocacao({ alocacao: 1, usado: 2, elegibilidade: "elegivel", prova: "valida" })).toMatchObject({ restante: null, consistente: false });
  });
});

describe("admin: dois passos, frase exata, motivo, operador autorizado, auditoria encadeada", () => {
  const MOT = "motivo operacional registrado";
  const W = "1".repeat(43);
  const cfgTeste = (): ConfigVenda => ({ ...CONFIG_APROVADA, horarios: { inscricaoAbre: 0, inscricaoFecha: 10, allowlistAbre: 20, publicaAbre: 20 + CONFIG_APROVADA.duracaoAllowlistMs, vendaFecha: 30 + CONFIG_APROVADA.duracaoAllowlistMs } });
  const mk = (segundo = false) => {
    let t = 0;
    const ev = new CadeiaDeEvidencia();
    const aut = new VendaAutoritativa(cfgTeste(), () => t, new ArmazemEmMemoria(estadoInicial(0)));
    const adm = new AdminDaVenda(aut, { validadeMs: 60_000, exigeSegundoOperador: segundo, operadoresAutorizados: ["op1", "op2"], motivoMinimo: 10 }, ev, () => t);
    return { adm, ev, aut, avanca: (ms: number) => { t += ms; } };
  };
  const ok = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
  const snap = (versao: number, w = W) => criarSnapshotAlocacao(versao, [{ carteira: w, tier: "PRO", quantidade: 1, origem: "curada" }]);

  it("operador fora da lista e pedido sem motivo são recusados e auditados", () => {
    const { adm, ev } = mk();
    expect(adm.solicitar({ tipo: "pausar" }, "intruso", MOT)).toEqual({ ok: false, erro: "nao_autorizado" });
    expect(adm.solicitar({ tipo: "pausar" }, "op1", "curto")).toEqual({ ok: false, erro: "motivo_ausente" });
    expect(ev.todos().filter((x) => x.dados.evento === "recusado")).toHaveLength(2);
  });
  it("abrir allowlist sem snapshot congelado é recusado", async () => {
    const { adm, avanca } = mk();
    const i = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_inscricao" }, "op1", MOT));
    expect((await adm.confirmar(i.id, "op1", i.frase)).ok).toBe(true);
    avanca(25);
    const p = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_allowlist" }, "op1", MOT));
    expect(await adm.confirmar(p.id, "op1", p.frase)).toEqual({ ok: false, erro: "snapshot_necessario" });
  });
  it("inscrição → congelar snapshot → abrir allowlist → pausar → retomar; frase, antes/depois e cadeia íntegra", async () => {
    const { adm, ev, avanca } = mk();
    const i = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_inscricao" }, "op1", MOT));
    await adm.confirmar(i.id, "op1", i.frase);
    avanca(10);
    const s1 = snap(1);
    const c = ok(adm.solicitar({ tipo: "congelar_snapshot", snapshot: s1 }, "op1", MOT));
    expect(c.frase).toBe("CONGELAR SNAPSHOT V1");
    expect(await adm.confirmar(c.id, "op1", "congelar snapshot v1")).toEqual({ ok: false, erro: "frase_incorreta" });
    const c2 = ok(adm.solicitar({ tipo: "congelar_snapshot", snapshot: s1 }, "op1", MOT));
    const r = ok(await adm.confirmar(c2.id, "op1", c2.frase));
    expect([r.antes.publico, r.depois.publico]).toEqual(["APPLICATION_OPEN", "ALLOWLIST_FROZEN"]);
    expect(adm.snapshot()?.id).toBe(s1.id);
    expect(Object.isFrozen(adm.snapshot())).toBe(true);
    avanca(10);
    const a = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_allowlist" }, "op1", MOT));
    expect(ok(await adm.confirmar(a.id, "op1", a.frase)).depois.publico).toBe("ALLOWLIST_SALE");
    const p = ok(adm.solicitar({ tipo: "pausar" }, "op1", MOT));
    expect(ok(await adm.confirmar(p.id, "op1", "PAUSAR VENDA")).depois.publico).toBe("PAUSED");
    const re = ok(adm.solicitar({ tipo: "retomar" }, "op1", MOT));
    expect(ok(await adm.confirmar(re.id, "op1", "RETOMAR VENDA")).depois.publico).toBe("ALLOWLIST_SALE");
    expect(verificarCadeia(ev.todos())).toEqual({ ok: true });
    const executados = ev.todos().filter((x) => x.dados.evento === "executado");
    expect(executados.every((x) => typeof x.dados.motivo === "string" && "de" in x.dados && "para" in x.dados && "versao_depois" in x.dados)).toBe(true);
  });
  it("pedido não pode ser reusado, nem usado depois de expirar, nem contra estado que mudou (stale)", async () => {
    const { adm, avanca } = mk();
    const p = ok(adm.solicitar({ tipo: "transicao", evento: "cancelar" }, "op1", MOT));
    avanca(60_001);
    expect(await adm.confirmar(p.id, "op1", p.frase)).toEqual({ ok: false, erro: "pedido_expirado" });
    const velho = ok(adm.solicitar({ tipo: "transicao", evento: "cancelar" }, "op1", MOT));
    const novo = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_inscricao" }, "op1", MOT));
    expect((await adm.confirmar(novo.id, "op1", novo.frase)).ok).toBe(true);
    expect(await adm.confirmar(velho.id, "op1", velho.frase)).toEqual({ ok: false, erro: "versao_desatualizada" });
    expect(await adm.confirmar(novo.id, "op1", novo.frase)).toEqual({ ok: false, erro: "pedido_usado" });
  });
  it("com segundo operador exigido, o solicitante não confirma sozinho; outro autorizado confirma", async () => {
    const { adm } = mk(true);
    const p = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_inscricao" }, "op1", MOT));
    expect(await adm.confirmar(p.id, "op1", p.frase)).toEqual({ ok: false, erro: "mesmo_operador" });
    const q = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_inscricao" }, "op1", MOT));
    expect(await adm.confirmar(q.id, "intruso", q.frase)).toEqual({ ok: false, erro: "nao_autorizado" });
    expect((await adm.confirmar(q.id, "op2", q.frase)).ok).toBe(true);
  });
  it("snapshot congelado não é substituído; snapshot adulterado é recusado", async () => {
    const { adm, avanca } = mk();
    const i = ok(adm.solicitar({ tipo: "transicao", evento: "abrir_inscricao" }, "op1", MOT));
    await adm.confirmar(i.id, "op1", i.frase);
    avanca(10);
    const adulterado = { ...snap(1), entradas: [{ carteira: "2".repeat(43), tier: "PRO" as const, quantidade: 1, origem: "curada" as const }] };
    const x = ok(adm.solicitar({ tipo: "congelar_snapshot", snapshot: adulterado }, "op1", MOT));
    expect(await adm.confirmar(x.id, "op1", x.frase)).toEqual({ ok: false, erro: "snapshot_adulterado" });
    const s1 = snap(1);
    const a = ok(adm.solicitar({ tipo: "congelar_snapshot", snapshot: s1 }, "op1", MOT));
    expect((await adm.confirmar(a.id, "op1", a.frase)).ok).toBe(true);
    const b = ok(adm.solicitar({ tipo: "congelar_snapshot", snapshot: snap(2, "3".repeat(43)) }, "op1", MOT));
    expect(await adm.confirmar(b.id, "op1", b.frase)).toEqual({ ok: false, erro: "snapshot_ja_congelado" });
    expect(adm.snapshot()?.id).toBe(s1.id);
  });
});

describe("evidência: imutável e à prova de adulteração", () => {
  it("os 7 tipos encadeiam e verificam", () => {
    const c = new CadeiaDeEvidencia();
    c.emitir("allowlist_snapshot", { id: H64, versao: 1, enderecos: 2 });
    c.emitir("merkle_root", { raiz: H64, hash: "sha256", folhas: 2 });
    c.emitir("proof_version", { versao: 1 });
    c.emitir("sale_config_fingerprint", { impressao: impressaoConfig({ supply: 10, tetos: [1] }) });
    c.emitir("mock_tx_lifecycle", { estados: ["preparando", "assinando", "enviada", "confirmada"], rede: "FAKE_LOCAL_ONLY" });
    c.emitir("admin_audit", { evento: "executado" });
    c.emitir("sold_out_reconciliation", { supply: 10, confirmadas: 10, mints_ok: 10, confere: true });
    expect(verificarCadeia(c.todos())).toEqual({ ok: true });
  });
  it("registro emitido é congelado; adulterar uma cópia é detectado", () => {
    const c = new CadeiaDeEvidencia();
    const r = c.emitir("proof_version", { versao: 1 });
    c.emitir("merkle_root", { raiz: H64 });
    expect(() => { (r.dados as Record<string, unknown>).versao = 2; }).toThrow();
    const copia = JSON.parse(JSON.stringify(c.todos())) as RegistroEvidencia[];
    (copia[0].dados as Record<string, unknown>).versao = 2;
    expect(verificarCadeia(copia)).toEqual({ ok: false, indice: 0, motivo: "conteudo_alterado" });
    const reordenada = [c.todos()[1], c.todos()[0]];
    expect(verificarCadeia(reordenada).ok).toBe(false);
  });
  it("JSON canônico independe da ordem das chaves e recusa valores ambíguos", () => {
    expect(canonico({ b: 1, a: { d: 2, c: 3 } })).toBe(canonico({ a: { c: 3, d: 2 }, b: 1 }));
    expect(() => canonico({ a: undefined })).toThrow();
    expect(() => canonico({ a: NaN })).toThrow();
    expect(impressaoConfig({ a: 1 })).not.toBe(impressaoConfig({ a: 2 }));
  });
});

describe("telemetria: lista fechada de campos, sem PII", () => {
  it("os 17 eventos exigidos (+2 operacionais) existem", () => {
    for (const e of ["founders_page_view", "tier_view", "whitelist_start", "whitelist_complete", "email_verified", "wallet_connected", "wallet_signed", "eligibility_checked", "tier_preference_selected", "sale_status_view", "purchase_intent", "wallet_prompt", "tx_submitted", "tx_confirmed", "tx_failed", "sold_out_view", "post_purchase_onboarding"]) expect(EVENTOS).toContain(e);
    expect(EVENTOS).toHaveLength(19);
  });
  it("evento válido passa", () => {
    expect(validarEvento({ nome: "tx_confirmed", sessao: H16, intencao_hash: H64, tx_hash_ref: H64, duracao_ms: 1200 }).ok).toBe(true);
    expect(validarEvento({ nome: "sale_status_view", estado_ui: "SOLD_OUT" }).ok).toBe(true);
    expect(validarEvento({ nome: "tier_preference_selected", inscricao_hash: H64, tier: "PILOT" }).ok).toBe(true);
  });
  it.each([
    [{ nome: "wallet_connected", carteira: "0x" + "1".repeat(40) }, "campo_nao_permitido:carteira"],
    [{ nome: "wallet_connected", carteira_hash: "1".repeat(40) }, "tipo:carteira_hash"],
    [{ nome: "tx_failed", intencao_hash: H64, codigo: "user@example.com" }, "tipo:codigo"],
    [{ nome: "tx_failed", intencao_hash: H64, codigo: "0x" + "a".repeat(40) }, "tipo:codigo"],
    [{ nome: "sale_status_view", estado_ui: "MINTED_OK" }, "tipo:estado_ui"],
    [{ nome: "tier_view", tier: "GOLD" }, "tipo:tier"],
    [{ nome: "whitelist_complete", inscricao_hash: H64, email: "a@b.co" }, "campo_nao_permitido:email"],
    [{ nome: "evento_novo" }, "evento_desconhecido"],
  ])("recusa %o", (ev, erro) => {
    expect(validarEvento(ev)).toEqual({ ok: false, erro });
  });
});
