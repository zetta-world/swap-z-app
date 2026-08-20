/**
 * O INVESTIGADOR — o único trabalho de IA que esta casa mediu como bom.
 *
 * ⚠️⚠️ POR QUE ELE NÃO OPERA, E NUNCA VAI OPERAR.
 *
 * Em 19/08 mediu-se o alpha de cada mesa contra a linha de base sem
 * inteligência (num passeio aleatório, P(alvo antes do stop) = stop/(alvo+stop)):
 *
 *   grok −12,6 pp · self −11,0 · kimi −9,5 · deepseek −7,6 · mistral −6,7
 *
 * Seis modelos, 3.300 decisões, todos ABAIXO do acaso. Pedir palpite de preço a
 * um LLM é comprovadamente pior que jogar moeda. O erro nunca foi o modelo — foi
 * a pergunta.
 *
 * ⚠️ A PERGUNTA CERTA. LLM é bom em raciocinar sobre evidência estruturada. O
 * Investigador recebe o extrato DECOMPOSTO (taxa, derrapagem, funding, preço) e
 * responde três coisas, nesta ordem:
 *
 *   1. onde o USDT vazou   — a conta, não a narrativa
 *   2. que hipótese explica — uma frase falsificável, com o número que a sustenta
 *   3. que mutação proponho — UM parâmetro, com o resultado esperado ANTES
 *
 * ⚠️ E O PLACAR DELE É O CAIXA. A mutação vai para metade do capital; a outra
 * metade segue sem mudança. Depois de N lançamentos por braço, compara-se o
 * USDT. O modelo é pontuado pelo que a ideia dele PRODUZIU — não pela prosa,
 * não por quantas hipóteses gerou. Quem propõe piora recebe menos vez.
 *
 * É isto que separa o Celeiro de um painel gêmeo: no torneio antigo os modelos
 * competiam em ADIVINHAR; aqui competem em DESCOBRIR POR QUE PERDEMOS.
 *
 * ⚠️ NENHUM MODELO DA ANTHROPIC PARTICIPA — decisão do dono. `configuredProviders()`
 * já devolve só os compatíveis com a API aberta, e o teste trava isso.
 */

import type { Extrato } from "@/lib/celeiro/fluxo";

/** Uma proposta de mutação, já validada. */
export interface Proposta {
  agente: string;
  modelo: string;
  /** Por que o USDT vazou. Falsificável, com número. */
  hipotese: string;
  /** A mudança: UM parâmetro do genoma. */
  diff: Record<string, number | string | boolean>;
  /** O resultado previsto, escrito ANTES de aplicar. */
  esperado: string;
}

/**
 * O prompt.
 *
 * ⚠️ ELE ENTREGA A CONTA E PROÍBE A NARRATIVA. Se o texto dissesse "o agente
 * perdeu porque a taxa está alta", o modelo leria a conclusão pronta e o
 * trabalho dele viraria concordar. A arena antiga produziu 18 lições em prosa e
 * zero evidência exatamente assim.
 *
 * ⚠️ E ELE EXIGE UM PARÂMETRO SÓ. Duas mudanças de uma vez tornam o A/B
 * ilegível: se pagar, não se sabe qual das duas pagou; se não pagar, não se
 * sabe qual atrapalhou. Um teste que não isola não é teste.
 */
export function promptDoInvestigador(
  e: Extrato,
  genomaAtual: Record<string, unknown>,
  lancamentos: number,
): string {
  const linha = (r: { causa: string; usdt: number }) => `${r.causa}: ${r.usdt.toFixed(4)} USDT`;
  return [
    "Você investiga o caixa de UM agente de trading. Você NÃO opera e NÃO",
    "prevê preço — previsão de direção por modelo já foi medida nesta casa e",
    "ficou ABAIXO de jogar uma moeda, em 3.300 decisões. Seu trabalho é achar",
    "POR QUE o USDT vazou e propor UMA mudança de parâmetro.",
    "",
    `AGENTE: ${e.agente}`,
    `USDT PRODUZIDO: ${e.usdt.toFixed(4)} em ${lancamentos} lançamentos`,
    "",
    "ENTROU:",
    ...(e.fontes.length ? e.fontes.map((f) => `  ${linha(f)}`) : ["  (nada)"]),
    "SAIU:",
    ...(e.vazamentos.length ? e.vazamentos.map((v) => `  ${linha(v)}`) : ["  (nada)"]),
    "",
    "GENOMA ATUAL (os parâmetros que você pode mudar):",
    JSON.stringify(genomaAtual, null, 2),
    "",
    "Responda SOMENTE com JSON, neste formato:",
    "{",
    '  "hipotese": "frase falsificável citando o número que a sustenta",',
    '  "diff": { "nome_do_parametro": novo_valor },',
    '  "esperado": "o que deve acontecer com o USDT se a hipótese estiver certa"',
    "}",
    "",
    "REGRAS:",
    "- `diff` muda EXATAMENTE UM parâmetro que existe no genoma acima. Duas",
    "  mudanças tornam o teste ilegível: se pagar, não se sabe qual pagou.",
    "- `hipotese` precisa citar um número do extrato. Sem número é narrativa.",
    "- `esperado` é escrito ANTES do resultado. Ele será comparado com o que",
    "  acontecer de fato, e é assim que VOCÊ é pontuado — pelo USDT que a sua",
    "  mudança produzir contra o braço que não mudou.",
    "- Se o extrato não sustenta nenhuma hipótese, devolva",
    '  {"hipotese":"","diff":{},"esperado":""}. Dizer "não sei" vale mais que',
    "  inventar: proposta ruim custa capital real de teste.",
  ].join("\n");
}

export type Recusa =
  | "json_ilegivel"
  | "sem_hipotese"
  | "hipotese_sem_numero"
  | "diff_vazio"
  | "diff_multiplo"
  | "parametro_desconhecido"
  | "valor_invalido"
  | "sem_esperado";

export type Leitura =
  | { ok: true; proposta: Omit<Proposta, "agente" | "modelo"> }
  | { ok: false; recusa: Recusa; porque: string };

/**
 * Lê a resposta do modelo, e RECUSA mais do que aceita.
 *
 * ⚠️ CADA RECUSA TEM NOME PRÓPRIO. "Falhou" agregaria um modelo que devolve
 * lixo com um que honestamente disse "não sei" — e os dois merecem tratamento
 * oposto: o primeiro perde vez, o segundo não.
 */
export function lerResposta(
  texto: string,
  genomaAtual: Record<string, unknown>,
): Leitura {
  let bruto: unknown;
  try {
    const m = /\{[\s\S]*\}/.exec(texto);
    bruto = JSON.parse(m ? m[0] : texto);
  } catch {
    return { ok: false, recusa: "json_ilegivel", porque: "a resposta não contém JSON válido" };
  }
  const o = bruto as { hipotese?: unknown; diff?: unknown; esperado?: unknown };

  const hipotese = typeof o.hipotese === "string" ? o.hipotese.trim() : "";
  const esperado = typeof o.esperado === "string" ? o.esperado.trim() : "";
  const diff = (o.diff && typeof o.diff === "object" && !Array.isArray(o.diff))
    ? o.diff as Record<string, unknown> : {};
  const chaves = Object.keys(diff);

  /**
   * ⚠️ "NÃO SEI" É UMA RESPOSTA VÁLIDA E NÃO PUNIDA. Um Investigador obrigado a
   * sempre propor algo aprende a inventar — e proposta inventada custa capital
   * de teste real. É o `inconclusivo ≠ aprovado` do lado de quem responde.
   */
  if (hipotese === "" && chaves.length === 0) {
    return { ok: false, recusa: "sem_hipotese", porque: "o modelo disse que o extrato não sustenta hipótese" };
  }
  if (hipotese === "") {
    return { ok: false, recusa: "sem_hipotese", porque: "propôs mudança sem dizer por quê" };
  }

  /**
   * ⚠️ HIPÓTESE SEM NÚMERO É NARRATIVA. Foi assim que a arena antiga acumulou
   * 18 lições em prosa e nenhuma com resultado medido. Exigir um algarismo é
   * barato e corta a categoria inteira.
   */
  if (!/\d/.test(hipotese)) {
    return { ok: false, recusa: "hipotese_sem_numero", porque: "a hipótese não cita nenhum número do extrato" };
  }
  if (chaves.length === 0) {
    return { ok: false, recusa: "diff_vazio", porque: "hipótese sem mudança proposta não é acionável" };
  }
  /**
   * ⚠️ UM PARÂMETRO SÓ. Duas mudanças de uma vez tornam o A/B ilegível: se
   * pagar, não se sabe qual pagou; se não pagar, não se sabe qual atrapalhou.
   */
  if (chaves.length > 1) {
    return { ok: false, recusa: "diff_multiplo", porque: `mudou ${chaves.length} parâmetros; o teste só isola um` };
  }
  const chave = chaves[0];
  if (!(chave in genomaAtual)) {
    return { ok: false, recusa: "parametro_desconhecido", porque: `"${chave}" não existe no genoma` };
  }
  const valor = diff[chave];
  const tipoOk = typeof valor === "number" ? Number.isFinite(valor)
    : typeof valor === "string" || typeof valor === "boolean";
  if (!tipoOk) {
    return { ok: false, recusa: "valor_invalido", porque: `valor de "${chave}" não é número, texto nem booleano` };
  }
  if (valor === genomaAtual[chave]) {
    return { ok: false, recusa: "valor_invalido", porque: `"${chave}" já vale isso — a mutação não muda nada` };
  }
  if (esperado === "") {
    return { ok: false, recusa: "sem_esperado", porque: "sem resultado previsto ANTES, qualquer desfecho vira acerto" };
  }

  return {
    ok: true,
    proposta: { hipotese, diff: { [chave]: valor as number | string | boolean }, esperado },
  };
}

export interface Placar {
  modelo: string;
  pagou: number;
  naoPagou: number;
  inconclusivas: number;
  /** USDT somado que as mutações deste modelo geraram acima do controle. */
  usdtGerado: number;
  /** A fatia do rodízio que este modelo merece na próxima rodada (0 a 1). */
  fatiaDoRodizio: number;
}

/** Uma mutação já julgada, do ponto de vista do placar. */
export interface MutacaoJulgada {
  modelo: string;
  veredito: "pagou" | "nao_pagou" | "inconclusiva";
  /** `usdt_mutacao − usdt_controle`. */
  diferenca: number;
}

/**
 * O placar dos modelos.
 *
 * ⚠️⚠️ PONTUADO PELO CAIXA, NÃO PELO TEXTO. Este é o ponto inteiro do
 * Investigador. Um modelo eloquente que propõe mudanças que pioram o USDT cai;
 * um modelo seco que acerta sobe.
 *
 * ⚠️ INCONCLUSIVA NÃO CONTA PARA NENHUM LADO. Premiá-la ensinaria o modelo a
 * propor mudanças que ninguém consegue medir; puni-la ensinaria a evitar
 * hipótese difícil. Ela é registrada e sai da conta.
 */
export function placarDosModelos(
  julgadas: readonly MutacaoJulgada[],
  pisoDeRodizio = 0.1,
): Placar[] {
  const por = new Map<string, Placar>();
  for (const j of julgadas) {
    const p = por.get(j.modelo) ?? {
      modelo: j.modelo, pagou: 0, naoPagou: 0, inconclusivas: 0,
      usdtGerado: 0, fatiaDoRodizio: 0,
    };
    if (j.veredito === "inconclusiva") p.inconclusivas++;
    else {
      if (j.veredito === "pagou") p.pagou++; else p.naoPagou++;
      if (Number.isFinite(j.diferenca)) p.usdtGerado += j.diferenca;
    }
    por.set(j.modelo, p);
  }

  const todos = [...por.values()];
  /**
   * ⚠️ PISO DE RODÍZIO — nenhum modelo é zerado, nem o pior.
   *
   * Zerar um modelo o congela no julgamento do passado: ele nunca mais propõe,
   * logo nunca mais produz evidência, logo nunca sai do fundo. É a versão em
   * software de aposentar por amostra pequena — o erro que este projeto já
   * cometeu com a GERI.
   */
  const positivos = todos.map((p) => Math.max(0, p.usdtGerado));
  const soma = positivos.reduce((s, v) => s + v, 0);

  /**
   * ⚠️ O PISO SE ENCOLHE QUANDO NÃO CABE. Com muitos modelos, `piso × n` passa
   * de 1 e a sobra vira negativa — o que INVERTERIA o rodízio, dando mais vez a
   * quem produziu menos. Um parâmetro que se vira do avesso em silêncio é pior
   * que um limite explícito.
   */
  const pisoEfetivo = todos.length > 0
    ? Math.min(pisoDeRodizio, 1 / (todos.length * 2))
    : 0;
  const sobra = 1 - pisoEfetivo * todos.length;

  return todos
    .map((p, i) => ({
      ...p,
      fatiaDoRodizio: soma > 0
        ? pisoEfetivo + sobra * (positivos[i] / soma)
        : 1 / todos.length,
    }))
    .sort((a, b) => b.usdtGerado - a.usdtGerado);
}
