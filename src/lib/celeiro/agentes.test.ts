import { describe, it, expect } from "vitest";
import {
  AGENTES, FAIXAS, ROTULO_DA_FAIXA, oControle, agentesDaFaixa, agentePor,
  PRACA_VAZIA_PORQUE,
  tamanhoDaPosicao,
} from "@/lib/celeiro/agentes";
import { DESKS } from "@/lib/zion/desks";

/**
 * AS INVARIANTES DO CELEIRO — o que impede a segunda arena de virar a primeira.
 *
 * ⚠️ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR. A arena antiga chegou a 24
 * mesas rodando UMA estratégia com 24 fantasias: `runBacktestScanForProvider` é
 * uma função por 6 modelos, `selectPlaybook` é uma biblioteca por 5 políticas,
 * `arbiter2` é um motor por 3 alavancagens. O dono resumiu melhor que eu:
 * *"vc foi empilhando uma coisa em cima da outra e agora temos que separar o
 * joio do trigo"*.
 *
 * Empilhar é fácil e não dói na hora. Estes testes fazem doer na hora.
 */

describe("as invariantes do Celeiro", () => {
  /**
   * ⚠️ P1 — NENHUM AGENTE APOSTA EM DIREÇÃO.
   *
   * Medido em 19/08: seis modelos, 3.300 decisões, alpha de −6,7 a −30,4 pp
   * contra um passeio aleatório. Prever direção com LLM tem informação
   * NEGATIVA. Se um agente novo entrar com motor de IA decidindo lado, ele
   * nasce reprovado por 3.300 medições e este teste diz isso na cara.
   */
  it("nenhum agente usa IA para decidir direção", () => {
    /**
     * ⚠️ A REGRA MUDOU DE FORMA EM 22/08, e a razão importa. Antes o teste
     * exigia que os DOIS motores existissem — e quebrou quando o Maker de Faixa
     * (o único `bot_mais_ia`) foi aposentado. Exigir que uma opção seja USADA
     * confunde "esta opção é permitida" com "alguém precisa usá-la".
     *
     * O que importa é o contrário: nenhum motor fora dos dois, e todo agente com
     * IA declarando a fronteira. Hoje não há nenhum — e isso é um estado válido.
     */
    const motores = new Set(AGENTES.map((a) => a.motor));
    for (const m of motores) expect(["bot", "bot_mais_ia"]).toContain(m);

    for (const a of AGENTES.filter((x) => x.motor === "bot_mais_ia")) {
      expect(
        a.naoFaz.length,
        `${a.nome} usa IA e não declarou o que NÃO faz — sem essa fronteira `
          + "escrita ele escorrega para direcional na primeira manutenção",
      ).toBeGreaterThan(40);
    }
  });

  /**
   * ⚠️⚠️ O LADO VEM DO REGIME, NUNCA DE OPINIÃO — e é a correção de 22/08.
   *
   * A versão anterior deste registro dizia "nenhum agente aposta em direção", o
   * que era generalização errada da medição: o que se mediu foi LLM PREVENDO
   * direção. Agentes de tendência TOMAM lado, e isso é legítimo enquanto o lado
   * sair de estado medido.
   *
   * Este teste exige que todo agente da categoria `tendencia` diga, no `naoFaz`,
   * que não PREVÊ.
   */
  it("agente de tendência declara que não prevê", () => {
    const deTendencia = AGENTES.filter((a) => a.categoria === "tendencia");
    expect(deTendencia.length, "a categoria tendência existe e tem agentes").toBeGreaterThan(0);
    for (const a of deTendencia) {
      expect(a.naoFaz.toLowerCase(), `${a.nome} não declara que não prevê`).toContain("prevê");
    }
  });

  /**
   * ⚠️ SPOT NÃO VENDE, e o registro tem de dizer isso. Sem futuros não há como
   * lucrar na queda acumulando USDT: em spot, "vender na baixa" é apenas sair.
   */
  it("agente de tendência em spot declara que não vende", () => {
    const spot = AGENTES.filter((a) => a.categoria === "tendencia" && a.modalidade === "spot_gate");
    for (const a of spot) {
      expect(a.naoFaz.toLowerCase(), `${a.nome} é spot e não declara que não vende`).toContain("não vende");
    }
  });

  /**
   * ⚠️ P5 — DOIS AGENTES NÃO PODEM TER O MESMO MECANISMO.
   *
   * É a invariante central. Prompt diferente com mecanismo igual é o que
   * produziu as 24 mesas, e é o caminho mais curto para o painel gêmeo que o
   * dono proibiu: *"nada de fazer vários agentes que usa a mesma estratégia"*.
   */
  it("cada agente tem um mecanismo próprio", () => {
    const vistos = new Map<string, string>();
    const repetidos: string[] = [];
    for (const a of AGENTES) {
      // Assinatura grosseira do mecanismo: as palavras que carregam sentido.
      const chave = a.mecanismo.toLowerCase().replace(/[^a-zà-ú ]/g, "")
        .split(/\s+/).filter((p) => p.length > 4).sort().join(" ");
      const anterior = vistos.get(chave);
      if (anterior) repetidos.push(`${anterior} ↔ ${a.nome}`);
      else vistos.set(chave, a.nome);
    }
    expect(repetidos, "mecanismo repetido — é assim que nascem 24 mesas iguais").toEqual([]);

    const ids = AGENTES.map((a) => a.id);
    expect(new Set(ids).size, "id repetido no registro").toBe(ids.length);
  });

  /**
   * ⚠️ AS DUAS ARENAS NÃO SE CRUZAM. Um id repetido entre `AGENTES` e `DESKS`
   * faria as duas escreverem no mesmo lugar em algum join distraído, e o
   * Celeiro herdaria o histórico que ele existe para não herdar.
   */
  it("nenhum id do Celeiro colide com uma mesa antiga", () => {
    const antigas = new Set(DESKS.map((d) => d.source));
    const colisao = AGENTES.filter((a) => antigas.has(a.id)).map((a) => a.id);
    expect(colisao, "id do Celeiro colide com `source` da arena antiga").toEqual([]);
  });

  /**
   * ⚠️ O NOME DIZ O QUE FAZ (§3). Nome mitológico obrigou um registro de 659
   * linhas só para lembrar quem era quem, e tornaria as duas arenas
   * indistinguíveis numa lista — que é exatamente o que o dono pediu para
   * evitar: *"identifica no painel de uma forma que não confunda"*.
   */
  it("nenhum agente tem nome mitológico", () => {
    const nordicos = DESKS.map((d) => d.name.toUpperCase());
    const suspeitos = AGENTES.filter((a) => nordicos.includes(a.nome.toUpperCase()));
    expect(suspeitos.map((a) => a.nome), "nome vindo da arena antiga").toEqual([]);
    for (const a of AGENTES) {
      expect(
        /[a-zà-ú]/.test(a.nome),
        `"${a.nome}" parece sigla/mitologia — o nome tem de DIZER o que o agente faz`,
      ).toBe(true);
    }
  });

  /**
   * ⚠️ EXATAMENTE UM CONTROLE. Sem piso, retorno é medido contra nada — foi
   * assim que "+7,04% com amostra pequena" virou notícia boa. `oControle()`
   * lança se houver zero ou dois; aqui o teste garante que o registro nasce
   * consistente e que o controle não tem risco de mercado.
   */
  it("existe exatamente um controle, e ele não toca em mercado", () => {
    const c = oControle();
    expect(c.id).toBe("aluguel_ocioso");
    expect(c.receitaVemDe).toEqual(["aluguel"]);
    expect(
      c.aposentaQuando,
      "o controle não pode ter regra de aposentadoria por desempenho",
    ).toContain("nunca");
  });

  /**
   * ⚠️ TODO AGENTE DECLARA CAPITAL MÍNIMO E CABE NUMA FAIXA (P6). A medição de
   * profundidade (topo +0,451% → livro andado −0,629%, 17 sobreviventes em
   * 4.085) prova que o MESMO agente rende diferente em tamanhos diferentes.
   * Comparar $50 com $5.000 na mesma tabela compara coisas distintas.
   */
  it("todo agente declara faixa e capital mínimo coerentes", () => {
    for (const a of AGENTES) {
      expect(FAIXAS, `${a.nome} está numa faixa que o painel não desenha`).toContain(a.faixa);
      expect(a.capitalMinimoUsd, `${a.nome} com capital mínimo negativo`).toBeGreaterThanOrEqual(0);
      expect(a.receitaVemDe.length, `${a.nome} não diz de onde vem o USDT`).toBeGreaterThan(0);
      expect(a.aposentaQuando.length, `${a.nome} sem regra de aposentadoria`).toBeGreaterThan(20);
    }
    // O controle é o único que pode operar sem capital mínimo.
    const semMinimo = AGENTES.filter((a) => a.capitalMinimoUsd === 0);
    expect(semMinimo.map((a) => a.id)).toEqual(["aluguel_ocioso"]);
  });

  /** Cada faixa desenhada pelo painel tem rótulo e pelo menos um agente. */
  it("nenhuma faixa do painel fica vazia", () => {
    for (const f of FAIXAS) {
      expect(ROTULO_DA_FAIXA[f], `faixa ${f} sem rótulo`).toBeTruthy();
      expect(agentesDaFaixa(f).length, `faixa ${f} sem nenhum agente`).toBeGreaterThan(0);
    }
  });

  /**
   * O mandato pediu spot, margem, futuros e DEX.
   *
   * ⚠️⚠️ AFROUXADO EM 25/08, E O AFROUXAMENTO TEM PREÇO. Antes exigia agente em
   * toda praça. Agora aceita praça vazia SE houver motivo escrito em
   * `PRACA_VAZIA_PORQUE` — com data e com o número que justifica.
   *
   * Por que não deixei cair: uma praça que esvazia por DECISÃO e uma que
   * esvazia porque alguém apagou um agente sem querer são indistinguíveis
   * depois de uma semana. A frase obrigatória é o que as separa.
   *
   * ⚠️ Por que não deixei como estava: o Caçador e o Comprador Cego saíram do
   * spot porque lá eles NÃO ABREM MAIS NADA — a 0,20%/perna, um alvo de 2% não
   * limpa o pedágio. Manter a exigência obrigaria a fingir um agente de spot
   * que não opera, que é pior que praça vazia declarada.
   */
  it("as quatro modalidades do mandato estão cobertas, ou o vazio tem motivo", () => {
    const m = new Set(AGENTES.map((a) => a.modalidade));
    for (const exigida of ["spot_gate", "margem_gate", "futuros_gate", "dex"] as const) {
      if (m.has(exigida)) continue;
      const porque = PRACA_VAZIA_PORQUE[exigida];
      expect(porque, `o mandato pediu ${exigida}, nenhum agente opera lá, e não há motivo escrito`)
        .toBeTruthy();
      expect(porque!.length, `o motivo de ${exigida} estar vazia é curto demais para explicar`)
        .toBeGreaterThan(80);
    }
    const r = new Set(AGENTES.map((a) => a.ritmo));
    expect(r.has("day"), "o mandato pediu day trader").toBe(true);
    expect(r.has("swing"), "o mandato pediu swing trader").toBe(true);
  });

  it("agentePor devolve o registro, e null para quem não existe", () => {
    expect(agentePor("colheita_funding")?.nome).toBe("Colheita de Funding");
    expect(agentePor("nao_existe")).toBeNull();
  });
});

describe("o tamanho da posição e o teto de exposição", () => {
  const base = AGENTES.find((a) => a.id === "cacador_de_tendencia")!;

  /**
   * ⚠️⚠️ ISTO SUBSTITUI O `Math.max(capitalMinimoUsd, 50)` DO CRON, e o erro
   * que ele escondia: `capitalMinimoUsd` é "quanto preciso para o livro
   * aguentar", NÃO "quanto aposto". Usar um pelo outro fez a Convergência de
   * Base apostar $150 por posição sem ninguém ter decidido isso.
   */
  it("o tamanho sai da FRAÇÃO da banca, não do capital mínimo", () => {
    const t = tamanhoDaPosicao(base, 0, base.bancaInicialUsd);
    expect(t.usd).toBeCloseTo(base.bancaInicialUsd * base.fracaoPorPosicao, 6);
    expect(t.usd).not.toBeCloseTo(base.capitalMinimoUsd, 6);
    expect(t.cabe).toBe(true);
  });

  /**
   * ⚠️ O TETO DE EXPOSIÇÃO É O "SEM SUICÍDIO" DO MANDATO. Com 25% por posição e
   * teto de 75%, a QUARTA posição não cabe — e a recusa é explícita, com o
   * motivo indo para o extrato em vez de virar risco silencioso.
   */
  it("recusa a posição que estouraria o teto de exposição", () => {
    const cada = base.bancaInicialUsd * base.fracaoPorPosicao;

    expect(tamanhoDaPosicao(base, cada * 2, base.bancaInicialUsd).cabe).toBe(true);    // 3ª cabe
    const quarta = tamanhoDaPosicao(base, cada * 3, base.bancaInicialUsd);             // 4ª não
    expect(quarta.cabe).toBe(false);
    expect(quarta.porque).toContain("teto");
    expect(quarta.exposicaoDepois).toBeGreaterThan(base.tetoDeExposicao);
  });

  /**
   * ⚠️⚠️ MARGEM E NOCIONAL SÃO COISAS DIFERENTES (23/08).
   *
   * O teto governa a MARGEM — o capital da banca comprometido. O nocional é o
   * que o preço e a taxa mordem, e ele pode passar da banca: é isso que
   * alavancar significa. Enquanto o teto media nocional, o Alavancado de
   * Tendência ficava preso abaixo de 0,6× da própria banca com uma alavanca
   * declarada de 10×, e o A/B contra o Caçador comparava $200 sem alavanca
   * contra $250 sem alavanca.
   */
  it("sem alavanca, margem e nocional são o mesmo número", () => {
    const t = tamanhoDaPosicao(base, 0, base.bancaInicialUsd, 1);
    expect(t.margemUsd).toBeCloseTo(t.usd, 9);
    expect(t.alavanca).toBe(1);
  });

  it("com alavanca, o nocional multiplica e a margem não", () => {
    const t = tamanhoDaPosicao(base, 0, base.bancaInicialUsd, 10);
    expect(t.margemUsd).toBeCloseTo(base.bancaInicialUsd * base.fracaoPorPosicao, 9);
    expect(t.usd).toBeCloseTo(t.margemUsd * 10, 9);
    expect(t.porque).toContain("nocional");
  });

  /**
   * ⚠️ O TESTE QUE SEPARA O CONSERTO DA REGRESSÃO. O nocional aqui é MÚLTIPLO
   * da banca inteira — e a posição cabe, porque o que o teto mede é a margem.
   * Se alguém voltar o teto para o nocional, este teste cai.
   */
  it("o teto mede MARGEM, então o nocional pode passar da banca", () => {
    const t = tamanhoDaPosicao(base, 0, base.bancaInicialUsd, 10);
    expect(t.usd).toBeGreaterThan(base.bancaInicialUsd);
    expect(t.cabe).toBe(true);
    expect(t.exposicaoDepois).toBeCloseTo(base.fracaoPorPosicao, 9);
  });

  it("e o teto continua barrando pela margem, alavancado ou não", () => {
    const cada = base.bancaInicialUsd * base.fracaoPorPosicao;
    const quarta = tamanhoDaPosicao(base, cada * 3, base.bancaInicialUsd, 10);
    expect(quarta.cabe).toBe(false);
    expect(quarta.porque).toContain("teto");
  });

  /**
   * ⚠️⚠️ O TAMANHO SEGUE O SALDO, NÃO A BANCA INICIAL (24/08).
   *
   * Até aqui `bancaUsd: 1000` era um literal que o prejuízo nunca tocava: o
   * Alavancado queimou $53,17 e seguia apostando como se tivesse $1.000. Sem
   * ruína, sem composição, e o mínimo declarado comparava contra um número
   * imóvel — logo nunca disparava.
   */
  it("perder encolhe a próxima aposta, ganhar aumenta — isto é composição", () => {
    const cheio = tamanhoDaPosicao(base, 0, base.bancaInicialUsd);
    const depoisDePerder = tamanhoDaPosicao(base, 0, base.bancaInicialUsd * 0.5);
    const depoisDeGanhar = tamanhoDaPosicao(base, 0, base.bancaInicialUsd * 2);

    expect(depoisDePerder.margemUsd).toBeLessThan(cheio.margemUsd);
    expect(depoisDeGanhar.margemUsd).toBeGreaterThan(cheio.margemUsd);
    expect(depoisDePerder.margemUsd).toBeCloseTo(cheio.margemUsd / 2, 9);
  });

  /**
   * ⚠️ A RUÍNA EXISTE E ELA PARA O AGENTE. Operar menor esconderia a morte
   * dentro de apostas cada vez menores, e o extrato mostraria um agente vivo
   * sangrando devagar em vez de um agente morto.
   */
  it("saldo zerado ou negativo QUEBRA o agente em vez de encolhê-lo", () => {
    for (const saldo of [0, -50]) {
      const t = tamanhoDaPosicao(base, 0, saldo);
      expect(t.cabe).toBe(false);
      expect(t.usd).toBe(0);
      expect(t.porque).toContain("quebrou");
    }
  });

  it("saldo abaixo do mínimo declarado PARA — e agora pode acontecer", () => {
    const t = tamanhoDaPosicao(base, 0, base.capitalMinimoUsd - 1);
    expect(t.cabe).toBe(false);
    expect(t.porque).toContain("mínimo");
  });

  /**
   * ⚠️ E A EXPOSIÇÃO É FRAÇÃO DO SALDO, não da banca inicial. Com o
   * denominador velho, um agente que perdeu metade apareceria com metade da
   * exposição que realmente tem — e o teto deixaria passar o dobro do risco.
   */
  it("a exposição é medida contra o SALDO, não contra a banca inicial", () => {
    const metade = base.bancaInicialUsd * 0.5;
    const t = tamanhoDaPosicao(base, metade * base.fracaoPorPosicao, metade);
    expect(t.exposicaoDepois).toBeCloseTo(base.fracaoPorPosicao * 2, 9);
  });

  /**
   * ⚠️ E O CAPITAL MÍNIMO VOLTA AO PAPEL DELE: barrar o agente cuja BANCA não
   * dá para o livro aguentar — não dimensionar aposta.
   */
  it("banca abaixo do mínimo declarado reprova", () => {
    const magro = { ...base, bancaInicialUsd: base.capitalMinimoUsd - 1 };
    const t = tamanhoDaPosicao(magro, 0, magro.bancaInicialUsd);
    expect(t.cabe).toBe(false);
    expect(t.porque).toContain("abaixo do mínimo");
  });

  /** Todo agente que opera declara banca, fração e teto coerentes. */
  it("os campos de banca são coerentes em todo o registro", () => {
    for (const a of AGENTES) {
      expect(a.bancaInicialUsd, `${a.nome}`).toBeGreaterThan(0);
      expect(a.fracaoPorPosicao, `${a.nome}`).toBeGreaterThan(0);
      expect(a.fracaoPorPosicao, `${a.nome}: fração maior que a banca`).toBeLessThanOrEqual(1);
      expect(a.tetoDeExposicao, `${a.nome}: teto menor que uma posição`)
        .toBeGreaterThanOrEqual(a.fracaoPorPosicao);
      expect(a.alavancagemMaxima, `${a.nome}`).toBeGreaterThanOrEqual(1);
    }
  });
});

/**
 * ⚠️⚠️ O CONTROLE DE DIREÇÃO — e a cicatriz de como ele quase ficou sem teste.
 *
 * Este bloco foi escrito em 24/08 junto com o agente e NÃO FOI COMMITADO: o
 * script que o anexava rodava depois de um `&&`, e o comando anterior saiu com
 * código 1. O commit seguinte usou `git add -A` e não havia o que adicionar. O
 * CI passou porque o teste não existia — e eu afirmei, na mensagem do commit e
 * ao dono, que "tem teste travando isso". Não tinha.
 *
 * O que barrou o agente naquele dia foram as invariantes PRÉ-EXISTENTES do
 * Celeiro, não estas. Elas fizeram o trabalho que as minhas deveriam fazer.
 */
describe("o controle de direção", () => {
  const cego = AGENTES.find((a) => a.controleDeDirecao);

  it("existe exatamente um, e ele não é o controle de retorno", () => {
    expect(AGENTES.filter((a) => a.controleDeDirecao)).toHaveLength(1);
    expect(cego!.controle).toBeFalsy();
    expect(oControle().id).not.toBe(cego!.id);
  });

  /**
   * ⚠️⚠️ O QUE A COMPARAÇÃO MEDE — e o que ela DEIXOU de medir em 25/08.
   *
   * Praça, papel, fração e banca continuam idênticos ao Caçador, e é isso que
   * este teste trava: com eles diferentes, a comparação responderia "a taxa
   * vale?" ou "o tamanho vale?" achando que responde "o sinal vale?".
   *
   * ⚠️ MAS A DIFERENÇA JÁ NÃO É SÓ O SINAL. O Caçador saiu do spot para futuros
   * — em spot, a 0,20%/perna, um alvo de 2% não limpa o pedágio e ele parou de
   * abrir — e ao mudar de praça ganhou o LADO VENDIDO. O controle só compra, e
   * tem de continuar assim: um controle que escolhesse lado deixaria de ser
   * régua.
   *
   * Então a pergunta que este par responde HOJE é: "o sinal, incluindo as
   * vendas que ele manda fazer, bate comprar às cegas?". Não é mais "o sinal
   * sabe direção?" em isolamento.
   */
  it("é idêntico ao Caçador em praça, papel, fração e banca", () => {
    const cacador = agentePor("cacador_de_tendencia")!;
    expect(cego!.modalidade).toBe(cacador.modalidade);
    expect(cego!.execucao).toBe(cacador.execucao);
    expect(cego!.fracaoPorPosicao).toBe(cacador.fracaoPorPosicao);
    expect(cego!.bancaInicialUsd).toBe(cacador.bancaInicialUsd);
    expect(cego!.capitalMinimoUsd).toBe(cacador.capitalMinimoUsd);
  });

  /** ⚠️ Sem alavanca: quem responde "a alavanca vale?" é o Alavancado. */
  it("não alavanca — senão mediria alavanca em vez de sinal", () => {
    expect(cego!.alavancagemMaxima).toBe(1);
  });

  /**
   * ⚠️ E ELE DECLARA QUE NÃO VENDE MESMO PODENDO. Em spot isso era imposição da
   * praça; em futuros virou escolha, e escolha precisa estar escrita.
   */
  it("declara que não vende, agora que a praça permitiria", () => {
    expect(cego!.naoFaz.toLowerCase()).toContain("não vende");
    expect(cego!.modalidade).toBe("futuros_gate");
  });

  /** ⚠️ Controle não se aposenta — quem se aposenta é quem não o bate. */
  it("os direcionais declaram que se medem contra ele", () => {
    for (const id of ["cacador_de_tendencia", "alavancado_de_tendencia"]) {
      expect(agentePor(id)!.aposentaQuando).toContain("Comprador Cego");
    }
    expect(cego!.aposentaQuando).toContain("nunca");
  });
});
