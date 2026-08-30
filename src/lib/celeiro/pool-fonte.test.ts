import { describe, it, expect } from "vitest";
import {
  liquidezTravada, concentracaoTop10, vendaTestePassou, montarPool, candidatosDe,
  TETO_IMPOSTO_DE_VENDA,
} from "@/lib/celeiro/pool-fonte";
import { portaoDeSobrevivencia } from "@/lib/celeiro/pool-novo";
import type { GoPlusTokenSecurity } from "@/lib/api/goplus";
import { extrairEndereco, type PoolSummary } from "@/lib/api/geckoterminal";

/**
 * A FONTE DO POOL NOVO — e a regra que atravessa cada função aqui.
 *
 * ⚠️⚠️ AUSÊNCIA DE PROVA NUNCA VIRA PROVA. Toda leitura que falha tem de
 * produzir o veredito PESSIMISTA, porque a leitura otimista é grátis de escrever
 * e cara de descobrir. Ligar este agente com os portões devolvendo "ok" teria
 * sido pior que não rodá-lo: ele apostaria sem verificar nada, com a APARÊNCIA
 * de estar protegido — o defeito do "escudo MEV" que era adesivo.
 */

const VAZIO = {} as GoPlusTokenSecurity;

describe("a liquidez travada", () => {
  /**
   * ⚠️ SEM `lp_holders` A RESPOSTA É `false`, NUNCA `true`. Um pool cuja trava
   * ninguém verificou é indistinguível de um pool sem trava.
   */
  it("sem dado de LP, não está travada", () => {
    expect(liquidezTravada(null)).toBe(false);
    expect(liquidezTravada(VAZIO)).toBe(false);
    expect(liquidezTravada({ lp_holders: [] } as GoPlusTokenSecurity)).toBe(false);
  });

  it("LP marcado como travado conta", () => {
    expect(liquidezTravada({ lp_holders: [
      { address: "0x1", balance: "1", percent: "0.8", is_locked: 1 },
    ] } as GoPlusTokenSecurity)).toBe(true);
  });

  /** ⚠️ LP QUEIMADO É A TRAVA MAIS FORTE QUE EXISTE — não volta. */
  it("LP queimado conta como travado", () => {
    expect(liquidezTravada({ lp_holders: [
      { address: "0x0", tag: "Burn Address", balance: "1", percent: "0.9" },
    ] } as GoPlusTokenSecurity)).toBe(true);
  });

  /** Trava parcial pequena não impede a retirada que mata o pool. */
  it("trava de minoria não basta", () => {
    expect(liquidezTravada({ lp_holders: [
      { address: "0x1", balance: "1", percent: "0.30", is_locked: 1 },
      { address: "0x2", balance: "1", percent: "0.70" },
    ] } as GoPlusTokenSecurity)).toBe(false);
  });
});

describe("a concentração do top 10", () => {
  /**
   * ⚠️⚠️ `null`, NUNCA ZERO. Devolver 0 diria "pulverizado" — a leitura mais
   * otimista possível a partir de NENHUMA informação, e a mais cara quando
   * estiver errada. O portão reprova no null.
   */
  it("sem dado devolve null, e o portão reprova", () => {
    expect(concentracaoTop10(null)).toBeNull();
    expect(concentracaoTop10(VAZIO)).toBeNull();

    const p = montarPool(null, 50_000, 30);
    expect(p.concentracaoTop10).toBeNull();
    expect(portaoDeSobrevivencia(p).recusas.join(" ")).toContain("não medida");
  });

  it("soma os dez maiores", () => {
    const sec = { holders: [
      { address: "a", balance: "1", percent: "0.20" },
      { address: "b", balance: "1", percent: "0.15" },
    ] } as GoPlusTokenSecurity;
    expect(concentracaoTop10(sec)).toBeCloseTo(0.35, 9);
  });

  /**
   * ⚠️ CARTEIRA QUEIMADA OU TRAVADA SAI DA CONTA. Supply em endereço morto não
   * vai ser vendido — contá-lo reprovaria pools honestos por um risco que não
   * existe. Aqui: 0,60 queimado + 0,20 vivo = concentração REAL de 0,20.
   */
  it("supply queimado ou travado não é concentração", () => {
    const sec = { holders: [
      { address: "0x0", tag: "Burn Address", balance: "1", percent: "0.60" },
      { address: "0x9", balance: "1", percent: "0.10", is_locked: 1 },
      { address: "0xa", balance: "1", percent: "0.20" },
    ] } as GoPlusTokenSecurity;
    expect(concentracaoTop10(sec)).toBeCloseTo(0.20, 9);
  });
});

describe("a venda de teste", () => {
  /**
   * ⚠️⚠️ TRÊS RESPOSTAS, NÃO DUAS. `null` = ninguém conseguiu simular, que o
   * portão trata como o caso mais perigoso — é o que um honeypot produz.
   */
  it("sem nenhum campo de simulação devolve null", () => {
    expect(vendaTestePassou(null)).toBeNull();
    expect(vendaTestePassou(VAZIO)).toBeNull();
  });

  it("honeypot ou não-vende-tudo reprovam", () => {
    expect(vendaTestePassou({ is_honeypot: "1" } as GoPlusTokenSecurity)).toBe(false);
    expect(vendaTestePassou({ cannot_sell_all: "1" } as GoPlusTokenSecurity)).toBe(false);
  });

  /**
   * ⚠️ IMPOSTO ALTO É "NÃO DÁ PARA SAIR" NA PRÁTICA. Um token com 40% de taxa
   * tecnicamente permite vender e economicamente não — o portão precisa da
   * resposta econômica, não da jurídica.
   */
  it("imposto de venda acima do teto reprova, mesmo sem honeypot", () => {
    expect(vendaTestePassou({ is_honeypot: "0", sell_tax: "0.40" } as GoPlusTokenSecurity)).toBe(false);
    expect(vendaTestePassou({ is_honeypot: "0", sell_tax: "0.02" } as GoPlusTokenSecurity)).toBe(true);
    expect(TETO_IMPOSTO_DE_VENDA).toBeLessThan(0.40);
  });
});

describe("o pool montado, de ponta a ponta", () => {
  const BOM = {
    is_honeypot: "0", cannot_sell_all: "0", sell_tax: "0.01",
    lp_holders: [{ address: "0x0", tag: "Burn Address", balance: "1", percent: "1" }],
    holders: [{ address: "0xa", balance: "1", percent: "0.20" }],
  } as GoPlusTokenSecurity;

  it("pool sadio passa em todos os portões", () => {
    const p = montarPool(BOM, 50_000, 30);
    expect(portaoDeSobrevivencia(p).entra).toBe(true);
  });

  /**
   * ⚠️ O CASO QUE JUSTIFICA O MÓDULO INTEIRO. Segurança ilegível não produz um
   * pool "provavelmente ok": produz TRÊS recusas de uma vez — trava,
   * concentração e venda. É o oposto exato de ligar o agente com os portões
   * devolvendo "ok".
   */
  it("segurança ilegível reprova em três eixos, não passa", () => {
    const p = montarPool(null, 50_000, 30);
    const r = portaoDeSobrevivencia(p);
    expect(r.entra).toBe(false);
    expect(r.recusas).toHaveLength(3);
    expect(r.recusas.join(" ")).toContain("honeypot");
  });

  it("liquidez e idade fora da faixa reprovam junto", () => {
    const r = portaoDeSobrevivencia(montarPool(BOM, 100, 1));
    expect(r.entra).toBe(false);
    expect(r.recusas).toHaveLength(2);
  });
});

describe("os candidatos vindos da GeckoTerminal", () => {
  /**
   * ⚠️⚠️ ESTE TESTE JÁ PASSOU VERDE SOBRE UM DEFEITO — e passou porque o
   * FIXTURE mentia (30/08).
   *
   * A versão anterior montava `id: "base_0xTOKEN"` com `address: "0xPOOL"` e
   * exigia que `candidatosDe` extraísse `0xTOKEN` do id. O código fazia
   * `id.split("_")[1]` e o teste ficava verde.
   *
   * Só que o id REAL da GeckoTerminal é `<rede>_<endereço do POOL>` — o token
   * base não está nele; ele vive em `relationships.base_token`. Ou seja, o
   * fixture inventou um formato que a fonte não produz, e o teste passou a
   * comprovar a crença do autor em vez do comportamento da API.
   *
   * Em produção isso dava `tokenAddress === poolAddress` em TODOS os
   * candidatos. A GoPlus, perguntada sobre a segurança de um contrato de pool,
   * não devolve nada — e o `pool_novo` reprovou 100% dos candidatos com "pool
   * não lido" por DEZ DIAS, parecendo um agente rigoroso.
   *
   * ⚠️ A LIÇÃO: um fixture é uma AFIRMAÇÃO sobre a fonte. Quando ele é escrito
   * a partir da mesma suposição que o código, o teste não verifica nada — só
   * ecoa. Os campos abaixo são os do formato real.
   */
  const poolReal = (over: Partial<PoolSummary> = {}) => ({
    id: "base_0xPOOL", address: "0xPOOL", network: "base",
    name: "PEPE / WETH", baseSymbol: "PEPE", quoteSymbol: "WETH",
    dex: "uniswap", tvlUsd: 1, volume24h: 1, change24h: 0, priceUsd: 1,
    baseTokenAddress: "0xTOKEN",
    ...over,
  }) as PoolSummary;

  it("⚠️ o token vem de `baseTokenAddress`, não do id do pool", () => {
    const c = candidatosDe([poolReal()]);
    expect(c[0].tokenAddress).toBe("0xTOKEN");
    expect(c[0].poolAddress).toBe("0xPOOL");
    expect(c[0].chain).toBe("base");
  });

  it("⚠️⚠️ o formato REAL do id não vira mais endereço de token", () => {
    // Antes, `base_0xPOOL` produzia tokenAddress = "0xPOOL". Sem
    // `baseTokenAddress`, o candidato agora é DESCARTADO em vez de nascer
    // impossível de julgar.
    expect(candidatosDe([poolReal({ baseTokenAddress: undefined })])).toEqual([]);
  });

  it("⚠️ token igual ao pool é descartado — era o sintoma do defeito", () => {
    expect(candidatosDe([poolReal({ baseTokenAddress: "0xpool" })])).toEqual([]);
  });

  it("⚠️ rede com underscore no nome não parte o endereço ao meio", () => {
    // `arbitrum_nova` existe. Cortar no PRIMEIRO `_` devolveria "nova".
    expect(extrairEndereco("arbitrum_nova_0xABC")).toBe("0xABC");
    expect(extrairEndereco("base_0xABC")).toBe("0xABC");
    expect(extrairEndereco("0xSEMREDE")).toBe("0xSEMREDE");
    expect(extrairEndereco(undefined)).toBe("");
  });

  it("pool sem endereço é descartado em vez de virar candidato vazio", () => {
    expect(candidatosDe([{ id: "x_y", address: "" } as PoolSummary])).toEqual([]);
  });
});
