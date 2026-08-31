import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * ⚠️⚠️ O TERMINAL PRO DIZIA "● LIVE" SOBRE UM GRÁFICO CONGELADO (31/08).
 *
 * O dono abriu o /pro num gráfico de 1 minuto de BNB, ao lado do DEXTools, e
 * perguntou: *"como que coloco vela de um minuto num ativo como bnb e ele não
 * mexe?"*. Ele estava certo, e não era percepção — o efeito que busca as velas
 * dependia de `[chain, pool, tf, kind, ...]` e não tinha timer nenhum. Buscava
 * UMA vez na montagem. O selo verde pulsava ao lado o tempo todo.
 *
 * Nas mesmas telas havia outros três, e três deles são a mesma doença: a
 * interface afirmando o que ninguém mediu.
 */

const CHART = readFileSync("src/components/pro/ProChart.tsx", "utf8");
const TERM  = readFileSync("src/components/pro/ProTerminal.tsx", "utf8");
const GT    = readFileSync("src/lib/api/geckoterminal.ts", "utf8");
const SMART = readFileSync("src/components/pro/ProSmartMoney.tsx", "utf8");

describe("① o gráfico anda", () => {
  it("⚠️ existe um timer, e o passo sai do timeframe", () => {
    expect(CHART).toMatch(/const PASSO_MS: Record<Timeframe, number>/);
    expect(CHART).toMatch(/setInterval\(fetchData, PASSO_MS\[tf\]/);
  });

  it("⚠️ o passo do 1m é bem menor que o do 1d — senão gasta chamada à toa", () => {
    const passo = (tf: string) => Number(CHART.match(new RegExp(`"${tf}": (\\d[\\d_]*)`))![1].replace(/_/g, ""));
    expect(passo("1m")).toBeLessThan(passo("1d"));
    expect(passo("1m")).toBeLessThanOrEqual(15_000);   // uma fração da vela
  });

  it("⚠️⚠️ a atualização NÃO redesenha tudo — senão rouba o zoom a cada 10s", () => {
    // `setData` + `fitContent` de dez em dez segundos deixaria a tela "viva" e
    // inutilizável: o enquadramento do usuário sumiria a cada ciclo.
    expect(CHART).toMatch(/function updateLast/);
    expect(CHART).toMatch(/} else if \(ultima\) \{/);
    expect(CHART).toMatch(/updateLast\(priceSeriesRef\.current, kind, ultima\)/);
  });

  it("⚠️ `fitContent` só na primeira carga", () => {
    const dentroDoPrimeira = CHART.slice(CHART.indexOf("if (primeira)"), CHART.indexOf("} else if (ultima)"));
    expect(dentroDoPrimeira).toMatch(/fitContent\(\)/);
    // e não há um segundo fitContent no ramo de atualização
    const ramoAtualizacao = CHART.slice(CHART.indexOf("} else if (ultima)"), CHART.indexOf("primeira = false"));
    expect(ramoAtualizacao).not.toMatch(/fitContent/);
  });
});

describe("② o selo LIVE olha para o dado", () => {
  it("⚠️ não é mais texto fixo no JSX", () => {
    expect(TERM).not.toMatch(/pulse-dot" \/> LIVE/);
    expect(TERM).toMatch(/vivacidade\.rotulo/);
  });

  it("⚠️⚠️ tem três estados, e o terceiro é AUSÊNCIA", () => {
    // Pintar de verde quem nunca recebeu dado é a mentira que ele contava.
    // Pintar de vermelho seria acusar falha onde só há espera.
    expect(TERM).toMatch(/AGUARDANDO/);
    expect(TERM).toMatch(/AO VIVO/);
    expect(TERM).toMatch(/ATRASADO/);
    expect(TERM).toMatch(/chartAtualizadoEm === null/);
  });

  it("⚠️ o selo ENVELHECE sozinho — senão congela em AO VIVO quando a fonte cai", () => {
    // Sem relógio local, o estado só mudaria quando chegasse dado novo: ou
    // seja, nunca mudaria justamente no caso que ele existe para denunciar.
    expect(TERM).toMatch(/setInterval\(\(\) => setAgoraTick\(Date\.now\(\)\), 5_000\)/);
  });

  it("⚠️ trocar de par volta para AGUARDANDO", () => {
    // O carimbo do par anterior não fala do par novo.
    expect(TERM).toMatch(/setChartAtualizadoEm\(null\); \}, \[pair\.id, tf\]/);
  });

  it("a tolerância segue o timeframe, não é número fixo", () => {
    expect(TERM).toMatch(/const TOLERANCIA_MS: Record<Timeframe, number>/);
  });
});

describe("③ ⚠️⚠️ o preço da trade tem UMA unidade", () => {
  it("não vem mais da ponta FROM crua", () => {
    // Era `price_from_in_usd ?? price_to_in_usd` — a ponta que sai do swap, que
    // troca de token conforme a direção. No feed do WBNB/USDT saía, lado a lado:
    //     SELL  $6   0.9998   ← o USDT
    //     BUY   $34  687.59   ← o WBNB
    expect(GT).not.toMatch(/priceUsd:\s+Number\(a\.price_from_in_usd \?\? a\.price_to_in_usd \?\? 0\)/);
    expect(GT).toMatch(/const doBase = isBuy \? a\.price_to_in_usd : a\.price_from_in_usd/);
  });

  it("⚠️ a compra e a venda cotam o MESMO token", () => {
    expect(GT).toMatch(/const doQuote = isBuy \? a\.price_from_in_usd : a\.price_to_in_usd/);
    expect(GT).toMatch(/lado === "quote" \? doQuote : lado === "base" \? doBase/);
  });
});

describe("④ o medidor de MEV estava preso em HIGH por causa do ③", () => {
  it("⚠️⚠️ escala misturada desliga o alerta em vez de gritar", () => {
    // O desvio calculado sobre uma série que alterna 0,9998 e 687,59 é enorme
    // por construção — e a tela anunciava "sandwich risk elevated" num mercado
    // calmo. Consertada a fonte, esta guarda fica de cinto.
    expect(SMART).toMatch(/const escalaMisturada = prices\.length >= 2 && min > 0 && max \/ min > 10/);
    expect(SMART).toMatch(/if \(prices\.length >= 3 && !escalaMisturada\)/);
  });
});

describe("⑤ ⚠️⚠️ zero baleia deixa de virar 'equilíbrio 50/50'", () => {
  it("`bias` é nulo quando não houve baleia", () => {
    // A tela mostrava: 0 whales · NEUTRAL · "50% buy / 50% sell" · $0 / $0.
    // Uma barra pela metade e uma palavra de veredito, sobre nenhuma observação.
    expect(SMART).not.toMatch(/totalWhale > 0 \? buyVol \/ totalWhale : 0\.5/);
    expect(SMART).toMatch(/const bias: number \| null = totalWhale > 0 \? buyVol \/ totalWhale : null/);
  });

  it("⚠️ existe um veredito próprio para ausência", () => {
    expect(SMART).toMatch(/"SEM_BALEIA"/);
    expect(SMART).toMatch(/não é equilíbrio, é ausência/);
  });

  it("⚠️ e a barra fica VAZIA, não meio a meio", () => {
    expect(SMART).toMatch(/bias === null \? 0 : bias \* 100/);
  });
});

/**
 * ⚠️⚠️ A ÚLTIMA MILHA, e ela é a que este projeto mais erra.
 *
 * Consertar `getRecentTrades` não conserta a tela se ninguém passar o lado. Foi
 * assim que o A/B ficou com um braço só, que a I3 quase entrou desligada, e que
 * o filtro do controle olhou uma flag de duas: a peça certa, testada, e fora do
 * caminho que decide.
 */
describe("⑥ o lado atravessa a tela inteira", () => {
  const ROTA   = readFileSync("src/app/api/trades/route.ts", "utf8");
  const TRADES = readFileSync("src/components/pro/ProTrades.tsx", "utf8");

  it("⚠️ a rota lê `token` e repassa", () => {
    expect(ROTA).toMatch(/searchParams\.get\("token"\)/);
    expect(ROTA).toMatch(/getRecentTrades\(chain, poolAddr, 30, lado\)/);
  });

  it("⚠️ o painel manda o lado na query", () => {
    expect(TRADES).toMatch(/side \? `&token=\$\{side\}` : ""/);
  });

  it("⚠️ e o terminal passa o lado que o gráfico descobriu", () => {
    expect(TERM).toMatch(/<ProTrades chain=\{pair\.chain\} pool=\{pair\.pool\} side=\{chartSide\}/);
  });

  it("⚠️ o efeito refaz a busca quando o lado muda", () => {
    // Sem `side` nas deps, trocar de par manteria a cotação do par anterior.
    expect(TRADES).toMatch(/\}, \[chain, pool, side, onTrades\]\)/);
  });
});
