import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { DESKS, isArquivada } from "@/lib/zion/desks";

/**
 * MESA APOSENTADA NÃO PAGA CONTA.
 *
 * ⚠️⚠️ A CICATRIZ (19/08). As CINCO mesas oráculo estavam `valhalla` desde
 * 27/07 e continuaram chamando a API paga por **três semanas**. Medido no
 * banco: `oracle_grok` 7 chamadas, `oracle_kimi` 6, `oracle_deepseek` 4, só nos
 * últimos 7 dias, a última em 19/08.
 *
 * ⚠️ E O GUARDA JÁ EXISTIA. `isArquivada` é a MESMA função que o cron do
 * backtest usa desde 13/08 — e lá funciona: `backtest_grok`, `backtest_kimi` e
 * `backtest_deepseek` pararam em 14/08 e não gastaram mais nada. O portão
 * estava construído, testado e ligado **em um caminho só**.
 *
 * ⚠️ POR QUE O TESTE OLHA A CLASSE E NÃO O ORÁCULO. Consertar `oracle.ts`
 * fecha UM caminho; o defeito era estrutural — "aposentar" significava coisas
 * diferentes em arquivos diferentes. Um teste que só verificasse o oráculo
 * deixaria o próximo caminho novo nascer com o mesmo furo, e o `sniper.ts` já
 * estava lá, `valhalla` e sem guarda, esperando alguém religar o cron.
 *
 * O dinheiro era pouco (≈$0,50/mês). O que custa é o registro: o torneio
 * marcava `retired`, o painel escrevia Valhalla, e a fatura continuava
 * chegando. Disjuntor que dispara sem cortar o gasto produz a PROVA de ter
 * agido — a mesma armadilha já documentada em `gate-keys.ts`.
 */

/**
 * Todo módulo que pode invocar modelo em nome de uma mesa nomeada.
 *
 * O valor diz ONDE mora o guarda. `"proprio"` = o arquivo chama `isArquivada`;
 * `"no-chamador"` = quem decide é o call-site, e o motivo fica escrito aqui.
 * Módulo novo que chame modelo e não apareça nesta tabela derruba o teste — é
 * de propósito: a lista é o inventário de quem pode gastar.
 */
const GASTAM: Record<string, "proprio" | string> = {
  "src/lib/zion/oracle.ts":       "proprio",
  "src/lib/zion/sniper.ts":       "proprio",
  "src/lib/zion/backtest.ts":
    "no-chamador: src/app/api/zion/backtest/route.ts filtra com isArquivada "
    + "antes de chamar (runBacktestScanForProvider e runHybridScan). Verificado "
    + "no banco: as três mesas de backtest arquivadas pararam em 14/08.",
  "src/lib/zion/strategist-ai.ts":
    "no-chamador: MÍMIR (strat_ai) está VIVA. Se um dia for para Valhalla, este "
    + "arquivo precisa de guarda próprio ou de um call-site que filtre.",
  "src/lib/zion/retro.ts":
    "sem guarda por medição: a reflexão é dirigida pelos DECIDIDOS da rodada "
    + "viva, então mesa que parou de decidir para de refletir sozinha. "
    + "Confirmado no banco — as arquivadas não produzem lição desde 27/07.",
  "src/lib/zion/aprendizado.ts":
    "sem guarda por medição: mesmo caminho do retro.ts, dirigido por decididos.",
  "src/lib/admin/audit-ai.ts":
    "não é mesa: auditoria de código sob demanda do admin, não roda em cron e "
    + "não tem `source` de mesa.",
};

/** Os dois arquivos de infraestrutura que TODO chamador atravessa. */
const INFRA = new Set(["src/lib/ai/provider.ts", "src/lib/ai/registry.ts"]);

function chamaModelo(caminho: string): boolean {
  const src = readFileSync(caminho, "utf8");
  return /\bopenaiCompatChat\b|\broleProviderChain\b/.test(src);
}

/**
 * ⚠️ `readdirSync` recursivo, e não `fs.globSync`: o glob do Node ainda é
 * EXPERIMENTAL. Mesma varredura de `read-safety.test.ts` e
 * `headers-carteira.test.ts` — barra normal para casar com as chaves do
 * inventário no Windows.
 */
function fontes(dir = "src", out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = `${dir}/${nome}`;
    if (statSync(caminho).isDirectory()) fontes(caminho, out);
    else if (/\.tsx?$/.test(nome) && !nome.includes(".test.")) out.push(caminho);
  }
  return out;
}

describe("mesa arquivada não gasta", () => {
  /**
   * ⚠️ O TESTE CENTRAL. Cada gastador declara onde está o seu guarda, e quem
   * diz `"proprio"` tem de realmente chamar `isArquivada`.
   */
  it("todo módulo que chama modelo declara onde está o guarda", () => {
    const semGuarda: string[] = [];
    for (const [caminho, onde] of Object.entries(GASTAM)) {
      if (onde !== "proprio") continue;
      if (!/\bisArquivada\b/.test(readFileSync(caminho, "utf8"))) semGuarda.push(caminho);
    }
    expect(
      semGuarda,
      "estes arquivos dizem ter guarda próprio e não chamam isArquivada — foi "
        + "exatamente assim que o oracle.ts gastou três semanas depois de morto",
    ).toEqual([]);
  });

  /**
   * ⚠️ O INVENTÁRIO NÃO PODE ENVELHECER CALADO. Um caminho novo que chame
   * modelo e não esteja na tabela é o próximo `oracle.ts`: ninguém decidiu que
   * ele podia gastar por uma mesa morta — simplesmente ninguém olhou.
   */
  it("nenhum caminho que gasta ficou fora do inventário", () => {
    const conhecidos = new Set([...Object.keys(GASTAM), ...INFRA]);
    const naoListados = fontes().filter((f) => chamaModelo(f) && !conhecidos.has(f));
    expect(
      naoListados,
      "este arquivo chama modelo e não está no inventário GASTAM. Decida: ele "
        + "gasta em nome de uma mesa? Então precisa de guarda (próprio ou no "
        + "chamador) e de uma linha aqui dizendo qual dos dois.",
    ).toEqual([]);

    const orfas = [...conhecidos].filter((c) => !INFRA.has(c) && !chamaModelo(c));
    expect(orfas, "arquivo no inventário que não chama mais modelo — remova a linha").toEqual([]);
  });

  /**
   * ⚠️ O ORÁCULO, NOMEADO. As cinco estão em Valhalla; se alguma voltar a
   * `live` sem que alguém decida isso de propósito, o guarda passa a deixá-la
   * gastar de novo — e este teste é onde essa decisão aparece.
   */
  it("as cinco mesas oráculo seguem arquivadas", () => {
    const oraculos = DESKS.filter((d) => d.source.startsWith("oracle_"));
    expect(oraculos.length, "o registro deveria ter 5 mesas oráculo").toBe(5);
    const vivas = oraculos.filter((d) => !isArquivada(d.source)).map((d) => d.source);
    expect(
      vivas,
      "mesa oráculo voltou a viver. Se foi de propósito, atualize este teste "
        + "junto — e saiba que ela volta a consumir API paga todo dia às 00:00 UTC.",
    ).toEqual([]);
  });

  /**
   * ⚠️ `isArquivada` É A ÚNICA PERGUNTA. Se alguém trocar por comparação solta
   * de string, o registro deixa de ser fonte única e volta a haver duas
   * verdades sobre quem está morto.
   */
  it("o guarda pergunta ao registro, não a uma lista à mão", () => {
    for (const [caminho, onde] of Object.entries(GASTAM)) {
      if (onde !== "proprio") continue;
      const src = readFileSync(caminho, "utf8");
      expect(
        /status\s*===\s*["']valhalla["']/.test(src),
        `${caminho} compara status na mão — use isArquivada(source)`,
      ).toBe(false);
    }
  });
});
