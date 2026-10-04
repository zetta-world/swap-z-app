import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { CONFIG_APROVADA, configurado, royaltyBps, supplyDaColecao, grossTeoricoUsd, type ConfigVenda } from "./config";
import { CadeiaDeEvidencia, verificarCadeia } from "./evidencia";
import { LivroDaReserva, type PedidoEmissaoReserva } from "./reserva-livro";
import { planejarConversao, planejarComParametros, conferirTrilhaConversao } from "./tesouraria";
import { EstoqueDaVenda } from "./estoque";
import { PARAMETROS_CONVERSAO_TESTE, configDeEnsaio } from "./cenario-local";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const OPS = ["op-alfa", "op-beta", "op-gama"];

describe("OD-NFT-04 — reserva não paga, pequena e divulgada", () => {
  it("40 reservadas (30/10/0) FORA dos 2.850 pagos; coleção máxima 2.890; capital continua sobre os 2.850", () => {
    expect(supplyDaColecao(CONFIG_APROVADA)).toEqual({ pago: 2850, reservado: 40, maximo: 2890,
      porTier: { PRO: { pago: 2000, reservado: 30 }, TRADER: { pago: 750, reservado: 10 }, PILOT: { pago: 100, reservado: 0 } } });
    expect(grossTeoricoUsd(CONFIG_APROVADA).total).toBe(796_250);
    const e = new EstoqueDaVenda(CONFIG_APROVADA, () => 0, 60_000);
    expect(e.resumo().porTier.PRO).toMatchObject({ paid_supply: 2000, reserved_supply: 30, available: 2000 });
    expect(e.resumo().porTier.PILOT).toMatchObject({ paid_supply: 100, reserved_supply: 0 });
    expect(e.resumo().origemReserva).toBe("CONFIGURADA");
  });

  const novo = (cfg: ConfigVenda = CONFIG_APROVADA) => {
    const ev = new CadeiaDeEvidencia();
    return { ev, livro: new LivroDaReserva(cfg, ev, OPS, (t, n) => `mint-falso-${t}-${n}`) };
  };
  const pedido = (o: Partial<PedidoEmissaoReserva> = {}): PedidoEmissaoReserva => ({
    tier: "PRO", finalidade: "PARCEIRO_ESTRATEGICO_ECOSSISTEMA", categoriaDestinatario: "PARCEIRO_ECOSSISTEMA",
    destinatarioHash: hash("parceiro-sintetico"), aprovacao: { id: `apr-${Math.random()}`, operadores: ["op-alfa", "op-beta"], motivo: "acordo de parceria registrado (teste)" }, ...o,
  });

  it("emissão exige finalidade, categoria, aprovação de dois operadores, registro de mint e evento de auditoria", () => {
    const { ev, livro } = novo();
    const r = livro.emitir(pedido({ aprovacao: { id: "apr-1", operadores: ["op-alfa", "op-beta"], motivo: "acordo de parceria registrado (teste)" } }));
    expect(r).toMatchObject({ ok: true, emissao: { seq: 1, tier: "PRO", finalidade: "PARCEIRO_ESTRATEGICO_ECOSSISTEMA", categoria: "PARCEIRO_ECOSSISTEMA", aprovacaoId: "apr-1", mintRef: "mint-falso-PRO-1" } });
    const reg = ev.todos();
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({ tipo: "admin_audit", dados: { evento: "reserva_emitida", fora_do_supply_pago: true } });
    expect(verificarCadeia(reg)).toEqual({ ok: true });
    expect(livro.emitir(pedido({ aprovacao: { id: "apr-1", operadores: ["op-alfa", "op-beta"], motivo: "acordo de parceria registrado (teste)" } }))).toEqual({ ok: false, erro: "aprovacao_reutilizada" });
  });
  it("recusas: Pilot, equipe/insider, categoria incompatível, operador sozinho/não autorizado, campanha sem id, destinatário cru", () => {
    const { livro } = novo();
    expect(livro.emitir(pedido({ tier: "PILOT" }))).toEqual({ ok: false, erro: "sem_reserva_no_tier" });
    expect(livro.emitir(pedido({ finalidade: "ALOCACAO_EQUIPE" }))).toEqual({ ok: false, erro: "finalidade_fora_da_politica" });
    expect(livro.emitir(pedido({ categoriaDestinatario: "INSIDER" }))).toEqual({ ok: false, erro: "categoria_fora_da_politica" });
    expect(livro.emitir(pedido({ categoriaDestinatario: "MEMBRO_COMUNIDADE_CAMPANHA_AUDITADA" }))).toEqual({ ok: false, erro: "categoria_incompativel" });
    expect(livro.emitir(pedido({ aprovacao: { id: "x1", operadores: ["op-alfa"], motivo: "motivo suficientemente longo" } }))).toEqual({ ok: false, erro: "aprovacao_invalida" });
    expect(livro.emitir(pedido({ aprovacao: { id: "x2", operadores: ["op-alfa", "op-alfa"], motivo: "motivo suficientemente longo" } }))).toEqual({ ok: false, erro: "aprovacao_invalida" });
    expect(livro.emitir(pedido({ aprovacao: { id: "x3", operadores: ["op-alfa", "intruso"], motivo: "motivo suficientemente longo" } }))).toEqual({ ok: false, erro: "aprovacao_invalida" });
    expect(livro.emitir(pedido({ finalidade: "RECOMPENSA_COMUNIDADE_AUDITADA", categoriaDestinatario: "MEMBRO_COMUNIDADE_CAMPANHA_AUDITADA" }))).toEqual({ ok: false, erro: "campanha_ausente" });
    expect(livro.emitir(pedido({ destinatarioHash: "fulano@exemplo" }))).toEqual({ ok: false, erro: "destinatario_invalido" });
    expect(livro.todas()).toHaveLength(0);
  });
  it("teto por tier; o não emitido continua não mintado", () => {
    const { livro } = novo();
    for (let i = 0; i < 10; i++) expect(livro.emitir(pedido({ tier: "TRADER", aprovacao: { id: `t-${i}`, operadores: ["op-beta", "op-gama"], motivo: "campanha auditada de lançamento" },
      finalidade: "RECOMPENSA_COMUNIDADE_AUDITADA", categoriaDestinatario: "MEMBRO_COMUNIDADE_CAMPANHA_AUDITADA", campanhaId: "campanha-sintetica-1" })).ok).toBe(true);
    expect(livro.emitir(pedido({ tier: "TRADER", aprovacao: { id: "t-10", operadores: ["op-beta", "op-gama"], motivo: "campanha auditada de lançamento" } }))).toEqual({ ok: false, erro: "reserva_esgotada" });
    expect(livro.resumo()).toEqual({ PRO: { limite: 30, emitidas: 0, naoMintadas: 30 }, TRADER: { limite: 10, emitidas: 10, naoMintadas: 0 }, PILOT: { limite: 0, emitidas: 0, naoMintadas: 0 } });
  });
  it("reserva não configurada → nada emite", () => {
    const { livro } = novo({ ...CONFIG_APROVADA, reserva: { estado: "PENDING_OWNER", motivo: "t", ref: "t" } });
    expect(livro.emitir(pedido())).toEqual({ ok: false, erro: "reserva_nao_configurada" });
  });
});

describe("OD-NFT-11 — royalty 2,5 % para a tesouraria, nunca benefício público", () => {
  it("250 bps, destino tesouraria, sem holders, não público; compatibilidade técnica pendente da chain", () => {
    expect(royaltyBps(CONFIG_APROVADA)).toBe(250);
    expect(CONFIG_APROVADA.royalty).toMatchObject({ destino: "TESOURARIA", distribuicaoAHolders: false, publico: false, compatibilidade: { estado: "PENDING_CHAIN" } });
  });
});

describe("OD-NFT-22 — conversão da tesouraria (SIMULAÇÃO)", () => {
  const LAMP = 1_000_000_000n;
  it("parâmetros pendentes (análise de risco + contábil/jurídico) → plano recusado", () => {
    expect(planejarConversao(CONFIG_APROVADA, { recebidoLamports: 10n * LAMP, brlCentavosPorSol: 80_000, obrigacoesBrlCentavos: 0 }))
      .toMatchObject({ ok: false, erro: "parametros_pendentes" });
  });
  it("com parâmetros de TESTE: tranches ≤ teto, limite por contraparte, trilha encadeada, obrigações cobertas", () => {
    const r = planejarComParametros(PARAMETROS_CONVERSAO_TESTE, { recebidoLamports: 1_000n * LAMP, brlCentavosPorSol: 80_000, obrigacoesBrlCentavos: 60_000_000 });
    if (!r.ok) throw new Error(r.erro);
    expect(r.simulacao).toBe(true);
    expect(r.tranches.every((t) => t.brlCentavos <= PARAMETROS_CONVERSAO_TESTE.trancheMaxBrlCentavos)).toBe(true);
    const porCp = new Map<string, bigint>();
    for (const t of r.tranches) porCp.set(t.contraparte, (porCp.get(t.contraparte) ?? 0n) + t.lamports);
    for (const v of porCp.values()) expect(v <= (1_000n * LAMP * 5_000n) / 10_000n).toBe(true);
    expect(r.solRetidoLamports).toBe(0n);
    expect(r.obrigacoesCobertas).toBe(true);
    expect(new Set(r.tranches.map((t) => t.destino))).toEqual(new Set(["STABLE", "FIAT"]));
    expect(Math.max(...r.tranches.map((t) => t.dia))).toBe(Math.floor((r.tranches.length - 1) / PARAMETROS_CONVERSAO_TESTE.tranchesPorDiaMax));
    expect(conferirTrilhaConversao(r.tranches)).toBe(true);
    const adulterada = r.tranches.map((t, i) => (i === 1 ? { ...t, lamports: t.lamports + 1n } : t));
    expect(conferirTrilhaConversao(adulterada)).toBe(false);
  });
  it("princípio do dono: SOL retido acima do que sobra das obrigações é recusado", () => {
    const p = { ...PARAMETROS_CONVERSAO_TESTE, solRetidoBps: 5_000, stableBps: 2_500, fiatBps: 2_500 };
    // valor total R$ 800.000; obrigações R$ 600.000 → só R$ 200.000 (25 %) pode ficar em SOL; 50 % é recusado
    expect(planejarComParametros(p, { recebidoLamports: 1_000n * LAMP, brlCentavosPorSol: 80_000, obrigacoesBrlCentavos: 60_000_000 }))
      .toMatchObject({ ok: false, erro: "sol_retido_acima_do_permitido" });
    const p2 = { ...PARAMETROS_CONVERSAO_TESTE, solRetidoBps: 2_500, stableBps: 3_750, fiatBps: 3_750 };
    expect(planejarComParametros(p2, { recebidoLamports: 1_000n * LAMP, brlCentavosPorSol: 80_000, obrigacoesBrlCentavos: 60_000_000 }).ok).toBe(true);
  });
  it("falha fechada: referência de preço inválida, frações que não somam, contrapartes que não cobrem 100 %", () => {
    const e = { recebidoLamports: 10n * LAMP, brlCentavosPorSol: 0, obrigacoesBrlCentavos: 0 };
    expect(planejarComParametros(PARAMETROS_CONVERSAO_TESTE, e)).toMatchObject({ ok: false, erro: "referencia_invalida" });
    expect(planejarComParametros({ ...PARAMETROS_CONVERSAO_TESTE, stableBps: 1 }, { ...e, brlCentavosPorSol: 1 })).toMatchObject({ ok: false, erro: "parametros_invalidos" });
    expect(planejarComParametros({ ...PARAMETROS_CONVERSAO_TESTE, limitePorContraparteBps: 4_000 }, { ...e, brlCentavosPorSol: 1 })).toMatchObject({ ok: false, erro: "parametros_invalidos" });
    expect(planejarComParametros(PARAMETROS_CONVERSAO_TESTE, { ...e, recebidoLamports: -1n, brlCentavosPorSol: 1 })).toMatchObject({ ok: false, erro: "entrada_invalida" });
  });
  it("config com parâmetros configurados valida pelo mesmo critério", () => {
    const cfg = configDeEnsaio({ tesouraria: { ...CONFIG_APROVADA.tesouraria, politicaConversao: { principio: "OBRIGACOES_OPERACIONAIS_FORA_DO_RISCO_SOL", parametros: configurado({ ...PARAMETROS_CONVERSAO_TESTE, fiatBps: 1 }, "TESTE") } } });
    expect(planejarConversao(cfg, { recebidoLamports: LAMP, brlCentavosPorSol: 1, obrigacoesBrlCentavos: 0 })).toMatchObject({ ok: false, erro: "parametros_invalidos" });
  });
});
