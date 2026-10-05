/**
 * ⚠️⚠️ AS DUAS CORREÇÕES CRÍTICAS DA AUDITORIA DE 12/09, TRAVADAS NA FONTE.
 *
 * Nenhuma das duas mora num módulo puro: uma é uma linha de rota, a outra é uma
 * leitura dentro do cron. Ambas foram defeitos MUDOS — nada quebrava, e o
 * número (ou a ausência dele) chegava à tela do cliente como se fosse verdade.
 * Por isso a trava olha a FONTE: é o único lugar onde elas são observáveis sem
 * banco e sem rede.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { taxaDaBancadaPct } from "@/lib/bancada/vocabulario";
import { TAXA_POR_PERNA } from "@/lib/celeiro/taxas";

/**
 * ⚠️ A TRAVA OLHA CÓDIGO, NÃO PROSA — e este arquivo já tropeçou nisso.
 *
 * As primeiras asserções procuravam `VELAS_POR_MESA * 3_600_000` no arquivo
 * inteiro e falhavam por causa das NOTAS que explicam o defeito antigo. Uma
 * trava que proíbe descrever o erro corrigido proíbe documentar — e esta base
 * vive das notas. Então os comentários saem antes da comparação.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const ROTA  = semComentarios(readFileSync("src/app/api/bancada/backtest/route.ts", "utf8"));
const TIQUE = semComentarios(readFileSync("src/lib/bancada/tique.ts", "utf8"));

describe("① a taxa do backtest de mesa sai da tabela da casa", () => {
  /**
   * O ternário antigo colapsava a praça em "dex ou não-dex" ANTES de olhar o
   * papel, e o 0,015 (maker de FUTUROS) caía em cima de qualquer maker não-DEX.
   */
  it("⚠️ a tabela inline não voltou", () => {
    expect(ROTA).not.toMatch(/praca === "dex" \? 0\.30 : .*papel === "maker" \? 0\.015/);
    expect(ROTA).toMatch(/const custo = 2 \* taxaDaBancadaPct\(estrategia\.praca, estrategia\.papel\)/);
  });

  it("⚠️⚠️ e a tabela canônica diz o que o ternário negava", () => {
    // Era exatamente aqui que ele errava: spot maker NÃO é 0,015.
    expect(taxaDaBancadaPct("spot_gate", "maker")).toBe(0.20);
    expect(taxaDaBancadaPct("spot_gate", "maker")).not.toBe(0.015);
    expect(taxaDaBancadaPct("futuros_gate", "maker")).toBe(0.015);
    expect(taxaDaBancadaPct("futuros_gate", "taker")).toBe(0.05);
    expect(taxaDaBancadaPct("dex", "taker")).toBe(0.30);
    // A função é a tabela, não uma cópia dela.
    expect(taxaDaBancadaPct("spot_gate", "taker")).toBe(TAXA_POR_PERNA.spot_gate.taker);
  });

  it("o erro era de 13× num sentido e 4× no outro — a conta que justifica a gravidade", () => {
    const antigo = (praca: string, papel: string) =>
      2 * (praca === "dex" ? 0.30 : papel === "maker" ? 0.015 : 0.20);
    const real = (p: "spot_gate" | "futuros_gate" | "dex", x: "maker" | "taker") =>
      2 * taxaDaBancadaPct(p, x);

    expect(real("spot_gate", "maker") / antigo("spot_gate", "maker")).toBeCloseTo(13.33, 1);
    expect(antigo("futuros_gate", "taker") / real("futuros_gate", "taker")).toBeCloseTo(4, 1);
    // E onde ele acertava, continua acertando — a correção não moveu o que estava certo.
    expect(antigo("dex", "taker")).toBe(real("dex", "taker"));
    expect(antigo("spot_gate", "taker")).toBe(real("spot_gate", "taker"));
  });

  it("⚠️ a praça segue vindo do CLIENTE — a correção não podia matar o recurso", () => {
    // "a mesma regra paga na DEX como na CEX?" é a pergunta que a mesa existe
    // para responder. Trocar por custoIdaEVoltaDaMesa(venue) consertaria a taxa
    // e removeria isso.
    expect(ROTA).toMatch(/const pracaEscolhida = o\.praca === "spot_gate"/);
    expect(ROTA).not.toMatch(/custoIdaEVoltaDaMesa/);
  });
});

describe("② a janela do tique segue o INTERVALO, não o relógio", () => {
  /**
   * `VELAS_POR_MESA * 3_600_000` eram 420 HORAS fixas. Em "1d" — o padrão da
   * tela — isso são 17 velas, e uma média de 20 dias nunca nasce: a mesa tica
   * para sempre e nunca abre, dizendo "sem setup".
   */
  it("⚠️ a janela em horas fixas não voltou", () => {
    expect(TIQUE).not.toMatch(/VELAS_POR_MESA \* 3_600_000/);
    expect(TIQUE).toMatch(/VELAS_POR_MESA \* durDoIntervalo/);
    expect(TIQUE).toMatch(/duracaoDoIntervaloMs\(mesa\.intervalo\) \?\? 3_600_000/);
  });

  it("⚠️⚠️ e o padrão da tela passa a caber: 420 velas em vez de 17", () => {
    const VELAS = 420;
    const DIA = 86_400_000, HORA = 3_600_000;
    const antes = (VELAS * HORA) / DIA;      // velas diárias na janela antiga
    const depois = (VELAS * DIA) / DIA;
    expect(Math.floor(antes)).toBe(17);      // o que chegava
    expect(depois).toBe(420);                // o que chega agora
    // O vocabulário aceita período até 400: 17 velas não sustentam nem 20.
    expect(antes).toBeLessThan(20);
    expect(depois).toBeGreaterThan(400);
  });
});

describe("③ o teto do tique conta TRABALHO, e a guarda anda dentro do laço", () => {
  /**
   * ⚠️ ESTA ASSERÇÃO JÁ NASCEU LITERAL E QUEBROU EM UM DIA. Ela transcrevia
   * `processadas += Math.max(1, mesa.simbolos.length)` e caiu quando o teto
   * passou a PESAR o trabalho por espécie (13/09) — uma mudança correta. Agora
   * ela exige a INTENÇÃO: o contador não conta mesas, e não conta símbolos
   * crus; ele soma um custo calculado.
   */
  /**
   * ⚠️ CE-09 (05/10): a INTENÇÃO desta guarda continua — o teto não conta
   * mesas —, mas o mecanismo mudou e a asserção literal mudou com ele. O
   * orçamento agora é das LEITURAS que de fato custam (séries distintas,
   * compartilhadas entre mesas) e do TEMPO que sobra no cron. Contar mesas ou
   * "símbolos × peso" cobrava dez vezes a mesma leitura de BTC 1h.
   */
  it("⚠️ o teto não conta mesas — conta as leituras reais e o tempo", () => {
    expect(TIQUE).not.toMatch(/processadas\+\+/);
    expect(TIQUE).toMatch(/if \(semTempo\(\) \|\| leitor\.leituras >= leiturasMax\)/);
    expect(TIQUE).toMatch(/this\.leituras\+\+/);
  });

  it("⚠️⚠️ a guarda de uma-posição-por-mesa é reavaliada a cada símbolo", () => {
    // Era calculada uma vez antes do laço: cinco símbolos sinalizando abriam
    // cinco posições do mesmo movimento, inflando a amostra do cliente.
    expect(TIQUE).toMatch(/let temAberta = mesa\.temPosicaoAberta/);
    expect(TIQUE).toMatch(/temPosicaoAberta: temAberta/);
    // ⚠️ RM-02 (audit remediation): a abertura agora pode voltar `criada: false`
    // (o banco já tinha a mesma oportunidade) ou uma recusa do banco — nos dois
    // casos a mesa NÃO abre outro símbolo nesta vela. Só o ERRO deixa a guarda
    // aberta. A intenção é a mesma; o comportamento é provado contra Postgres
    // real em bench/integracao/papel-concorrencia.integration.ts.
    expect(TIQUE).toMatch(/if \(r\.criada\) resumo\.abertas\+\+; else resumo\.jaRegistradas\+\+;\s*temAberta = true;/);
    const ramoDeErro = TIQUE.slice(TIQUE.indexOf('} else if (r.motivo === "erro") {'), TIQUE.indexOf("} else {", TIQUE.indexOf('} else if (r.motivo === "erro") {')));
    expect(ramoDeErro).toMatch(/resumo\.problemas\.push/);
    expect(ramoDeErro).not.toMatch(/temAberta = true/);
  });

  it("⚠️ fechar UMA posição tira o símbolo, não a mesa inteira", () => {
    expect(TIQUE).toMatch(/abertasPorEstrategia\.get\(p\.estrategiaId\)\?\.delete\(p\.simbolo\)/);
    expect(TIQUE).not.toMatch(/abertasPorEstrategia\.delete\(p\.estrategiaId\)/);
  });

  it("⚠️ o acumulador do tique tem protótipo nulo — a chave vem do cliente", () => {
    expect(TIQUE).toMatch(/const visto: Record<string, VistoNoSimbolo> = Object\.create\(null\)/);
  });
});

/**
 * ⚠️⚠️ O CORTE PELO TETO GLOBAL SAI CARIMBADO (13/09).
 *
 * Quem `aVezDeQuem` adiava era carimbado; quem o TETO cortava sumia calado. A
 * diferença chega ao cliente como `atrasado` — que a tela traduz como "o
 * problema é nosso, e nós também estamos vendo", ou seja, um incidente
 * desconhecido no lugar de um teto conhecido. E `resumo.adiadas`, o número
 * pelo qual a casa descobriria que o teto está apertado, ficava cego
 * justamente para o teto que morde primeiro.
 */
describe("④ o teto do tique gira, pesa e carimba", () => {
  /**
   * ⚠️ CE-09 (05/10): a rotação por DONOS (12 por tique, dentro das 200 mesas
   * mais antigas) virou uma fila por MESA, sobre a lista INTEIRA, com cursor
   * persistido. Medido no teste de carga: com 3.250 desks, 3.050 nunca eram
   * vistos. As intenções destas guardas seguem exigidas:
   *   · gira — começa onde a passagem anterior parou, e dá a volta;
   *   · ninguém monopoliza — cada dono entra só com as mesas que o PLANO cobre,
   *     contadas sobre TODAS as mesas dele;
   *   · nada sai do teto sem carimbo.
   */
  it("⚠️ a fila gira entre TODAS as mesas, com cursor persistido", () => {
    // ⚠️ RM-06: a leitura do cursor distingue "sem cursor" de "erro" — os dois recomeçam do início.
    expect(TIQUE).toMatch(/const lido = await lerCursor\(db\)/);
    expect(TIQUE).toMatch(/const cursor = lido\.ok \? lido\.valor : null/);
    expect(TIQUE).toMatch(/fila\.findIndex\(\(id\) => id > cursor\)/);
    expect(TIQUE).toMatch(/fila\[\(inicio \+ k\) % fila\.length\]/);
    expect(TIQUE).toMatch(/await gravarCursor\(db, ultimoAvaliado, agoraMs\)/);
    // O processamento percorre a FILA — não o Map de donos, que era o corte.
    expect(TIQUE).toMatch(/for \(let k = 0; k < fila\.length; k\+\+\)/);
  });

  it("⚠️ nenhum dono passa do que o plano cobre — o teto olha todas as mesas dele", () => {
    expect(TIQUE).toMatch(/const \{ tickam, cortadas \} = mesasQuePodemTickar\(comoMesa, tier\)/);
    expect(TIQUE).toMatch(/resumo\.cortadasPorPlano \+= cortadas\.length/);
  });

  it("⚠️⚠️ nada sai do teto sem carimbo, e o resumo conta", () => {
    expect(TIQUE).toMatch(/cortadasPeloTeto\.push/);
    expect(TIQUE).toMatch(/resumo\.adiadas \+= cortadasPeloTeto\.length/);
    expect(TIQUE).toMatch(/marcarTiqueAdiado\(db, \[\.\.\.new Set\(cortadasPeloTeto\)\], agoraMs\)/);
  });

  it("⚠️ a mesma série é lida UMA vez por tique e serve a todas as mesas", () => {
    expect(TIQUE).toMatch(/const chave = `\$\{simbolo\}\|\$\{intervalo\}\|\$\{desde\}`/);
    expect(TIQUE).toMatch(/preparos\.get\(simbolo\)/);
  });
});
