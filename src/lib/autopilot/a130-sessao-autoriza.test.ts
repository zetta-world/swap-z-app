/**
 * ⚠️⚠️⚠️ A130 + A130-B — A SESSÃO É QUEM AUTORIZA, E O TETO É O DURÁVEL.
 *
 * Cenários §20–§27 do briefing do Round 8.
 *
 * O ataque que originou o achado:
 *
 *     S1 ativa, C1 current      → usuário clica PARAR → S1.is_active = false
 *     C1 continua active/current (certo: serve DCA e recovery histórico)
 *     chega request autopilot=true
 *     a rota lia a sessão SEM filtro, pegava S1.conexao_id, abria o cofre,
 *     e mandava ordem REAL.
 *
 * PARAR = ZERO NOVA EXECUÇÃO. Estes testes existem para que essa frase seja
 * verdade no servidor, não na tela.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  avaliarAutorizacaoDaSessaoParaExecucao, tetoEfetivoDaOrdem,
  type EstadoParaExecucao,
} from "@/lib/autopilot/autorizacao-de-execucao";
import { utcDayKey } from "@/lib/autopilot/sessions";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const AGORA = new Date("2026-09-19T12:00:00.000Z");
const HOJE = utcDayKey(AGORA);

const viva = (over: Partial<EstadoParaExecucao> = {}): EstadoParaExecucao => ({
  ativa: true,
  expiraEm: new Date(AGORA.getTime() + 3_600_000).toISOString(),
  congeladaAte: null,
  tradesHoje: 0,
  maxTradesPorDia: 5,
  maxTradeUsd: 100,
  conexaoId: "C1",
  ...over,
});

describe("① A130.1 — sessão PARADA não cria ordem", () => {
  it("⚠️⚠️ is_active=false RECUSA, mesmo com conexão CURRENT", () => {
    // Este é o ataque inteiro: a conexão continuar ativa está CERTO — ela
    // serve DCA e recovery. Ela só não autoriza o piloto.
    const d = avaliarAutorizacaoDaSessaoParaExecucao(viva({ ativa: false }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_inativa");
  });

  it("⚠️ sessão inexistente também RECUSA — linha ausente não é permissão", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(null, AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_inexistente");
  });
});

describe("② A130.2 — sessão válida SEGUE o fluxo", () => {
  it("⚠️ o gêmeo positivo: ativa, no prazo, sem freeze, com vaga e conexão", () => {
    // Sem isto, uma função que recusasse sempre passaria em todo o resto.
    const d = avaliarAutorizacaoDaSessaoParaExecucao(viva(), AGORA);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.conexaoId).toBe("C1");
      expect(d.tetoDaSessaoUsd).toBe(100);
      expect(d.tradesRestantesHoje).toBe(5);
    }
  });
});

describe("③ A130.3 — sessão EXPIRADA não cria ordem", () => {
  it("⚠️⚠️ expires_at no passado RECUSA", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ expiraEm: new Date(AGORA.getTime() - 1).toISOString() }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_expirada");
  });

  it("⚠️⚠️ validade AUSENTE ou ILEGÍVEL também recusa — falha fechada", () => {
    // "Não sei até quando isto vale" nunca pode virar "vale para sempre".
    for (const ruim of [null, "", "ontem", "2026-13-45T99:99:99Z"]) {
      const d = avaliarAutorizacaoDaSessaoParaExecucao(
        viva({ expiraEm: ruim as string | null }), AGORA);
      expect(d.ok, String(ruim)).toBe(false);
      if (!d.ok) expect(d.motivo).toBe("sessao_expirada");
    }
  });

  it("⚠️ expirar exatamente agora já conta como expirada", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ expiraEm: AGORA.toISOString() }), AGORA);
    expect(d.ok).toBe(false);
  });
});

describe("④ A130.4 — sessão CONGELADA não cria ordem", () => {
  it("⚠️⚠️ congelada HOJE recusa", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ congeladaAte: HOJE }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_congelada");
  });

  it("⚠️ congelada em OUTRO dia não bloqueia — o freeze é do dia", () => {
    // Usar a semântica existente do projeto (§12): congelado sse
    // `frozen_until_day === hoje`. Um carimbo de ontem não prende hoje.
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ congeladaAte: "2026-09-18" }), AGORA);
    expect(d.ok).toBe(true);
  });
});

describe("⑤ A130-B.4 — teto diário server-side", () => {
  it("⚠️⚠️ 5 de 5 feitos: a sexta NÃO sai", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ tradesHoje: 5, maxTradesPorDia: 5 }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("limite_diario");
  });

  it("⚠️ 4 de 5: uma request legítima segue", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ tradesHoje: 4, maxTradesPorDia: 5 }), AGORA);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.tradesRestantesHoje).toBe(1);
  });

  it("⚠️ acima do teto (contador corrompido) também recusa", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ tradesHoje: 9, maxTradesPorDia: 5 }), AGORA);
    expect(d.ok).toBe(false);
  });
});

describe("⑥ §31 — sessão LEGADA sem conexão não cria ordem", () => {
  it("⚠️⚠️ conexao_id null RECUSA — não se infere conexão", () => {
    // Nem por carteira, nem pela CURRENT global: o intent tem de nascer
    // amarrado à MESMA versão do cofre que produziu o efeito externo (A127).
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ conexaoId: null }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("conexao_ausente");
  });
});

describe("⑦ A130-B.1/2/3 — o corpo NÃO amplia o teto", () => {
  it("⚠️⚠️ sessão 50, corpo 1000: vale 50", () => {
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 50, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: 1_000,
    })).toBe(50);
  });

  it("⚠️ sessão 100, corpo 50: vale 50 — o cliente PODE ser mais conservador", () => {
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 100, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: 50,
    })).toBe(50);
  });

  it("⚠️⚠️ o teto GLOBAL continua valendo por cima da sessão", () => {
    // Nem a configuração da sessão amplia o teto da plataforma (§26).
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 500_000, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: undefined,
    })).toBe(100_000);
  });

  it("⚠️ corpo inválido é IGNORADO, não vira teto", () => {
    // `0`, negativo, NaN, string, null: nenhum desses pode virar autoridade —
    // nem para ampliar, nem para zerar a ordem por acidente.
    for (const lixo of [0, -1, NaN, "1000", null, undefined, {}]) {
      expect(tetoEfetivoDaOrdem({
        tetoDaSessaoUsd: 100, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: lixo,
      }), String(lixo)).toBe(100);
    }
  });
});

describe("⑧ a ligação: a rota usa o helper, e ANTES do cofre", () => {
  const ROTA = semComentarios(
    readFileSync("src/app/api/cex/order/route.ts", "utf8"));

  it("⚠️⚠️ a rota chama a autorização da sessão", () => {
    expect(ROTA).toMatch(/avaliarAutorizacaoDaSessaoParaExecucao\(/);
    expect(ROTA).toMatch(/if \(!autorizacao\.ok\)/);
  });

  it("⚠️⚠️ e ela roda ANTES de decifrar a credencial do cofre (§20)", () => {
    // Recusar depois de abrir o cofre seria recusar tarde: numa sessão sem
    // autorização a credencial NEM DEVE ser desencriptada.
    const iAutoriza = ROTA.indexOf("avaliarAutorizacaoDaSessaoParaExecucao(");
    const iCofre = ROTA.indexOf("decifrarConexao(");
    expect(iAutoriza).toBeGreaterThan(-1);
    expect(iCofre).toBeGreaterThan(-1);
    expect(iAutoriza).toBeLessThan(iCofre);
  });

  it("⚠️⚠️ o teto do corpo NÃO é mais autoridade — A130-B", () => {
    // O código antigo era exatamente isto, e não pode voltar:
    //   const cap = typeof body.maxNotionalUsd === "number" && ... ? body.maxNotionalUsd : HARD...
    expect(ROTA).toMatch(/const cap = tetoEfetivoDaOrdem\(\{/);
    expect(ROTA).not.toMatch(/\?\s*body\.maxNotionalUsd\s*\n?\s*:\s*HARD_NOTIONAL_CEILING_USD/);
    expect(ROTA).toMatch(/tetoDaSessaoUsd: autorizacao\.tetoDaSessaoUsd/);
    expect(ROTA).toMatch(/tetoGlobalUsd: HARD_NOTIONAL_CEILING_USD/);
  });

  it("⚠️ a vaga do teto diário é RESERVADA na costura do executor", () => {
    expect(ROTA).toMatch(/reservarTradeDaSessao\(/);
    expect(ROTA).toMatch(/liberarTradeDaSessao\(/);
  });
});
