import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AGENTES, agentePor, ehRegua } from "@/lib/celeiro/agentes";
import { fracaoDoPedagio, taxaPorPerna } from "@/lib/celeiro/taxas";
import { sementeDe, sementeAbreAlgumaVez } from "@/lib/celeiro/sementes";
import { MULTIPLO_DO_PEDAGIO } from "@/lib/celeiro/regime";

/**
 * ⚠️⚠️ O MAKER VOLTA COMO TESTE PRÉ-REGISTRADO (31/08).
 *
 * Ele foi aposentado em 23/08 por líquido negativo. A autópsia daquele dia
 * mediu outra coisa:
 *
 *     19 alvos contra 8 stops num bracket SIMÉTRICO de ±0,6%
 *     70,4% de alvo-primeiro · binomial n=27, p≈0,026
 *     preço +2,88 · taxa −3,49 · líquido −0,62
 *
 * Ele não morreu de errar — morreu de PEDÁGIO. Acertava 7 em 10 e entregava
 * 121% do ganho de preço para a corretora.
 *
 * ⚠️ O CRITÉRIO FOI ESCRITO ANTES DOS DADOS, em 23/08, e está no `aposentaQuando`
 * dele: alvo-primeiro acima de 50% em OUTRAS 30 decisões. Se cair para 50% no
 * bracket largo, a hipótese morre e o +6,31% de agosto era o mercado.
 */

/**
 * ⚠️ A VARREDURA IGNORA COMENTÁRIO — e esta foi a TERCEIRA vez, na mesma sessão,
 * que uma trava minha acusou a própria prosa que explica o conserto.
 *
 * Já aconteceu com `mode: "quote"` no ProDepth e com a linha do reset no
 * ProTerminal. A lição não é "escrever regex melhor": é que **varredura de
 * texto sobre código precisa remover a prosa antes de olhar**, sempre, e isso
 * devia ser a primeira linha de todo arquivo que faz isso neste repositório.
 */
const semComentario = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CRON = semComentario(readFileSync("src/app/api/celeiro/cron/route.ts", "utf8"));
const maker = agentePor("maker_de_faixa");

describe("o agente existe de novo, e com o papel certo", () => {
  it("⚠️ está no registro", () => {
    expect(maker).toBeTruthy();
    expect(maker!.categoria).toBe("estrutura");
  });

  it("⚠️⚠️ é MAKER, não taker — foi morto por uma taxa que não era a dele", () => {
    // A cicatriz que fez `taxas.ts` separar as tabelas por praça E por papel:
    // ele foi aposentado por líquido negativo com spot-TAKER cobrado, enquanto
    // o nome dele anuncia que ele POSTA.
    expect(maker!.execucao).toBe("maker");
    expect(maker!.modalidade).toBe("spot_gate");
  });

  it("⚠️ NÃO alavanca e a fatia é pequena — o teste é sobre acerto, não tamanho", () => {
    // Amplificar antes de saber se a borda existe é o erro que custou 26% da
    // banca do Alavancado.
    expect(maker!.alavancagemMaxima).toBe(1);
    expect(maker!.fracaoPorPosicao).toBeLessThanOrEqual(0.1);
  });

  it("não é régua, então pode ser investigado", () => {
    expect(ehRegua(maker!)).toBe(false);
  });

  it("⚠️ o mecanismo dele é único no registro — nenhum outro opera FAIXA", () => {
    // A regra que impediu as 24 mesas gêmeas da arena antiga.
    const iguais = AGENTES.filter((a) => a.mecanismo === maker!.mecanismo);
    expect(iguais).toHaveLength(1);
  });

  it("⚠️⚠️ o critério de aposentadoria carrega o número escrito em 23/08", () => {
    expect(maker!.aposentaQuando).toMatch(/50%/);
    expect(maker!.aposentaQuando).toMatch(/30 decis/);
  });
});

describe("⚠️⚠️ o bracket largo — a única variável que o teste muda", () => {
  const taxa = () => taxaPorPerna("spot_gate", "maker");

  it("o número real de agosto: ±0,6% entregava DOIS TERÇOS para a corretora", () => {
    const f = fracaoDoPedagio(taxa(), 0.6);
    expect(f).toBeCloseTo(0.667, 2);
  });

  /**
   * ⚠️⚠️ ESTES TRÊS TESTES ERAM VARREDURA DE TEXTO SOBRE A ROTA, E ERRARAM
   * EXATAMENTE COMO SE ESPERA (31/08).
   *
   * Eles afirmavam `CRON.toMatch(/alvoPct: 1.5, stopPct: 1.5/)` — a semente
   * TRANSCRITA, não a semente USADA. Passaram verdes sobre um agente que não
   * podia abrir posição nenhuma, porque a única coisa que verificavam é que o
   * literal estava escrito ali. Foi a quarta vez no mesmo dia que uma trava
   * minha leu texto em vez de valor.
   *
   * Agora eles perguntam a `sementeDe`, que é a fonte que o cron consulta. Um
   * alvo impossível reprova; um alvo movido de arquivo, não.
   */
  it("⚠️ a ±1,5% o pedágio vira 27% — abaixo do limiar de atenção, e AINDA ASSIM insuficiente", () => {
    const f = fracaoDoPedagio(taxa(), 1.5);
    expect(f).toBeCloseTo(0.267, 2);
    expect(f!).toBeLessThan(1 / 3);
    // ⚠️ E É ISSO QUE NÃO BASTA. "Abaixo de um terço" é o conforto do custo da
    // ideia; o portão do Celeiro exige 1/6. Confundir os dois foi o defeito.
    expect(f!).toBeGreaterThan(1 / MULTIPLO_DO_PEDAGIO);
    expect(sementeAbreAlgumaVez(maker!, { alvoPct: 1.5, stopPct: 1.5 }).abre).toBe(false);
  });

  it("a semente ATIVA é 2,5 simétrico — e ela abre", () => {
    const s = sementeDe("maker_de_faixa");
    expect(s.alvoPct).toBe(2.5);
    expect(s.stopPct).toBe(2.5);
    expect(sementeAbreAlgumaVez(maker!).abre).toBe(true);
  });

  it("⚠️ SIMÉTRICO de propósito — é o que torna a taxa comparável com agosto", () => {
    // Num passeio, alvo == stop dá 50% esperado, e foi contra esse 50% que o
    // binomial de agosto deu p≈0,026. Mexer na simetria junto com a largura
    // mediria duas mudanças de uma vez.
    const s = sementeDe("maker_de_faixa");
    expect(s.alvoPct).toBe(s.stopPct);
  });

  it("⚠️ e o horizonte sobe junto, senão a geometria derruba a taxa sozinha", () => {
    // Alvo mais distante no mesmo prazo daria mais saídas por TEMPO e menos por
    // alvo — a taxa cairia por geometria, não por sinal.
    expect(sementeDe("maker_de_faixa").horasLimite).toBe(24);
  });

  it("⚠️ o equilíbrio aritmético do bracket, conferível à mão", () => {
    // equilíbrio = 0,5 + custo_ida_e_volta / (2 × alvo)
    const custo = 2 * taxa();
    const eq = (alvo: number) => 0.5 + custo / (2 * alvo);
    expect(eq(0.6)).toBeCloseTo(0.833, 3);   // agosto: mediu 70,4% → perdeu
    expect(eq(2.5)).toBeCloseTo(0.580, 3);   // v3
    // O bracket largo baixa a barra que o sinal precisa vencer. Esse é o ponto.
    expect(eq(2.5)).toBeLessThan(eq(0.6));
  });
});

describe("⚠️ ele é o COMPLEMENTO dos agentes de tendência", () => {
  it("opera exatamente onde `permite` recusa por não haver lado", () => {
    expect(CRON).toMatch(/if \(regime\.estado !== "sem_sinal"\)/);
    expect(CRON).toMatch(/o Maker só opera FAIXA, e este par tem tendência/);
  });

  it("⚠️⚠️ e `sangrando` barra ele também — faixa não é queda desordenada", () => {
    // `sem_sinal` é a única porta: qualquer outro estado, inclusive sangrando,
    // cai no `continue` acima. O mandato dele diz "se o par sair da faixa
    // medida ele PARA de cotar".
    const bloco = CRON.slice(CRON.indexOf('id === "maker_de_faixa"'), CRON.indexOf("const perm = permite"));
    // A única porta é `sem_sinal`; qualquer outro estado cai no `continue`.
    expect(bloco).toMatch(/regime\.estado !== "sem_sinal"[\s\S]*continue;/);
    expect(bloco).not.toMatch(/estado === "sangrando"/);
  });

  it("⚠️ não escolhe lado — seria a opinião direcional que o `naoFaz` proíbe", () => {
    expect(maker!.naoFaz).toMatch(/não escolhe lado/);
    expect(CRON).toMatch(/o Maker cota dentro dela/);
  });

  it("opera e é varrido no tick", () => {
    expect(CRON).toMatch(/"comprador_cego", "maker_de_faixa",/);
    expect(CRON).toMatch(/"maker_de_faixa",\s*\] as const\) \{/);
  });
});
