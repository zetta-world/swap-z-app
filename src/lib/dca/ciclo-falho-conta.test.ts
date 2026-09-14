/**
 * ⚠️⚠️ UMA ORDEM RECUSADA CONGELAVA O PLANO DE POUPANÇA PARA SEMPRE.
 *
 * `decidirCiclo` deriva o número do ciclo de `ciclosFeitos + ciclosPulados + 1`
 * (`relogio.ts:148`). O `catch` do cron marcava o ciclo como `falhou` e não
 * incrementava NENHUM dos dois — então a passada seguinte recalculava o MESMO
 * número, batia na trava `unique` de `reservarCiclo`, saía em `ja_reservado`, e
 * assim a cada 5 minutos, indefinidamente.
 *
 * O comentário que estava lá dizia *"Falhou é um estado final, e conta como
 * ciclo gasto"*. Dizia — e nada contava. O rótulo falando de A com o número
 * vindo de B, pela décima vez nesta casa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decidirCiclo } from "./relogio";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const CRON = semComentarios(readFileSync(join(process.cwd(), "src/app/api/dca/cron/route.ts"), "utf8"));

const HORA = 3_600_000;
const plano = (feitos: number, pulados: number, agoraMs: number) =>
  decidirCiclo({
    agoraIso:         new Date(agoraMs).toISOString(),
    nextRunAtIso:     new Date(agoraMs - 60_000).toISOString(),
    intervalo:        "hourly",
    ciclosFeitos:     feitos,
    ciclosPulados:    pulados,
    ciclosTotal:      12,
    status:           "ativo",
    conexaoExpiraIso: "",
  });

describe("① a aritmética que produzia o congelamento", () => {
  it("⚠️⚠️ sem incremento, a janela seguinte pede o MESMO número de ciclo", () => {
    const agora = Date.parse("2026-09-14T12:00:00Z");
    const primeira = plano(0, 0, agora);
    expect(primeira.acao).toBe("executar");
    if (primeira.acao !== "executar") return;

    // O que o `catch` fazia: marca `falhou` e não mexe em feitos nem pulados.
    const depoisDaFalha = plano(0, 0, agora + HORA);
    expect(depoisDaFalha.acao).toBe("executar");
    if (depoisDaFalha.acao !== "executar") return;

    // Mesmo número → `reservarCiclo` bate na unique → `ja_reservado` → nada
    // acontece. E de novo, e de novo.
    expect(depoisDaFalha.ciclo).toBe(primeira.ciclo);
  });

  it("⚠️⚠️ contando a falha em `ciclos_pulados`, o relógio ANDA", () => {
    const agora = Date.parse("2026-09-14T12:00:00Z");
    const primeira = plano(0, 0, agora);
    const seguinte = plano(0, 1, agora + HORA);
    expect(primeira.acao === "executar" && seguinte.acao === "executar").toBe(true);
    if (primeira.acao !== "executar" || seguinte.acao !== "executar") return;
    expect(seguinte.ciclo).toBe(primeira.ciclo + 1);
  });

  it("⚠️ e o ciclo consumido reduz o que FALTA — o plano termina em vez de correr para sempre", () => {
    const agora = Date.parse("2026-09-14T12:00:00Z");
    // 12 ciclos: 5 comprados + 7 consumidos sem compra = acabou.
    const d = plano(5, 7, agora);
    expect(d.acao).toBe("encerrar");
  });

  it("falha NÃO vira 'comprado' — o gasto do plano não pode inchar com erro", () => {
    // `ciclos_feitos` é o contador de compras. Uma ordem recusada não comprou
    // nada, e somá-la ali faria a tela dizer "6 de 12" sem 6 compras.
    const agora = Date.parse("2026-09-14T12:00:00Z");
    const comoFalha  = plano(5, 1, agora);
    const comoCompra = plano(6, 0, agora);
    expect(comoFalha.acao === "executar" && comoCompra.acao === "executar").toBe(true);
    if (comoFalha.acao !== "executar" || comoCompra.acao !== "executar") return;
    // O número do ciclo é o mesmo (os dois consumiram 6), mas o significado
    // para o dono não é — e é por isso que o extrato guarda `falhou`.
    expect(comoFalha.ciclo).toBe(comoCompra.ciclo);
  });
});

/**
 * ⚠️⚠️ TRAVA DO FIO — leitura de fonte de propósito. A aritmética acima segue
 * verde com o cron passando `pulados` sem o `+ 1`, que era o defeito inteiro.
 */
describe("② e o `catch` do cron REALMENTE conta a falha", () => {
  it("⚠️⚠️ o avanço depois da falha soma o ciclo consumido", () => {
    expect(CRON).toMatch(/avancarPlano\(p\.id, \{ ciclosPulados: pulados \+ 1, nextRunAt: d\.proximoRunAt \}\)/);
    // A versão que congelava.
    expect(CRON).not.toMatch(/avancarPlano\(p\.id, \{ ciclosPulados: pulados, nextRunAt: d\.proximoRunAt \}\);\s*\n\s*return \{ plano: p\.id, acao: "falhou"/);
  });

  it("⚠️⚠️ e as DUAS escritas do caminho de falha são conferidas", () => {
    // supabase-js resolve com `{ error }` e não lança: `await` solto não prova
    // nada. O caminho de SUCESSO já conferia as duas; o de falha, nenhuma.
    expect(CRON).toMatch(/if \(!await fecharCiclo\(p\.id, d\.ciclo, \{ status: "falhou"/);
    expect(CRON).toMatch(/if \(!await avancarPlano\(p\.id, \{ ciclosPulados: pulados \+ 1/);
  });

  it("⚠️ o alerta carrega a CONSEQUÊNCIA, não só o nome do erro", () => {
    expect(CRON).toMatch(/o plano congela ate mao humana/);
    expect(CRON).toMatch(/ele fica preso em reservado/);
    expect(CRON).toMatch(/a cada 5 minutos, para sempre/);
  });

  it("⚠️ o número do ciclo NÃO é repetido — timeout pode ter virado compra", () => {
    // Repetir arrisca comprar duas vezes; consumir arrisca comprar uma a menos.
    expect(CRON).toMatch(/status: "falhou", motivo: msg, simulado/);
    expect(CRON).not.toMatch(/status: "reservado".*catch/s);
  });
});

/**
 * ⚠️ O RÓTULO PASSOU A SER FALSO NO DIA EM QUE A FALHA PASSOU A CONTAR.
 * "pulados" descreve janela perdida. Um contador que também soma ordem falha
 * precisa dizer o que é — a mesma cicatriz de `encerrado` vs `completo`.
 */
describe("③ e a tela não chama ordem falha de 'pulada'", () => {
  const MSG = readFileSync(join(process.cwd(), "src/lib/i18n/messages.ts"), "utf8");
  const rotulos = [...MSG.matchAll(/dcaSkipped:\s*"([^"]+)"/g)].map((m) => m[1]);

  it("os QUATRO locales existem e nenhum diz 'pulado/skipped'", () => {
    expect(rotulos).toHaveLength(4);
    for (const r of rotulos) {
      expect(r, `"${r}" ainda descreve só o pulo`).not.toMatch(/pulad|skipped|omitid|跳过/i);
      expect(r).toContain("{n}");
    }
  });
});
