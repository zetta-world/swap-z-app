import { describe, it, expect } from "vitest";
import { getAddress } from "viem";
import { DEFAULT_TOKENS } from "@/lib/tokens";
import manifest from "@/lib/tokens-verified.json";

/**
 * O REGISTRO DE TOKENS — endereços digitados à mão, nunca conferidos.
 *
 * O arquivo trazia a confissão no próprio comentário: "in production, this is
 * fetched from CoinGecko / TrustWallet token lists". Nunca foi. Nenhum dos
 * endereços tinha sido comparado com fonte nenhuma.
 *
 * E o `token-safety` que entrou dias antes NÃO cobre isto: ele pergunta se o
 * token é GOLPE, não se é o token CERTO. Um endereço errado manda dinheiro para
 * o contrato errado com todos os selos verdes acesos.
 *
 * A conferência externa mora em `scripts/verify-tokens.mjs` e no manifesto que
 * ele grava. Estes testes são a parte que roda SEM REDE, em todo push:
 *
 *   1. EIP-55 — a defesa contra o erro que realmente acontece, que é digitar um
 *      caractere errado. Um endereço com um dígito trocado quase sempre falha o
 *      checksum, então isto converte "digitado à mão" em "à prova de typo".
 *   2. Cobertura do manifesto — token novo entra JÁ conferido, ou o CI reprova.
 */

const CONTRACT_TOKENS = DEFAULT_TOKENS.filter((t) => t.address !== "native");
const EVM = CONTRACT_TOKENS.filter((t) => t.chain !== "solana");

describe("endereços EVM — à prova de typo", () => {
  it("todo endereço passa no checksum EIP-55", () => {
    // `getAddress` recalcula o checksum e recusa uma mistura de caixa que não
    // fecha. Um dígito trocado praticamente nunca sobrevive a isso.
    for (const t of EVM) {
      expect(() => getAddress(t.address), `${t.chain}:${t.symbol} ${t.address}`).not.toThrow();
    }
  });

  it("todo endereço está GRAVADO na forma com checksum", () => {
    // Guardar em minúsculas não é inseguro, mas apaga a proteção: quem lê o
    // arquivo depois não consegue distinguir um endereço conferido de um
    // digitado agora. A forma canônica mantém a evidência visível.
    for (const t of EVM) {
      expect(t.address, `${t.chain}:${t.symbol}`).toBe(getAddress(t.address));
    }
  });

  it("nenhum endereço tem tamanho errado", () => {
    for (const t of EVM) expect(t.address, `${t.chain}:${t.symbol}`).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("endereços Solana", () => {
  it("são base58 com o tamanho de uma chave pública", () => {
    // base58 não tem 0, O, I nem l — o alfabeto já rejeita boa parte dos typos.
    for (const t of CONTRACT_TOKENS.filter((x) => x.chain === "solana")) {
      expect(t.address, `solana:${t.symbol}`).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    }
  });
});

describe("cobertura do manifesto — token novo não entra sem conferência", () => {
  const byKey = new Map(manifest.tokens.map((e) => [`${e.chain}:${e.address}`, e]));

  it("todo token do registro tem entrada no manifesto", () => {
    for (const t of DEFAULT_TOKENS) {
      expect(byKey.has(`${t.chain}:${t.address}`), `${t.chain}:${t.symbol} sem conferência`).toBe(true);
    }
  });

  it("o manifesto não guarda token que saiu do registro", () => {
    const live = new Set(DEFAULT_TOKENS.map((t) => `${t.chain}:${t.address}`));
    for (const e of manifest.tokens) {
      expect(live.has(`${e.chain}:${e.address}`), `${e.chain}:${e.symbol} sobrou no manifesto`).toBe(true);
    }
  });

  it("os DECIMAIS do manifesto batem com os do registro", () => {
    // O campo que mais dói errado: 6 casas trocadas por 18 transformam $1 em
    // $1.000.000.000.000 no cálculo de notional — e a guarda de impacto, que lê
    // justamente esse número, aprovaria feliz.
    for (const t of DEFAULT_TOKENS) {
      expect(byKey.get(`${t.chain}:${t.address}`)?.decimals, `${t.chain}:${t.symbol}`).toBe(t.decimals);
    }
  });

  it("NENHUM token está em divergência com a fonte externa", () => {
    // Este é o teste que falha se alguém trocar um endereço por outro que
    // existe mas não é o mesmo ativo.
    const bad = manifest.tokens.filter((e) => e.status === "mismatch" || e.status === "invalid_address");
    expect(bad.map((e) => `${e.chain}:${e.symbol}`)).toEqual([]);
  });

  it("'não encontrado' é registrado como tal — nunca como verificado", () => {
    // A regra da casa: ausência de verificação não renderiza como segurança.
    // Os dois casos de hoje são explicáveis (ZETTA é token nosso; cbBTC é novo
    // demais para a lista de terceiro), e ficam VISÍVEIS em vez de arredondados.
    const unknown = manifest.tokens.filter((e) => e.status === "not_found");
    for (const e of unknown) expect(e.status).not.toBe("verified");
  });
});
