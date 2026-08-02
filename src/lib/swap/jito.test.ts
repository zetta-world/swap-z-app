import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  decideTip, sendViaJito, sendNarrative, jitoEnabled,
  JITO_TIP_FLOOR_LAMPORTS, JITO_TIP_CAP_LAMPORTS, JITO_MIN_EXPOSURE_USD, JITO_TIP_SHARE,
} from "@/lib/swap/jito";

/**
 * A regra que manda aqui: a GORJETA NUNCA PODE CUSTAR MAIS QUE O ROUBO QUE
 * EVITA. Pagar $0,30 para proteger $0,50 é mudar o prejuízo de lugar, não
 * evitá-lo — seria repetir, com outro nome, o escudo que não protegia nada.
 */

const ORIGINAL = process.env.NEXT_PUBLIC_SOLANA_JITO;
beforeEach(() => { process.env.NEXT_PUBLIC_SOLANA_JITO = "on"; });
afterEach(() => { process.env.NEXT_PUBLIC_SOLANA_JITO = ORIGINAL; });

describe("nasce desligado", () => {
  it("sem a env explícita, não usa Jito", () => {
    // Mesma disciplina do solana-guard: um caminho de dinheiro que ninguém viu
    // rodar não entra ligado por padrão.
    process.env.NEXT_PUBLIC_SOLANA_JITO = undefined as unknown as string;
    delete process.env.NEXT_PUBLIC_SOLANA_JITO;
    expect(jitoEnabled()).toBe(false);
    expect(decideTip(10_000, 150).useJito).toBe(false);
  });

  it("'on' liga; qualquer outro valor não", () => {
    process.env.NEXT_PUBLIC_SOLANA_JITO = "true";
    expect(jitoEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_SOLANA_JITO = "on";
    expect(jitoEnabled()).toBe(true);
  });
});

describe("a gorjeta é proporcional ao que está em risco", () => {
  it("exposição alta gera gorjeta proporcional", () => {
    // $2.000 de exposição, SOL a $150 → 5% = $100 → ~0,667 SOL, mas o TETO
    // corta antes: proteção não pode virar a maior linha de custo da troca.
    const d = decideTip(2000, 150);
    expect(d.useJito).toBe(true);
    expect(d.tipLamports).toBe(JITO_TIP_CAP_LAMPORTS);
  });

  it("dentro da faixa, a conta é exatamente 5% da exposição", () => {
    // $100 de exposição → $5 de gorjeta → a $150/SOL = 0,03333… SOL
    const d = decideTip(100, 150);
    const esperado = Math.round((100 * JITO_TIP_SHARE / 150) * 1e9);
    expect(d.tipLamports).toBe(Math.min(JITO_TIP_CAP_LAMPORTS, esperado));
  });

  it("a gorjeta NUNCA passa do teto", () => {
    for (const exp of [1_000, 50_000, 1_000_000]) {
      expect(decideTip(exp, 150).tipLamports).toBeLessThanOrEqual(JITO_TIP_CAP_LAMPORTS);
    }
  });

  it("quando usada, a gorjeta respeita o piso", () => {
    const d = decideTip(JITO_MIN_EXPOSURE_USD, 500_000);  // SOL absurdamente caro
    expect(d.tipLamports).toBeGreaterThanOrEqual(JITO_TIP_FLOOR_LAMPORTS);
  });

  it("a gorjeta é sempre uma fração pequena da exposição, nunca maior", () => {
    // O teste que guarda a regra da casa.
    for (const [exp, sol] of [[30, 150], [100, 150], [500, 200], [2000, 80]] as const) {
      const d = decideTip(exp, sol);
      if (!d.useJito) continue;
      const tipUsd = (d.tipLamports / 1e9) * sol;
      expect(tipUsd, `exposição $${exp}`).toBeLessThan(exp);
    }
  });
});

describe("quando NÃO vale a pena proteger", () => {
  it("exposição abaixo do limiar não paga gorjeta nenhuma", () => {
    // Abaixo disso o sanduíche nem pagaria o próprio custo — a gorjeta seria
    // despesa pura. É o MESMO limiar do aviso do mev-guard, de propósito: se
    // discordassem, a tela avisaria de um risco que o envio ignora.
    const d = decideTip(JITO_MIN_EXPOSURE_USD - 1, 150);
    expect(d.useJito).toBe(false);
    expect(d.tipLamports).toBe(0);
    expect(d.reason).toContain("baixa demais");
  });

  it("sem preço do SOL não chuta valor", () => {
    // Um fixo aqui poderia cobrar caro numa troca pequena.
    for (const px of [null, 0, -1]) {
      expect(decideTip(1000, px).useJito).toBe(false);
    }
  });

  it("exposição desconhecida não vira gorjeta", () => {
    expect(decideTip(null, 150).useJito).toBe(false);
    expect(decideTip(NaN, 150).useJito).toBe(false);
  });
});

describe("falha do Jito não pode quebrar o swap", () => {
  const fakeFetch = (body: unknown, ok = true, status = 200) =>
    (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;

  it("sucesso devolve assinatura e admite que usou o bundle", async () => {
    const r = await sendViaJito("AAA=", "mainnet", fakeFetch({ result: "sig123" }));
    expect(r).toEqual({ signature: "sig123", usedJito: true });
  });

  it("erro do engine NÃO lança — devolve o motivo para o chamador cair no RPC", async () => {
    const r = await sendViaJito("AAA=", "mainnet", fakeFetch({ error: { message: "bundle rejeitado" } }));
    expect(r.signature).toBeNull();
    expect(r.usedJito).toBe(false);
    expect(r.error).toBe("bundle rejeitado");
  });

  it("HTTP ruim vira motivo legível, não exceção", async () => {
    const r = await sendViaJito("AAA=", "mainnet", fakeFetch(null, false, 503));
    expect(r.usedJito).toBe(false);
    expect(r.error).toContain("503");
  });

  it("rede fora vira motivo legível, não exceção", async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const r = await sendViaJito("AAA=", "mainnet", boom);
    expect(r.usedJito).toBe(false);
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("resposta sem assinatura não é tratada como sucesso", async () => {
    const r = await sendViaJito("AAA=", "mainnet", fakeFetch({}));
    expect(r.usedJito).toBe(false);
  });
});

describe("a narrativa não pode afirmar escudo que não houve", () => {
  it("com bundle, diz bundle e mostra a gorjeta", () => {
    const s = sendNarrative({ signature: "x", usedJito: true }, 5_000_000);
    expect(s).toContain("bundle privado");
    expect(s).toContain("0.005000");
  });

  it("SEM bundle, diz que foi público — mesmo com o swap dando certo", () => {
    // Este é o teste que impede o escudo verde de renascer: sucesso do swap
    // não autoriza a tela a afirmar proteção que não aconteceu.
    const s = sendNarrative({ signature: "x", usedJito: false, error: "engine fora" }, 0);
    expect(s).toContain("RPC público");
    expect(s).toContain("sem bundle privado");
    expect(s).not.toContain("Enviado por bundle privado");   // a AFIRMAÇÃO, não a palavra
    expect(s).toContain("engine fora");
  });
});
