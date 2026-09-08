/**
 * O EXTRATO DA INSTÂNCIA — o número DO INVESTIDOR, contado do zero.
 *
 * ⚠️⚠️ ISTO É O CONSERTO DE 07/09, e ele não é de tela. Até aqui o cliente lia,
 * no card do agente, o que a CASA mediu na mesa dela: uma agregação de
 * `zion_suggestions`, o livro do admin. O dono: *"apenas estamos pegando os
 * resultados das mesas do painel e Admin e repetindo para o investidor... tinha
 * que ser isolado"*.
 *
 * Aqui não há uma linha do livro da casa. A entrada são as `bancada_posicao`
 * DAQUELE dono, daquela instância — as que o cron abriu e fechou depois que ele
 * contratou o agente. Se ele contratou ontem, o número é de ontem para cá, e a
 * amostra é minúscula, e a tela tem de dizer isso em vez de emprestar a
 * credibilidade de 335 operações que não são dele.
 *
 * ⚠️ AS TRÊS HONESTIDADES QUE ATRAVESSAM DO ADMIN, e nenhuma é enfeite:
 *
 *  1. `expirada` NÃO É NEM GANHO NEM PERDA. Contá-la como derrota infla o
 *     custo, como vitória infla a borda — cicatriz do flywheel. Ela é contada à
 *     parte E MOSTRADA: uma instância que expira mais do que decide morre de
 *     relógio, não de tese, e o investidor precisa ver isso.
 *  2. AMOSTRA PEQUENA NÃO GANHA COR. `shouldTint` — o painel do Valhalla
 *     exibia +1,19% de UMA operação com o mesmo peso visual de uma média de
 *     268.
 *  3. AUSÊNCIA CONTINUA AUSENTE. Zero decididas devolve `null`, nunca 0%.
 *     "Ainda não decidiu nada" e "decidiu e empatou" são coisas diferentes.
 *
 * ⚠️ PURO: o vitest desta base roda em `environment: "node"`.
 */

import { gradeSample, shouldTint, sampleLabel, type SampleGrade } from "@/lib/admin/sample";

/** Uma posição da instância, como o banco a guarda. */
export interface PosicaoDaInstancia {
  status: "aberta" | "ganhou" | "perdeu" | "expirada";
  /**
   * ⚠️ JÁ LÍQUIDO do pedágio da praça do dono — `decidirFechamento` passa o
   * custo a `computeExitPath`. Não descontar de novo aqui: cobrar duas vezes é
   * tão errado quanto não cobrar, e é mais difícil de achar.
   */
  resultadoPct: number | null;
  playbook: string | null;
  simbolo: string;
  abertaEmMs: number;
  fechadaEmMs: number | null;
}

export interface Desempenho {
  /** Quando o investidor ligou. `null` = ligada sem carimbo (linha antiga). */
  desdeMs: number | null;
  /** ⚠️ Horas decorridas. Número sem tempo é o mesmo defeito de número sem n. */
  horasRodando: number | null;

  /** ⚠️ `ganhou + perdeu`. Expirada NÃO entra — ver o cabeçalho. */
  decididas: number;
  alvo: number;
  stop: number;
  /** Contadas à parte e MOSTRADAS. */
  expiradas: number;
  abertas: number;

  /** `alvo / decididas`. ⚠️ `null` com zero decididas, nunca 0%. */
  acertoPct: number | null;
  /**
   * Média de `resultadoPct` nas DECIDIDAS, já líquida.
   *
   * ⚠️ Decididas só, para ser a MESMA régua do card da casa — senão o
   * investidor compararia o número dele com o nosso medindo coisas diferentes,
   * que é pior que não comparar.
   */
  liquidoPorOpPct: number | null;
  /**
   * A mesma média INCLUINDO as expiradas.
   *
   * ⚠️ Ela existe porque a expirada aconteceu e mexeu no dinheiro. As duas
   * juntas contam a história inteira: a primeira diz se a TESE paga, a segunda
   * diz o que o período REALMENTE rendeu. Publicar só a primeira numa mesa que
   * expira metade dos sinais é escolher o número bonito.
   */
  liquidoComExpiradasPct: number | null;

  /** ⚠️ `false` abaixo do limiar: o número aparece SEM cor de veredito. */
  pinta: boolean;
  amostra: SampleGrade;
  rotuloDaAmostra: string;

  /** Quantas vezes cada playbook abriu — o investidor vê QUAL regra operou. */
  porPlaybook: Record<string, number>;
  /** Em quantos símbolos ela de fato operou. */
  simbolos: number;
}

function media(xs: number[]): number | null {
  // ⚠️ Lista vazia é `null`, não 0 — dividir por zero silenciosamente
  // transformaria "nada aconteceu" em "aconteceu e deu zero".
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * ⚠️⚠️ A JANELA QUE OS NÚMEROS COBREM — 08/09.
 *
 * `papel_desde` era reescrito com `Date.now()` a CADA vez que o investidor
 * religava o agente, e apagado ao pausar. Só que as posições contadas ao lado
 * são as da estratégia INTEIRA, desde a contratação. Quem pausasse e religasse
 * lia *"trabalhando há 2h"* colado em "48 decididas" de duas semanas — uma taxa
 * cujo numerador e denominador falam de janelas diferentes. E quem só pausasse
 * via o carimbo SUMIR, como se o agente nunca tivesse trabalhado.
 *
 * A régua correta é a contratação: é dela que as posições contam. `papel_desde`
 * passou a ser escrito só na primeira vez (ver `ligarPapelAdiante`), e
 * `criadaEm` é a rede de segurança para as linhas antigas, que é exatamente o
 * mesmo instante — contratar cria a linha E liga.
 *
 * ⚠️ Por isso o rótulo na tela deixou de ser "trabalhando há" e passou a ser
 * "os números cobrem": incluir o tempo pausado num rótulo que diz "trabalhando"
 * seria trocar uma mentira por outra.
 */
export function inicioDaCobertura(
  papelDesde: string | null, criadaEm: string | null,
): number | null {
  for (const iso of [papelDesde, criadaEm]) {
    if (!iso) continue;
    const ms = Date.parse(iso);
    // ⚠️ `Date.parse` devolve NaN em lixo, e NaN viraria "há NaN horas".
    if (Number.isFinite(ms)) return ms;
  }
  // ⚠️ Ausência continua ausência: sem carimbo nenhum, a tela não afirma janela.
  return null;
}

/** Só o que É número. ⚠️ `Number(null)` é 0 e passa em `isFinite`. */
function numeros(xs: Array<number | null>): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

export function desempenhoDaInstancia(
  posicoes: ReadonlyArray<PosicaoDaInstancia>,
  desdeMs: number | null,
  agoraMs: number = Date.now(),
): Desempenho {
  const abertas = posicoes.filter((p) => p.status === "aberta");
  const ganhas = posicoes.filter((p) => p.status === "ganhou");
  const perdidas = posicoes.filter((p) => p.status === "perdeu");
  const expiradas = posicoes.filter((p) => p.status === "expirada");

  const decididas = ganhas.length + perdidas.length;

  const porPlaybook: Record<string, number> = {};
  const simbolos = new Set<string>();
  for (const p of posicoes) {
    // ⚠️ SÓ AS FECHADAS contam para "qual regra operou": uma posição ainda
    // aberta não produziu resultado, e contá-la aqui misturaria intenção com
    // desfecho.
    if (p.status !== "aberta" && p.playbook) porPlaybook[p.playbook] = (porPlaybook[p.playbook] ?? 0) + 1;
    if (p.status !== "aberta") simbolos.add(p.simbolo);
  }

  return {
    desdeMs,
    horasRodando: desdeMs == null ? null : Math.max(0, (agoraMs - desdeMs) / 3_600_000),

    decididas,
    alvo: ganhas.length,
    stop: perdidas.length,
    expiradas: expiradas.length,
    abertas: abertas.length,

    acertoPct: decididas > 0 ? (ganhas.length / decididas) * 100 : null,
    liquidoPorOpPct: media(numeros([...ganhas, ...perdidas].map((p) => p.resultadoPct))),
    liquidoComExpiradasPct: media(numeros([...ganhas, ...perdidas, ...expiradas].map((p) => p.resultadoPct))),

    /**
     * ⚠️⚠️ A COR SAI DAS DECIDIDAS, não do total de posições. Uma instância com
     * 40 expiradas e 2 decididas tem uma amostra de DOIS para efeito de
     * veredito — e pintar isso de verde por causa do 40 seria exatamente o que
     * o painel do Valhalla fazia.
     */
    pinta: shouldTint(decididas),
    amostra: gradeSample(decididas),
    rotuloDaAmostra: sampleLabel(decididas),

    porPlaybook,
    simbolos: simbolos.size,
  };
}
