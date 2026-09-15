/**
 * ⚠️⚠️ O TETO DIÁRIO DO DCA SÓ VALE SE UMA PASSADA RODA POR VEZ — achado A20.
 *
 * O cron não tinha trava nenhuma. O teto é da CARTEIRA e é aplicado por
 * leitura-depois-ação: `gastoHojeDaCarteira` lê, `tetoDoCiclo` decide, e só
 * depois a ordem sai. Duas invocações concorrentes leem o MESMO gasto e
 * disparam as duas.
 *
 * ⚠️ A `unique` do `reservarCiclo` NÃO cobre isto: ela impede repetir o MESMO
 * ciclo do MESMO plano. O teto atravessa PLANOS — dois planos da mesma carteira
 * reservam ciclos diferentes, passam os dois, e estouram o teto juntos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TTL_DA_TRAVA_MS, CHAVE_DA_TRAVA } from "./trava";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const TRAVA_BRUTA = leia("src/lib/dca/trava.ts");
const TRAVA = semComentarios(TRAVA_BRUTA);
const CRON  = semComentarios(leia("src/app/api/dca/cron/route.ts"));
const ROTA_BRUTA = leia("src/app/api/dca/cron/route.ts");

describe("① a aquisição é ATÔMICA, não lê-depois-escreve", () => {
  it("⚠️⚠️ UPDATE condicional com `.select()` — o Postgres serializa e só um casa", () => {
    // O helper da vitrine (`pegouATrava` em mesas-da-casa) é lê-DEPOIS-escreve:
    // duas chamadas concorrentes podem ler "livre" e escrever as duas. Lá isso
    // é correto (o pior caso é medir duas vezes). Aqui seria uma trava que não
    // trava, no caminho do dinheiro.
    expect(TRAVA).toMatch(/\.update\(\{ value: ate[\s\S]{0,80}\.eq\("key", CHAVE_DA_TRAVA\)[\s\S]{0,60}\.lt\("value", agoraIso\)[\s\S]{0,40}\.select\(/);
    expect(TRAVA).toMatch(/return \(data\?\.length \?\? 0\) > 0 \? "peguei" : "ocupada"/);
  });

  it("⚠️ e NÃO existe leitura da trava antes da escrita — seria a corrida de volta", () => {
    const i = TRAVA.indexOf("export async function pegarATrava");
    const corpo = TRAVA.slice(i, TRAVA.indexOf("\n}", i));
    expect(corpo).not.toMatch(/\.select\("value"\)/);
    expect(corpo).not.toMatch(/maybeSingle/);
  });

  it("⚠️ a semeadura não sobrescreve — senão ela mesma vira a corrida", () => {
    expect(TRAVA).toMatch(/ignoreDuplicates: true/);
  });
});

describe("② três respostas, porque 'não sei' não é 'ocupada'", () => {
  it('⚠️⚠️ o tipo tem "peguei" | "ocupada" | "nao_sei"', () => {
    expect(TRAVA).toMatch(/export type Aquisicao = "peguei" \| "ocupada" \| "nao_sei"/);
  });

  it("⚠️ banco ausente e erro de consulta devolvem `nao_sei`, nunca `ocupada`", () => {
    const i = TRAVA.indexOf("export async function pegarATrava");
    const corpo = TRAVA.slice(i, TRAVA.indexOf("\n}", i));
    expect(corpo).toMatch(/if \(!db\) return "nao_sei"/);
    expect(corpo).toMatch(/if \(erroDaSemeadura\) return "nao_sei"/);
    expect(corpo).toMatch(/if \(error\) return "nao_sei"/);
  });
});

describe("③ e o cron trata as três de forma diferente", () => {
  it("`ocupada` sai calado — é a rotina para a qual a trava existe", () => {
    expect(CRON).toMatch(/if \(trava === "ocupada"\)/);
    expect(CRON).toMatch(/nota: "outra passada em curso"/);
  });

  it("⚠️⚠️ `nao_sei` FALHA FECHADO — 503, e nada é executado", () => {
    // Seguir sem saber se outra passada está comprando é o defeito que esta
    // trava fecha. Janela perdida é recuperável; teto estourado não é.
    expect(CRON).toMatch(/if \(trava === "nao_sei"\)/);
    expect(CRON).toMatch(/error: "trava_indisponivel", processed: 0 \}, \{ status: 503 \}/);
    expect(ROTA_BRUTA).toMatch(/NADA foi executado/);
  });

  it("⚠️⚠️ a trava é pega ANTES de qualquer plano ser lido", () => {
    /**
     * ⚠️ ESTA TRAVA JÁ TEVE BURACO: media ordem de TEXTO no arquivo, e uma
     * aquisição extra dentro de `passada()` a satisfazia sem mover a de
     * verdade. Agora exige a forma: a aquisição mora em `POST`, `passada()`
     * não chama `pegarATrava` nenhuma vez, e o `return await passada()` vem
     * depois dos três desfechos da trava.
     */
    const iPassada = CRON.indexOf("async function passada()");
    expect(iPassada).toBeGreaterThan(0);
    const corpoDaPassada = CRON.slice(iPassada);
    expect(corpoDaPassada, "quem lê os planos não decide a trava").not.toMatch(/pegarATrava/);

    const emPost = CRON.slice(0, iPassada);
    expect([...emPost.matchAll(/await pegarATrava\(\)/g)], "uma aquisição, em POST").toHaveLength(1);
    expect(emPost.indexOf("await pegarATrava()"))
      .toBeLessThan(emPost.indexOf("return await passada()"));
    // E os planos só são lidos dentro de `passada()`, depois da trava.
    expect(emPost).not.toMatch(/await planosVencidos\(/);
  });

  it("⚠️⚠️ e é solta em `finally` — exceção no meio não a deixa presa", () => {
    expect(CRON).toMatch(/\} finally \{\s*await soltarATrava\(\);/);
  });

  it("⚠️ o heartbeat continua ANTES da trava — senão o watchdog acusa cron morto", () => {
    // Com a trava ocupada o cron PASSA e volta; se o heartbeat ficasse depois,
    // uma passada ocupada leria como "cron parado".
    const iBatida = CRON.indexOf('setCronHeartbeat("dca")');
    const iTrava  = CRON.indexOf("const trava = await pegarATrava()");
    expect(iBatida).toBeGreaterThan(0);
    expect(iBatida).toBeLessThan(iTrava);
  });
});

describe("④ o TTL cobre a duração máxima da função", () => {
  it("⚠️ maior que o `maxDuration` da rota — trava presa expira sozinha", () => {
    const m = /export const maxDuration = (\d+)/.exec(ROTA_BRUTA);
    expect(m, "maxDuration sumiu da rota — atualize esta trava").not.toBeNull();
    const maxMs = Number(m![1]) * 1000;
    expect(TTL_DA_TRAVA_MS).toBeGreaterThan(maxMs);
    // E não tão longo que uma queda bloqueie o DCA por muito tempo.
    expect(TTL_DA_TRAVA_MS).toBeLessThanOrEqual(maxMs * 3);
  });

  it("a chave é do DCA e não colide com outras travas do admin_kv", () => {
    expect(CHAVE_DA_TRAVA).toBe("lock:dca:passada");
  });
});
