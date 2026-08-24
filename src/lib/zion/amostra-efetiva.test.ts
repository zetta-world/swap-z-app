/**
 * AMOSTRA EFETIVA — o caso real de 15/08.
 *
 * O torneio marcou +1,53%/trade com 4 decididos, 75% de acerto e PF 5,07.
 * Três dos quatro eram OP · range_reversion · RANGING, dois deles criados no
 * MESMO segundo e resolvidos no MESMO minuto com resultado idêntico. Um
 * movimento do OP, capturado três vezes.
 */

import { describe, it, expect } from "vitest";
import { nEfetivo, porQueEfetivoMenor, JANELA_CLUSTER_MS, porQueCoorteMenor } from "@/lib/zion/amostra-efetiva";

const h = (n: number) => n * 3_600_000;
const t = (symbol: string, kind: string, hora: number) =>
  ({ symbol, kind, resolvidoEmMs: h(hora) });

describe("o caso do OP", () => {
  it("os 4 trades de 15/08 valem 2 ideias, não 4", () => {
    const reais = [
      t("DOT", "sell_safe", 2.5),          // 02:30
      t("OP", "range_reversion", 4.5),     // 04:30
      t("OP", "range_reversion", 6.0),     // 06:00
      t("OP", "range_reversion", 6.0),     // 06:00 — mesma, de outra mesa
    ];
    expect(reais).toHaveLength(4);
    expect(nEfetivo(reais)).toBe(2);
  });
});

describe("o que agrupa e o que não agrupa", () => {
  it("mesmo símbolo, mesmo playbook, mesma janela → UMA ideia", () => {
    expect(nEfetivo([
      t("OP", "range_reversion", 1), t("OP", "range_reversion", 2), t("OP", "range_reversion", 3),
    ])).toBe(1);
  });

  it("mesmo símbolo, playbook DIFERENTE → ideias distintas", () => {
    expect(nEfetivo([t("OP", "range_reversion", 1), t("OP", "trend_pullback", 2)])).toBe(2);
  });

  it("mesmo playbook, símbolo DIFERENTE → ideias distintas", () => {
    expect(nEfetivo([t("OP", "range_reversion", 1), t("ADA", "range_reversion", 2)])).toBe(2);
  });

  /**
   * ⚠️ A JANELA É O QUE IMPEDE O AGRUPAMENTO DE VIRAR CENSURA. Dois trades do
   * mesmo par com três dias de diferença SÃO observações independentes — o
   * mercado teve tempo de mudar de ideia entre um e outro.
   */
  it("fora da janela, o mesmo par volta a contar como ideia nova", () => {
    expect(nEfetivo([t("OP", "range_reversion", 0), t("OP", "range_reversion", 25)])).toBe(2);
    expect(nEfetivo([t("OP", "range_reversion", 0), t("OP", "range_reversion", 23)])).toBe(1);
  });

  /**
   * ⚠️ ENCADEAMENTO POR VIZINHO, não distância ao primeiro. Uma sequência que
   * anda de 12 em 12 horas é uma ideia que se ARRASTOU, não várias — e medir
   * pelo primeiro cortaria a corrente no meio, arbitrariamente.
   */
  it("sequência de 12 em 12 horas é UMA ideia que se arrastou", () => {
    expect(nEfetivo([0, 12, 24, 36, 48].map((x) => t("OP", "range_reversion", x)))).toBe(1);
  });

  it("mas um buraco no meio da corrente abre ideia nova", () => {
    expect(nEfetivo([0, 12, 60, 72].map((x) => t("OP", "range_reversion", x)))).toBe(2);
  });

  it("a ordem de entrada não muda o resultado", () => {
    const a = [t("OP", "r", 0), t("OP", "r", 12), t("OP", "r", 60)];
    expect(nEfetivo([...a].reverse())).toBe(nEfetivo(a));
  });

  it("símbolo em caixas diferentes é o mesmo símbolo", () => {
    expect(nEfetivo([t("op", "r", 1), t("OP", "r", 2)])).toBe(1);
  });
});

describe("o que não dá para identificar", () => {
  /**
   * ⚠️ Agrupar o que não se consegue identificar seria AFIRMAR correlação sem
   * prova. Este laboratório não inventa nem para o lado conservador.
   */
  it("sem símbolo ou sem playbook, cada trade é uma ideia própria", () => {
    expect(nEfetivo([
      { symbol: null, kind: "r", resolvidoEmMs: h(1) },
      { symbol: "OP", kind: null, resolvidoEmMs: h(1) },
      { symbol: "  ", kind: "r", resolvidoEmMs: h(1) },
    ])).toBe(3);
  });

  it("tempo ilegível não agrupa nem explode", () => {
    expect(nEfetivo([{ symbol: "OP", kind: "r", resolvidoEmMs: Number.NaN }])).toBe(1);
  });

  it("lista vazia é zero, não um", () => {
    expect(nEfetivo([])).toBe(0);
  });
});

describe("janela configurável", () => {
  it("respeita a janela passada", () => {
    const dois = [t("OP", "r", 0), t("OP", "r", 2)];
    expect(nEfetivo(dois, h(1))).toBe(2);
    expect(nEfetivo(dois, h(3))).toBe(1);
    expect(JANELA_CLUSTER_MS).toBe(h(24));
  });
});

describe("porQueEfetivoMenor", () => {
  it("cala quando bruto e efetivo são iguais — aviso que aparece sempre ninguém lê", () => {
    expect(porQueEfetivoMenor(4, 4)).toBe("");
    expect(porQueEfetivoMenor(4, 5)).toBe("");
  });

  it("explica quando divergem, e diz que a MÉDIA continua valendo", () => {
    const f = porQueEfetivoMenor(4, 2);
    expect(f).toContain("4 trades");
    expect(f).toContain("2 ideia");
    expect(f).toContain("média continua valendo");
  });
});

/**
 * ⚠️ A CORRELAÇÃO ENTRE MESAS — o buraco do meu próprio conserto (16/08).
 *
 * `nEfetivo` foi escrito em 15/08 e aplicado POR MESA. No dia seguinte apareceu
 * o caso que ele não pega: um movimento do UNI capturado por três mesas
 * diferentes, cada uma com UM trade, cada uma marcando "1 ideia" — e o painel
 * mostrando três confirmações independentes.
 *
 * O algoritmo estava certo. Errado era o que eu dava a ele.
 */
describe("amostra efetiva — a correlação ENTRE mesas", () => {
  const H = 3_600_000;
  const t = (iso: string) => Date.parse(iso);

  /** O caso real de 14/08, com os instantes que estão no banco. */
  const tresUni = [
    { symbol: "UNI", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T11:30:18Z") }, // kimi_scan
    { symbol: "UNI", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T12:00:19Z") }, // mistral_scan
    { symbol: "UNI", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T12:00:20Z") }, // radar
  ];

  it("por mesa: cada uma marca 1 ideia, e o total parece 3", () => {
    // É exatamente o que a tela mostrava — e cada linha, isolada, está certa.
    for (const trade of tresUni) expect(nEfetivo([trade])).toBe(1);
    expect(tresUni.map((x) => nEfetivo([x])).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("na coorte: os mesmos três trades são UMA ideia", () => {
    expect(nEfetivo(tresUni)).toBe(1);
  });

  it("mesas diferentes em símbolos diferentes continuam independentes", () => {
    // A correção não pode colapsar tudo — só o que é o mesmo movimento.
    const variado = [
      { symbol: "UNI", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T12:00:00Z") },
      { symbol: "DOT", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T12:00:00Z") },
      { symbol: "UNI", kind: "range_reversion", resolvidoEmMs: t("2026-08-14T12:00:00Z") },
    ];
    expect(nEfetivo(variado)).toBe(3);
  });

  it("o mesmo par em dias distintos são duas ideias, não uma", () => {
    expect(nEfetivo([
      { symbol: "UNI", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T12:00:00Z") },
      { symbol: "UNI", kind: "sell_safe", resolvidoEmMs: t("2026-08-14T12:00:00Z") + 25 * H },
    ])).toBe(2);
  });

  it("porQueCoorteMenor fala de MESAS, não de repetição da mesma mesa", () => {
    const aviso = porQueCoorteMenor(46, 23);
    expect(aviso).toContain("46");
    expect(aviso).toContain("23");
    expect(aviso).toContain("mesas diferentes");
    // Silêncio quando não há o que avisar — aviso que aparece sempre não é lido.
    expect(porQueCoorteMenor(23, 23)).toBe("");
    expect(porQueCoorteMenor(10, 12)).toBe("");
  });
});
