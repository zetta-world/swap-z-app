/**
 * ⚠️⚠️ A HOME AFIRMAVA FATO SEM NADA POR TRÁS — achado A02 da auditoria externa.
 *
 * Dois chips, lado a lado, logo abaixo do card de troca:
 *
 *     <Chip label={t("swap.chipZionSafe")} tone="gold" />      // "ZION considera seguro"
 *     <Chip label={t("swap.chipRoutes", { n: 14 })} />         // "14 rotas avaliadas"
 *
 * E ao lado deles, no MESMO bloco, um comentário dizendo que o terceiro chip já
 * tinha sido consertado por exatamente esse motivo: *"Era 'Escudo MEV ativo', em
 * verde, sem nada por trás."* A peça certa, a cicatriz escrita, conferida num
 * chip e ignorada nos dois vizinhos — a família de defeito que esta auditoria
 * mais encontrou.
 *
 * ⚠️ "ZION considera seguro" é afirmação sobre um token que não existe. O chip
 * renderizava sempre, antes de o visitante escolher qualquer coisa. Não há
 * "isto". A verificação de segurança de token que EXISTE mora no `SwapCard`, é
 * por token e é medida.
 *
 * ⚠️ "14 rotas avaliadas" tinha o 14 escrito à mão no JSX — e o número nem era
 * alcançável. `/api/quote` em `mode=list` despacha TRÊS fontes, mutuamente
 * exclusivas pelo par de cadeias: 0x (mesma cadeia EVM), LiFi (SÓ entre
 * cadeias), Jupiter (mesma cadeia Solana). Para um par concreto, no máximo UMA
 * dispara.
 *
 * ⚠️ E o `StatPanel` contava 4, incluindo a CoW — que é a venue de ordem
 * limitada, não fonte de cotação. Uma lista literal que já tinha derivado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FONTES_DE_COTACAO, NOMES_DAS_FONTES } from "@/lib/swap/fontes";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ler = (p: string) => semComentarios(readFileSync(p, "utf8"));
const QUOTE  = ler("src/app/api/quote/route.ts");
const PAINEL = ler("src/components/dashboard/StatPanel.tsx");
const HOME   = ler("src/components/dashboard/SwapDashboard.tsx");
const I18N   = readFileSync("src/lib/i18n/messages.ts", "utf8");

describe("① a lista de fontes bate com o que o motor despacha", () => {
  it("⚠️ cada fonte declarada é REALMENTE buscada em /api/quote", () => {
    const buscadores: Record<string, RegExp> = {
      "0x":      /fetchZeroX|normalizeZeroX/,
      lifi:      /fetchLiFiQuote/,
      jupiter:   /fetchJupiterQuote/,
    };
    for (const f of FONTES_DE_COTACAO) {
      expect(buscadores[f.id], `sem buscador conhecido para "${f.id}"`).toBeDefined();
      expect(QUOTE, `a fonte "${f.id}" está na lista e o motor não a consulta`)
        .toMatch(buscadores[f.id]);
    }
  });

  it("⚠️⚠️ a CoW NÃO está na lista — ela é venue de ordem limitada", () => {
    // `/api/quote` não a consulta em caminho nenhum; `src/lib/limit/cow.ts` é
    // outro produto. Contá-la como agregador era o que fazia o painel dizer 4.
    expect(FONTES_DE_COTACAO.map((f) => f.id)).not.toContain("cow");
    expect(NOMES_DAS_FONTES).not.toMatch(/CoW/i);
    expect(QUOTE).not.toMatch(/\bcow\b/i);
  });

  it("são três, e cada uma com o alcance que o despacho aplica", () => {
    expect(FONTES_DE_COTACAO).toHaveLength(3);
    expect(NOMES_DAS_FONTES).toBe("0x · LiFi · Jupiter");
  });

  it("⚠️ nenhum id repetido — a brecha que uma quebra deliberada encontrou", () => {
    /**
     * A trava de "cada fonte é buscada" olha o id, então uma entrada NOVA com
     * um id que já existe passava por ela: `{ id: "0x", nome: "Fantasma" }`
     * seria contada na tela como quarta fonte e o motor nunca a consultaria.
     * Um id novo de verdade já é barrado pelo tipo `IdDaFonte`; o repetido não
     * era barrado por nada.
     */
    const ids = FONTES_DE_COTACAO.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const nomes = FONTES_DE_COTACAO.map((f) => f.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("② nenhum número da home é escrito à mão", () => {
  it("⚠️⚠️ o chip de fontes deriva de FONTES_DE_COTACAO, não de um literal", () => {
    expect(HOME).toMatch(/chipFontes", \{ n: FONTES_DE_COTACAO\.length \}/);
    // O gêmeo: nenhum `n:` com número solto sobrou nos chips.
    expect(HOME).not.toMatch(/\{ n: \d+ \}/);
  });

  it("⚠️ o StatPanel também — a lista literal com a CoW saiu", () => {
    expect(PAINEL).toMatch(/value: String\(FONTES_DE_COTACAO\.length\)/);
    expect(PAINEL).not.toMatch(/DEX_AGGREGATORS/);
    expect(PAINEL).not.toMatch(/\["0x", "LiFi"/);
  });

  it("os outros números do painel continuam derivados, como já eram", () => {
    // Estes nunca mentiram; a trava existe para que continuem assim.
    expect(PAINEL).toMatch(/CHAINS\.length/);
    expect(PAINEL).toMatch(/SUPPORTED_CEX_IDS\.length/);
  });
});

describe("③ a home não afirma segurança sem ter verificado nada", () => {
  it("⚠️⚠️ o selo 'ZION considera seguro' não é mais renderizado", () => {
    // Ele aparecia SEMPRE, antes de haver token escolhido. Não dava para ligar
    // numa verificação porque não havia o que verificar.
    expect(HOME).not.toMatch(/chipZionSafe/);
    expect(I18N).not.toMatch(/chipZionSafe/);
  });

  it("⚠️ e o chip do MEV, que já tinha sido consertado, continua avisando", () => {
    // O gêmeo positivo: remover tudo passaria neste bloco. O que sobra tem de
    // ser o chip que DIZ o que mede — exposição visível, não escudo ativo.
    expect(HOME).toMatch(/chipMevWarn/);
    expect(I18N).toMatch(/chipMevWarn/);
  });
});

describe("④ a chave nova existe nos QUATRO idiomas, com o {n}", () => {
  it("chipFontes em en/pt/es/zh, e nenhum resto de chipRoutes", () => {
    const ocorrencias = [...I18N.matchAll(/chipFontes:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ocorrencias).toHaveLength(4);
    for (const texto of ocorrencias) expect(texto).toContain("{n}");
    expect(I18N).not.toMatch(/chipRoutes/);
  });
});
