/**
 * O AVISO DE RODADA MAIS RECENTE — a decisão de dentro do componente.
 *
 * ⚠️ Painel de medição é de BOTÃO e não recarrega sozinho (de propósito: relógio
 * ali dispararia medição de hora em hora). O preço disso é a tela poder mostrar
 * um número velho como se fosse o atual. Este é o aviso que fecha o buraco.
 */

import { describe, it, expect } from "vitest";
import { temRodadaNova } from "@/components/admin/rodada-nova";

const T = (iso: string) => Date.parse(iso);
const ultima = { funding_basis: "2026-08-14T12:00:00.000Z", amm_lp: "2026-08-10T00:00:00.000Z" };

describe("temRodadaNova", () => {
  it("avisa quando o banco tem rodada posterior à da tela", () => {
    const r = temRodadaNova(ultima, ["funding_basis"], T("2026-08-14T10:00:00Z"));
    expect(r.nova).toBe(true);
    expect(r.quandoMs).toBe(T("2026-08-14T12:00:00Z"));
  });

  it("cala quando a tela já mostra a mais recente", () => {
    expect(temRodadaNova(ultima, ["funding_basis"], T("2026-08-14T13:00:00Z")).nova).toBe(false);
  });

  /**
   * ⚠️ SEM A FOLGA, O AVISO ACUSA A SI MESMO. `vistoEm` é o relógio do
   * NAVEGADOR quando a resposta chega; `started_at` é o do BANCO quando a
   * rodada COMEÇOU — e ela sempre começa antes de a resposta voltar. A própria
   * medição recém-rodada se anunciaria como "mais recente que a tela", toda
   * vez, e em uma semana ninguém olharia mais para o aviso.
   */
  it("a rodada que o dono ACABOU de disparar não se acusa", () => {
    // O banco carimbou 2s ANTES de a resposta chegar ao navegador.
    const vistoEm = T("2026-08-14T12:00:02Z");
    expect(temRodadaNova(ultima, ["funding_basis"], vistoEm).nova).toBe(false);
  });

  it("mas 10 segundos depois já é rodada de outra pessoa", () => {
    const r = temRodadaNova({ funding_basis: "2026-08-14T12:00:10.000Z" },
                            ["funding_basis"], T("2026-08-14T12:00:00Z"));
    expect(r.nova).toBe(true);
  });

  /**
   * ⚠️ Painel recém-aberto não está desatualizado — está VAZIO. Avisar ali
   * diria "há algo mais recente que o nada que você vê": verdade e inútil, com
   * o botão logo ao lado dizendo melhor.
   */
  it("sem nada na tela (vistoEm 0), não avisa", () => {
    expect(temRodadaNova(ultima, ["funding_basis"], 0).nova).toBe(false);
    expect(temRodadaNova(ultima, ["funding_basis"], -1).nova).toBe(false);
  });

  it("pega a MAIS nova entre vários slugs do mesmo painel", () => {
    const r = temRodadaNova(ultima, ["amm_lp", "funding_basis"], T("2026-08-11T00:00:00Z"));
    expect(r.quandoMs).toBe(T("2026-08-14T12:00:00Z"));
  });

  it("slug sem rodada nenhuma não inventa aviso", () => {
    expect(temRodadaNova(ultima, ["nao_existe"], T("2026-01-01T00:00:00Z")).nova).toBe(false);
    expect(temRodadaNova({}, ["funding_basis"], T("2026-01-01T00:00:00Z")).nova).toBe(false);
  });

  it("data ilegível é ignorada em vez de virar 1970", () => {
    expect(temRodadaNova({ x: "isto não é data" }, ["x"], T("2026-01-01T00:00:00Z")).nova).toBe(false);
  });
});
