import { describe, it, expect } from "vitest";
import { computeDrift, contadorDrifts, type WalletDrift } from "@/lib/paper/reconcile";

/**
 * ⚠️⚠️ A METADE QUE FALTAVA NO DETECTOR (29/08).
 *
 * `realizedDriftUsd` confere o P&L desde 05/08. Os CONTADORES `wins`/`losses`
 * da mesma linha nunca foram conferidos por nada — e foram eles que apareceram
 * errados no digest do Telegram.
 *
 * A CAUSA: `repairWallets` rodou em 22/08 01:10 (registrado em `admin_kv`,
 * `paper_repair:last`) e realinhou `realized_pnl_usd` ao livro vivo. Ele **não
 * toca** em `wins`/`losses`, que seguem com o total de ANTES do arquivamento.
 * As duas colunas da mesma linha passaram a descrever eras diferentes.
 *
 * Os números abaixo são os REAIS, lidos do banco em 29/08.
 */

const base = {
  source: "mistral_scan", label: "Mistral",
  startingUsd: 1000, cashUsd: 1028.16, storedRealizedUsd: 28.16,
};

describe("os números reais de 29/08", () => {
  it("⚠️ Mistral: a conta diz 44/38 (54%) e o livro vivo diz 30/12 (71%)", () => {
    const d = computeDrift(
      { ...base, storedWins: 44, storedLosses: 38 },
      0, 28.16, 25,
      { wins: 30, losses: 12, arquivadas: 115 },
    );
    expect(d.decididosNaConta).toBe(82);
    expect(d.decididosNoLivro).toBe(42);
    expect(d.desvioDeContador).toBe(40);
    // ⚠️ E o P&L bate perfeitamente — é só o contador que ficou para trás.
    expect(d.realizedDriftUsd).toBe(0);
  });

  it("⚠️ Arbiter 2.0: 1/0 na conta e NADA no livro — 100% de acerto órfão", () => {
    const d = computeDrift(
      { source: "arbiter2", label: "Arbiter 2.0", startingUsd: 300, cashUsd: 300,
        storedRealizedUsd: 0, storedWins: 1, storedLosses: 0 },
      0, 0, 25,
      { wins: 0, losses: 0, arquivadas: 618 },
    );
    expect(d.decididosNaConta).toBe(1);
    expect(d.decididosNoLivro).toBe(0);
    // Uma única vitória de antes do arquivamento virava "100%" no digest, para
    // uma mesa que não opera desde 03/08.
    expect(d.desvioDeContador).toBe(1);
  });

  it("SKAÐI e Radar também divergem, e o P&L de ambos está certo", () => {
    const skadi = computeDrift(
      { source: "strat_day", label: "SKAÐI", startingUsd: 1000, cashUsd: 1040.4,
        storedRealizedUsd: 40.4, storedWins: 74, storedLosses: 60 },
      0, 40.4, 25, { wins: 32, losses: 23, arquivadas: 6 });
    expect(skadi.desvioDeContador).toBe(79);
    expect(skadi.realizedDriftUsd).toBe(0);

    const radar = computeDrift(
      { source: "radar", label: "Radar", startingUsd: 1000, cashUsd: 1007.04,
        storedRealizedUsd: 7.04, storedWins: 44, storedLosses: 47 },
      0, 7.04, 25, { wins: 29, losses: 26, arquivadas: 89 });
    expect(radar.desvioDeContador).toBe(36);
    expect(radar.realizedDriftUsd).toBe(0);
  });
});

describe("⚠️ o que separa CICATRIZ de FERIDA", () => {
  const comArquivo = computeDrift(
    { ...base, storedWins: 44, storedLosses: 38 },
    0, 28.16, 25, { wins: 30, losses: 12, arquivadas: 115 });

  const semArquivo = computeDrift(
    { source: "nova", label: "Mesa Nova", startingUsd: 1000, cashUsd: 1000,
      storedRealizedUsd: 0, storedWins: 9, storedLosses: 3 },
    0, 0, 25, { wins: 5, losses: 3, arquivadas: 0 });

  it("com posição arquivada, a divergência é o DESENHO — não um defeito", () => {
    expect(comArquivo.temArquivadas).toBe(true);
    // Aparece no relatório geral...
    expect(contadorDrifts([comArquivo]).length).toBe(1);
    // ...mas NÃO no filtro que procura defeito novo.
    expect(contadorDrifts([comArquivo], { semArquivo: true }).length).toBe(0);
  });

  it("⚠️ SEM arquivo, conta e livro falam da MESMA janela — discordar é defeito", () => {
    expect(semArquivo.temArquivadas).toBe(false);
    expect(semArquivo.desvioDeContador).toBe(4);
    expect(contadorDrifts([semArquivo], { semArquivo: true }).length).toBe(1);
  });

  it("sem essa distinção o detector seria alarme falso permanente", () => {
    // Doze das carteiras têm posição arquivada. Se todas reprovassem, o
    // operador aprenderia a ignorar — a armadilha que este repo já nomeou.
    const todas = [comArquivo, semArquivo];
    expect(contadorDrifts(todas).length).toBe(2);
    expect(contadorDrifts(todas, { semArquivo: true }).length).toBe(1);
  });
});

describe("quem está alinhado não aparece", () => {
  it("conta e livro iguais dão desvio zero", () => {
    const d = computeDrift(
      { source: "ok", label: "OK", startingUsd: 1000, cashUsd: 1050,
        storedRealizedUsd: 50, storedWins: 7, storedLosses: 3 },
      0, 50, 25, { wins: 7, losses: 3, arquivadas: 0 });
    expect(d.desvioDeContador).toBe(0);
    expect(contadorDrifts([d]).length).toBe(0);
  });

  it("⚠️ contador ausente conta como ZERO decisões, não como desconhecido", () => {
    // `storedWins`/`storedLosses` são opcionais — quem não passa é lido como 0,
    // e uma conta zerada contra um livro com decisões APARECE, que é o certo:
    // contador zerado com livro cheio é o sintoma de um reset pela metade.
    const d = computeDrift(
      { source: "x", label: "X", startingUsd: 1000, cashUsd: 1000, storedRealizedUsd: 0 },
      0, 0, 25, { wins: 4, losses: 2, arquivadas: 0 });
    expect(d.decididosNaConta).toBe(0);
    expect(d.desvioDeContador).toBe(-6);
    expect(contadorDrifts([d], { semArquivo: true }).length).toBe(1);
  });

  it("ordena por tamanho do desvio, pior primeiro", () => {
    const mk = (nome: string, w: number, l: number): WalletDrift => computeDrift(
      { source: nome, label: nome, startingUsd: 1000, cashUsd: 1000,
        storedRealizedUsd: 0, storedWins: w, storedLosses: l },
      0, 0, 25, { wins: 0, losses: 0, arquivadas: 0 });
    const ordenado = contadorDrifts([mk("pequeno", 1, 0), mk("grande", 50, 29), mk("medio", 5, 5)]);
    expect(ordenado.map((d) => d.source)).toEqual(["grande", "medio", "pequeno"]);
  });
});
