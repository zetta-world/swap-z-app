import { describe, it, expect } from "vitest";
import {
  assessMevExposure, mempoolKind, mevAdvice, privateRelayActive,
  MEV_WARN_USD, MEV_HIGH_USD,
} from "@/lib/swap/mev-guard";

describe("privateRelayActive — o teste que impede a mentira de voltar", () => {
  it("a plataforma NÃO roteia por relay privado, e diz isso", () => {
    // Enquanto isto for `false`, nenhuma tela pode afirmar "mempool privado"
    // sem que alguém tenha de alterar esta função — e este teste com ela.
    expect(privateRelayActive()).toBe(false);
  });

  it("o conselho em rede pública admite que quem transmite é a carteira", () => {
    const a = mevAdvice("ethereum");
    expect(a).toContain("não transmite");
    expect(a).toContain("carteira");
  });
});

describe("exposição em dólar — o teto do que o sanduíche pode tirar", () => {
  it("3% sobre $1.000 = até $30 ao alcance do atacante", () => {
    const v = assessMevExposure({ chain: "ethereum", notionalUsd: 1000, slippageBps: 300 });
    expect(v.stealableUsd).toBeCloseTo(30, 6);
    expect(v.level).toBe("warn");
    // "3%" não dói; "$30.00" dói — e é a mesma informação.
    expect(v.message).toContain("$30.00");
  });

  it("reduzir a tolerância reduz o teto na mesma proporção", () => {
    const wide  = assessMevExposure({ chain: "ethereum", notionalUsd: 1000, slippageBps: 300 });
    const tight = assessMevExposure({ chain: "ethereum", notionalUsd: 1000, slippageBps: 50 });
    expect(tight.stealableUsd!).toBeCloseTo(wide.stealableUsd! / 6, 6);
  });

  it("valor grande sobe o tom e sugere dividir a ordem", () => {
    const v = assessMevExposure({ chain: "ethereum", notionalUsd: 50_000, slippageBps: 300 });
    expect(v.level).toBe("high");
    expect(v.stealableUsd).toBeCloseTo(1500, 6);
    expect(v.message).toContain("divida a ordem");
  });

  it("troca pequena não vira alarme — sanduíche não pagaria o próprio gás", () => {
    // Gritar lobo aqui treina o usuário a ignorar o aviso que importa.
    const v = assessMevExposure({ chain: "ethereum", notionalUsd: 100, slippageBps: 300 });
    expect(v.level).toBe("ok");
    expect(v.stealableUsd).toBeCloseTo(3, 6);
    expect(v.message).toBe("");
  });

  it("as fronteiras são inclusivas", () => {
    // notional escolhido para dar exatamente o limiar com 1% de tolerância.
    expect(assessMevExposure({ chain: "ethereum", notionalUsd: MEV_WARN_USD * 100, slippageBps: 100 }).level).toBe("warn");
    expect(assessMevExposure({ chain: "ethereum", notionalUsd: MEV_HIGH_USD * 100, slippageBps: 100 }).level).toBe("high");
  });

  it("sem notional não inventa número nem falsa calma", () => {
    const v = assessMevExposure({ chain: "ethereum", notionalUsd: null, slippageBps: 300 });
    expect(v.stealableUsd).toBeNull();
    expect(v.message).toBe("");
  });
});

describe("a rede decide se o ataque é possível", () => {
  it("mempool pública: ethereum, bsc, polygon, avalanche", () => {
    for (const c of ["ethereum", "bsc", "polygon", "avalanche"] as const) {
      expect(mempoolKind(c)).toBe("public");
    }
  });

  it("sequenciador: base, arbitrum, optimism — NUNCA alarma", () => {
    // Não existe mempool pública para ler. Avisar aqui queimaria a credibilidade
    // do aviso nas redes onde ele é verdade.
    for (const c of ["base", "arbitrum", "optimism"] as const) {
      expect(mempoolKind(c)).toBe("sequencer");
      const v = assessMevExposure({ chain: c, notionalUsd: 100_000, slippageBps: 300 });
      expect(v.level).toBe("ok");
      expect(v.message).toBe("");
    }
  });

  it("solana é 'leader' — sanduíche existe, o mecanismo é outro", () => {
    expect(mempoolKind("solana")).toBe("leader");
    const v = assessMevExposure({ chain: "solana", notionalUsd: 10_000, slippageBps: 300 });
    expect(v.stealableUsd).toBeCloseTo(300, 6);   // acima do limiar de $250
    expect(v.level).toBe("high");
    expect(v.message).toContain("reordena o bloco");
  });

  it("rede desconhecida assume o PIOR caso, não o melhor", () => {
    // Fail-closed: um chain novo não pode ganhar silêncio de graça.
    expect(mempoolKind(undefined)).toBe("public");
  });

  it("o conselho por rede não promete o que não existe", () => {
    expect(mevAdvice("base")).toContain("não é viável");
    expect(mevAdvice("solana")).toContain("não envia por bundle privado");
  });
});
