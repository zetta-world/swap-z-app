/**
 * AUDITORIA EXTERNA (14/09, 2ª rodada) — A32: "portfólio apresenta preço
 * desconhecido como patrimônio zero".
 *
 * Fonte original recuperada da sessão local do auditor. O teste dele renderizava
 * o `PortfolioView` REAL com 100 USDC e preço `null` e via `$0.000` na linha.
 * Aqui o mesmo componente, com os seis estados que precisam ficar distintos:
 * preço válido, preço zero legítimo, `null`, `undefined`, saldo com erro do
 * fornecedor e token sem cobertura.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Linha = { sym: string; chain: string; qtd: number; usd: number | null | undefined; erro?: string };
const s = vi.hoisted(() => ({ linhas: [] as Linha[], gravados: [] as number[][] }));

vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: true }) }));
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => ({ connected: true }) }));
vi.mock("@/lib/hooks/useTokenPrices", () => ({ useTokenPrices: () => ({ prices: {} }), tokenPriceKey: () => "k" }));
vi.mock("@/lib/hooks/useTokenBalance", () => ({
  useTokenBalance: (t: { symbol: string; chain: string } | undefined) => {
    const l = s.linhas.find((x) => t && x.sym === t.symbol && x.chain === t.chain);
    if (!l) return { raw: 0n, formatted: "0", decimals: 6, symbol: t?.symbol, loading: false, error: null, isZero: true, display: "—", usdValue: null };
    if (l.erro) return { raw: 0n, formatted: "0", decimals: 6, symbol: l.sym, loading: false, error: l.erro, isZero: true, display: "—", usdValue: null };
    return { raw: 1n, formatted: String(l.qtd), decimals: 6, symbol: l.sym, loading: false, error: null, isZero: false, display: String(l.qtd), usdValue: l.usd };
  },
}));
vi.mock("@/lib/store/portfolioHistory", () => ({
  usePortfolioHistory: () => (...a: number[]) => { s.gravados.push(a); },
}));
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string, v?: Record<string, unknown>) => (v ? `${key}${JSON.stringify(v)}` : key) }));
vi.mock("@/components/portfolio/CexPortfolioRollup", () => ({ default: () => null }));
vi.mock("@/components/portfolio/PortfolioEvolution", () => ({ default: () => null }));
// useEffect não roda no renderToStaticMarkup; o gravador do snapshot é exercitado chamando-o direto.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useEffect: (fn: () => void) => { fn(); } }));

import PortfolioView from "@/components/portfolio/PortfolioView";

// HTML com entidades desfeitas (o React escapa as aspas dos valores interpolados).
const render = () => renderToStaticMarkup(createElement(PortfolioView)).replace(/&quot;/g, '"').replace(/<!-- -->/g, "");
beforeEach(() => { s.linhas = []; s.gravados = []; });

describe("A32 · preço desconhecido não é patrimônio zero", () => {
  it("100 USDC (Solana) com preço null: a linha diz 'preço indisponível', NÃO $0", () => {
    s.linhas = [{ sym: "USDC", chain: "solana", qtd: 100, usd: null }];
    const html = render();
    expect(html).toMatch(/>100(\.0+)? USDC</);           // a quantidade continua visível
    expect(html).toContain("portfolio.priceUnavailable");
    // Nem a linha, nem o patrimônio, nem o saldo da carteira viram $0. (O saldo de
    // CEX continua $0: sem corretora conectada, ZERO é o valor conhecido.)
    expect(html).not.toMatch(/portfolio\.(netWorth|walletBalance)<\/div><div[^>]*>\$0/);
    expect(html).toMatch(/portfolio\.netWorth<\/div><div[^>]*>—</);
  });

  it("preço undefined é tratado igual a null", () => {
    s.linhas = [{ sym: "USDC", chain: "solana", qtd: 100, usd: undefined }];
    expect(render()).toContain("portfolio.priceUnavailable");
  });

  it("controle: preço válido mostra o valor e o total é completo", () => {
    s.linhas = [{ sym: "USDC", chain: "solana", qtd: 100, usd: 100 }];
    const html = render();
    expect(html).toContain("$100.00");
    expect(html).not.toContain("portfolio.priceUnavailable");
    expect(html).not.toContain("portfolio.partialTotal");
  });

  it("preço zero LEGÍTIMO (token que vale 0) é valor conhecido: mostra $0, não 'indisponível'", () => {
    s.linhas = [{ sym: "USDT", chain: "bsc", qtd: 5, usd: 0 }];
    const html = render();
    expect(html).not.toContain("portfolio.priceUnavailable");
    expect(html).not.toContain("portfolio.partialTotal");
  });

  it("⚠️ total misto: soma SÓ o que tem preço e declara que é parcial (sem fabricar patrimônio)", () => {
    s.linhas = [
      { sym: "ETH", chain: "ethereum", qtd: 1, usd: 2000 },
      { sym: "USDC", chain: "solana", qtd: 100, usd: null },
    ];
    const html = render();
    expect(html).toContain("$2,000.00");
    expect(html).not.toContain("$2,100.00");
    expect(html).toContain('portfolio.partialTotal{"n":1}');
  });

  it("saldo com erro do fornecedor: dado INDISPONÍVEL é declarado, não some calado", () => {
    s.linhas = [
      { sym: "ETH", chain: "ethereum", qtd: 1, usd: 2000 },
      { sym: "SOL", chain: "solana", qtd: 0, usd: null, erro: "rpc down" },
    ];
    expect(render()).toContain('portfolio.balancesUnavailable{"n":1}');
  });

  it("token sem cobertura de preço (nenhum preço em lugar nenhum) entra como sem preço", () => {
    s.linhas = [{ sym: "stETH", chain: "ethereum", qtd: 2, usd: null }];
    const html = render();
    expect(html).toMatch(/>2(\.0+)? stETH</);
    expect(html).toContain("portfolio.priceUnavailable");
  });

  it("⚠️ total incompleto NÃO vira snapshot do histórico; total completo vira", () => {
    s.linhas = [{ sym: "ETH", chain: "ethereum", qtd: 1, usd: 2000 }, { sym: "USDC", chain: "solana", qtd: 100, usd: null }];
    render();
    expect(s.gravados).toEqual([]);
    s.linhas = [{ sym: "ETH", chain: "ethereum", qtd: 1, usd: 2000 }];
    render();
    expect(s.gravados.length).toBeGreaterThan(0);
    expect(s.gravados.at(-1)![0]).toBe(2000);
  });
});
