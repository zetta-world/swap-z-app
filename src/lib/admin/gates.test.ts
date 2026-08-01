import { describe, it, expect } from "vitest";
import {
  FLYWHEEL_GATE_KEYS, GATE_SPENDS_TOKENS, TOKEN_SPENDING_GATES,
} from "@/lib/admin/gate-keys";

/**
 * O DISJUNTOR QUE DISPARAVA SEM CORTAR.
 *
 * A lista de "quem desligar quando o custo de IA estoura" era digitada à mão
 * dentro do watchdog. Toda mesa nova nascia fora dela e ninguém percebia —
 * porque o disjuntor continuava disparando, mandando o alerta e cortando os
 * gates antigos. Ele produzia o REGISTRO de ter agido sem ter agido.
 *
 * Duas vezes: em 30/07 faltavam MÍMIR e VÖLVA; em 01/08 ainda faltavam
 * `pause_agent_a`, `pause_radar`, `pause_sniper` — e o maior gastador de todos,
 * o `/api/zion` do usuário, que nem gate tinha.
 *
 * Esta suíte existe para que a terceira vez não aconteça.
 */

describe("classificação de gasto — nenhum gate fica sem resposta", () => {
  it("todo gate declara se gasta token ou não", () => {
    // Um gate novo sem entrada aqui nem compila (o Record é total), mas o teste
    // pega o caso em que alguém adiciona a chave e esquece de PENSAR nela.
    for (const k of FLYWHEEL_GATE_KEYS) {
      expect(typeof GATE_SPENDS_TOKENS[k], `gate "${k}" sem classificação`).toBe("boolean");
    }
    expect(Object.keys(GATE_SPENDS_TOKENS).sort()).toEqual([...FLYWHEEL_GATE_KEYS].sort());
  });

  it("a lista do disjuntor é DERIVADA, não digitada", () => {
    expect(TOKEN_SPENDING_GATES).toEqual(FLYWHEEL_GATE_KEYS.filter((k) => GATE_SPENDS_TOKENS[k]));
  });
});

describe("quem gasta token está na lista de corte", () => {
  it("as mesas de IA que motivaram os dois consertos estão cobertas", () => {
    for (const k of ["pause_tournament", "pause_agent_a", "pause_agent_b", "pause_oracle",
                     "pause_radar", "pause_sniper", "pause_ragnarok_ai"] as const) {
      expect(TOKEN_SPENDING_GATES, `"${k}" fora do corte de custo`).toContain(k);
    }
  });

  it("o /api/zion do USUÁRIO está no corte — era o maior gastador e não tinha gate", () => {
    // Sem ele, o disjuntor pausava sete mesas internas e o gasto seguia
    // correndo pela porta da frente.
    expect(TOKEN_SPENDING_GATES).toContain("pause_zion");
  });
});

describe("quem NÃO gasta token fica de fora", () => {
  it("mesas mecânicas não são cortadas por custo", () => {
    // Cortá-las não economizaria nada e calaria o GRUPO DE CONTROLE que dá
    // sentido à comparação com as mesas de IA — o experimento inteiro perde o
    // eixo justo quando o dinheiro aperta, que é quando ele mais importa.
    for (const k of ["pause_arbiter", "pause_arbiter2", "pause_ragnarok",
                     "pause_ragnarok_dex", "pause_ullr", "pause_paper"] as const) {
      expect(GATE_SPENDS_TOKENS[k], `"${k}" é mecânico e não deveria contar como gastador`).toBe(false);
      expect(TOKEN_SPENDING_GATES).not.toContain(k);
    }
  });
});
