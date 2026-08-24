import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { checkBundleSync, MONEY_PATH_PUBLIC_ENV } from "@/lib/admin/audit";

/**
 * A FALHA QUE ISTO PEGA JÁ ACONTECEU (30/07).
 *
 * O painel do guard de swap mostrava "BLOQUEANDO" e a telemetria mostrava
 * "OBSERVANDO", ao mesmo tempo, sem ninguém mentir. `NEXT_PUBLIC_*` é assada no
 * BUILD: salvar o valor novo na Vercel muda o que o SERVIDOR lê na hora e não
 * muda nada no JavaScript que o navegador já baixou, até sair um build novo.
 *
 * Os dois lados discordam em silêncio e cada um, sozinho, está dizendo a
 * verdade — por isso nenhuma verificação de um lado só encontra isso.
 */

const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of MONEY_PATH_PUBLIC_ENV) { SAVED[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of MONEY_PATH_PUBLIC_ENV) {
    if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k];
  }
});

/** Espelho do que o navegador mandaria, com sobrescritas. */
function browser(over: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {};
  for (const k of MONEY_PATH_PUBLIC_ENV) base[k] = null;
  return { ...base, ...over };
}

describe("sem o envio do navegador, a resposta é INCONCLUSIVO", () => {
  it("não aprova só porque não deu para conferir", () => {
    // A regra da casa: ausência de verificação nunca renderiza como segurança.
    const f = checkBundleSync(undefined);
    expect(f.inconclusive).toBe(true);
    expect(f.pass).toBe(false);
    expect(f.detail).toContain("não enviou");
  });
});

describe("build desatualizado — o caso real", () => {
  it("operador liga a trava na Vercel e esquece o redeploy", () => {
    // Servidor já lê "on"; o navegador ainda roda o bundle antigo, sem nada.
    process.env.NEXT_PUBLIC_SOLANA_JITO = "on";
    const f = checkBundleSync(browser());
    expect(f.pass).toBe(false);
    expect(f.inconclusive).toBeFalsy();          // isto é REPROVA, não buraco
    expect(f.detail).toContain("BUILD DESATUALIZADO");
    expect(f.detail).toContain("NEXT_PUBLIC_SOLANA_JITO");
  });

  it("aponta QUAL variável divergiu e os dois valores", () => {
    // Sem os dois lados escritos, o operador não sabe para que lado corrigir.
    process.env.NEXT_PUBLIC_SOLANA_TX_GUARD = "enforce";
    const f = checkBundleSync(browser({ NEXT_PUBLIC_SOLANA_TX_GUARD: "shadow" }));
    expect(f.detail).toContain("enforce");
    expect(f.detail).toContain("shadow");
  });

  it("o caso INVERSO também reprova — desligar na Vercel sem redeploy", () => {
    // O bundle ainda manda o valor antigo; a trava segue valendo no navegador
    // depois de o operador acreditar que desligou.
    const f = checkBundleSync(browser({ NEXT_PUBLIC_SOLANA_JITO: "on" }));
    expect(f.pass).toBe(false);
  });

  it("uma divergência entre seis basta para reprovar", () => {
    process.env.NEXT_PUBLIC_IMPACT_BLOCK_PCT = "15";
    const f = checkBundleSync(browser({ NEXT_PUBLIC_IMPACT_BLOCK_PCT: "50" }));
    expect(f.pass).toBe(false);
  });

  it("é CRÍTICO — uma trava que o operador pensa ter ligado e não ligou", () => {
    expect(checkBundleSync(browser()).severity).toBe("critical");
  });
});

describe("build em dia", () => {
  it("os dois lados iguais passam, e o detalhe mostra o que valeu", () => {
    process.env.NEXT_PUBLIC_SOLANA_JITO = "on";
    process.env.NEXT_PUBLIC_SOLANA_TX_GUARD = "enforce";
    const f = checkBundleSync(browser({
      NEXT_PUBLIC_SOLANA_JITO: "on", NEXT_PUBLIC_SOLANA_TX_GUARD: "enforce",
    }));
    expect(f.pass).toBe(true);
    expect(f.detail).toContain("SOLANA_JITO=on");
  });

  it("tudo vazio dos dois lados é sincronia, não falha", () => {
    // Nenhuma trava configurada é uma decisão do operador; não é dessincronia.
    expect(checkBundleSync(browser()).pass).toBe(true);
  });

  it("ausente e string vazia são a mesma coisa", () => {
    // Senão a Vercel devolvendo "" e o bundle sem a chave viraria alarme falso —
    // e alarme falso treina o operador a ignorar o alarme verdadeiro.
    process.env.NEXT_PUBLIC_SOLANA_JITO = "";
    expect(checkBundleSync(browser({ NEXT_PUBLIC_SOLANA_JITO: null })).pass).toBe(true);
  });

  it("espaço em volta não conta como divergência", () => {
    process.env.NEXT_PUBLIC_SOLANA_JITO = " on ";
    expect(checkBundleSync(browser({ NEXT_PUBLIC_SOLANA_JITO: "on" })).pass).toBe(true);
  });
});

describe("cobertura da lista", () => {
  it("as travas do caminho do dinheiro estão todas vigiadas", () => {
    for (const k of ["NEXT_PUBLIC_SOLANA_TX_GUARD", "NEXT_PUBLIC_SOLANA_JITO",
                     "NEXT_PUBLIC_ALLOWED_SWAP_TARGETS", "NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS",
                     "NEXT_PUBLIC_IMPACT_WARN_PCT", "NEXT_PUBLIC_IMPACT_BLOCK_PCT"] as const) {
      expect(MONEY_PATH_PUBLIC_ENV, `"${k}" fora da vigilância`).toContain(k);
    }
  });
});
