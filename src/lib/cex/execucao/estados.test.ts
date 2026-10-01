/**
 * ⚠️⚠️ A MÁQUINA DE ESTADOS VIVE EM DOIS LUGARES — e este arquivo é o que
 * impede que ela seja duas máquinas.
 *
 * A autoridade é o banco: `cex_transicao_permitida` (migration 0051) aplica a
 * transição sob `for update`, e código de aplicação não pode ser a única trava
 * do caminho de dinheiro. O espelho em TypeScript existe para o executor
 * decidir ANTES de ir ao banco, e para ser testável sem banco.
 *
 * Duas cópias da mesma regra divergem na primeira correção — foi a causa de
 * metade dos achados desta base. Então a trava não compara "parece igual": ela
 * LÊ o SQL da migration e exige concordância transição por transição, nos dois
 * sentidos.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ESTADOS_DO_INTENT, TRANSICOES, transicaoPermitida,
  ehTerminal, ehPreEnvio, precisaReconciliar, podeLiquidar, emDuvida,
  type EstadoDoIntent,
} from "@/lib/cex/execucao/estados";

const SQL_RPCS = readFileSync("supabase/migrations/0051_execucao_cex_rpcs.sql", "utf8");
const SQL_TABELAS = readFileSync(
  "supabase/migrations/0050_execucao_cex_intents_e_fills.sql", "utf8");

/** Extrai a tabela de transições do corpo de `cex_transicao_permitida`. */
function transicoesDoSql(): Record<string, string[]> {
  const i = SQL_RPCS.indexOf("function public.cex_transicao_permitida");
  const fim = SQL_RPCS.indexOf("$$;", i);
  const corpo = SQL_RPCS.slice(i, fim);
  const out: Record<string, string[]> = {};
  for (const m of corpo.matchAll(
    /when\s+'([A-Z_]+)'\s*(?:\n\s*)?then\s+p_para\s+in\s*\(([^)]*)\)/g)) {
    out[m[1]] = [...m[2].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort();
  }
  return out;
}

describe("① o espelho TypeScript e o SQL são a MESMA máquina", () => {
  const doSql = transicoesDoSql();

  it("⚠️ o SQL foi lido de verdade — senão a trava aprovaria o vazio", () => {
    // Um parser que não casa nada devolve {} e todo o resto passaria.
    expect(Object.keys(doSql).length).toBeGreaterThanOrEqual(10);
    expect(doSql.SUBMITTING).toBeDefined();
  });

  it("⚠️⚠️ cada estado não-terminal tem as MESMAS saídas nos dois lados", () => {
    for (const estado of Object.keys(doSql) as EstadoDoIntent[]) {
      expect(TRANSICOES[estado], `saídas de ${estado}`).toBeDefined();
      expect([...TRANSICOES[estado]].sort(), `saídas de ${estado}`).toEqual(doSql[estado]);
    }
  });

  it("⚠️ e o TypeScript não inventa saída que o SQL não tem", () => {
    // O sentido inverso: um estado com saídas no TS e `else false` no SQL
    // deixaria o executor tentar uma transição que o banco recusa em silêncio.
    for (const estado of ESTADOS_DO_INTENT) {
      if (TRANSICOES[estado].length > 0) {
        expect(doSql[estado], `${estado} tem saída no TS e não no SQL`).toBeDefined();
      }
    }
  });

  it("os treze estados do enum do banco são os treze do TypeScript", () => {
    const i = SQL_TABELAS.indexOf("create type public.cex_intent_state");
    const bloco = SQL_TABELAS.slice(i, SQL_TABELAS.indexOf(");", i));
    const doEnum = [...bloco.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(doEnum).toEqual([...ESTADOS_DO_INTENT].sort());
  });
});

describe("② INVARIANTE 3 — de SUBMITTING não se conclui que nada aconteceu", () => {
  it("⚠️⚠️ SUBMITTING → FAILED_PRE_SUBMIT é PROIBIDO", () => {
    expect(transicaoPermitida("SUBMITTING", "FAILED_PRE_SUBMIT")).toBe(false);
  });

  it("⚠️ SUBMITTING → UNKNOWN é o caminho do timeout", () => {
    expect(transicaoPermitida("SUBMITTING", "UNKNOWN")).toBe(true);
  });

  it("nenhum estado pós-envio admite FAILED_PRE_SUBMIT", () => {
    // O gêmeo abrangente: não é só SUBMITTING. Depois que a chamada externa
    // começou, "provadamente nada saiu" deixou de ser concluível em qualquer
    // ponto da vida do intent.
    const posEnvio: EstadoDoIntent[] = [
      "SUBMITTING", "SUBMITTED", "PARTIALLY_FILLED", "CANCEL_PENDING",
      "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED",
    ];
    for (const e of posEnvio) {
      expect(transicaoPermitida(e, "FAILED_PRE_SUBMIT"), `${e} → FAILED_PRE_SUBMIT`).toBe(false);
    }
  });

  it("⚠️ o gêmeo positivo: PRÉ-envio ainda PODE concluir que nada saiu", () => {
    // Sem isto, proibir tudo passaria neste bloco — e uma validação recusada
    // antes de qualquer rede é exatamente FAILED_PRE_SUBMIT, com razão.
    for (const e of ["CREATED", "AUTHORIZED", "RESERVED"] as EstadoDoIntent[]) {
      expect(transicaoPermitida(e, "FAILED_PRE_SUBMIT"), `${e}`).toBe(true);
    }
  });
});

describe("③ terminais, dúvida e recuperação", () => {
  it("os três terminais não têm saída", () => {
    for (const e of ["FILLED", "CANCELED", "FAILED_PRE_SUBMIT"] as EstadoDoIntent[]) {
      expect(ehTerminal(e)).toBe(true);
      expect(TRANSICOES[e]).toEqual([]);
    }
  });

  it("⚠️ QUARANTINED NÃO é terminal — senão o recuperador para de olhar", () => {
    expect(ehTerminal("QUARANTINED")).toBe(false);
    expect(TRANSICOES.QUARANTINED).toEqual(["RECONCILIATION_REQUIRED"]);
  });

  it("⚠️⚠️ SUBMITTING entra na lista de reconciliar — é o crash em voo", () => {
    // Cenário C do briefing: o processo morre depois do submit. Se o
    // recuperador não olhasse para SUBMITTING, esse intent ficaria fantasma.
    expect(precisaReconciliar("SUBMITTING")).toBe(true);
    expect(precisaReconciliar("UNKNOWN")).toBe(true);
  });

  it("⚠️ nenhum terminal pede reconciliação, e nenhum não-terminal escapa", () => {
    for (const e of ESTADOS_DO_INTENT) {
      if (ehTerminal(e)) expect(precisaReconciliar(e), e).toBe(false);
    }
    // Todo estado que não é terminal, não é pré-envio e não é quarentena
    // PRECISA ser reconciliável — senão existe estado que ninguém varre.
    for (const e of ESTADOS_DO_INTENT) {
      if (!ehTerminal(e) && !ehPreEnvio(e) && e !== "QUARANTINED") {
        expect(precisaReconciliar(e), `${e} ficaria sem varredura`).toBe(true);
      }
    }
  });

  it("⚠️⚠️ A104 — dúvida NÃO liquida", () => {
    // Avançar ciclo de DCA, contar trade, abrir posição ou somar P&L sobre
    // UNKNOWN é exatamente o achado A104.
    for (const e of ["SUBMITTING", "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED"] as EstadoDoIntent[]) {
      expect(emDuvida(e), e).toBe(true);
      expect(podeLiquidar(e), `${e} não pode liquidar`).toBe(false);
    }
  });

  it("⚠️ o gêmeo positivo: conclusão liquida", () => {
    // Uma função que devolvesse false para sempre passaria no bloco acima.
    expect(podeLiquidar("FILLED")).toBe(true);
    expect(podeLiquidar("CANCELED")).toBe(true);
    expect(podeLiquidar("PARTIALLY_FILLED")).toBe(true);
  });

  it("⚠️ SUBMITTED sozinho não liquida — ACK não é fill (INVARIANTE 2)", () => {
    expect(podeLiquidar("SUBMITTED")).toBe(false);
  });
});
