/**
 * O MOTOR DA BANCADA — o vocabulário do cliente virando operações medidas.
 *
 * ⚠️⚠️ ELE NÃO REIMPLEMENTA A SAÍDA. A convenção de fechamento — stop-first
 * pessimista, `expirada` como classe PRÓPRIA — vive em `paper/engine.ts`
 * (`computeExitPath`), e é ela que resolve cada posição aqui. Um segundo
 * simulador de bracket seria uma segunda verdade sobre dinheiro, e as duas
 * divergiriam em silêncio no dia em que alguém mexesse numa só.
 *
 * ⚠️ ESTE ARQUIVO É PURO: velas entram como argumento, nada de rede nem banco.
 * Quem busca vela é `mercado/store.ts`; quem grava resultado é `bancada/store.ts`.
 */

import type { VelaComTempo } from "@/lib/mercado/velas";
/**
 * ⚠️ DE `paper/saida.ts`, NUNCA de `paper/engine.ts` — o engine importa
 * `supabase/server`, e o empacotador puxa o MÓDULO, não a função. Esta tela é
 * de cliente: importar do engine arrastaria a service-role key para o navegador
 * e derrubaria o app inteiro na primeira rota (aconteceu em 24/08).
 */
import { computeExitPath } from "@/lib/paper/saida";
import type { EstrategiaDoCliente, Entrada } from "@/lib/bancada/vocabulario";
import { taxaDaBancadaPct } from "@/lib/bancada/vocabulario";

/**
 * O desfecho de UMA operação.
 *
 * ⚠️⚠️ QUATRO CLASSES, NÃO DUAS. `expirada` não é ganho nem perda: contá-la
 * como derrota infla o custo, como vitória infla a borda. É cicatriz do
 * flywheel, e o `check` da coluna no banco guarda a mesma separação.
 */
export type Desfecho = "alvo" | "stop" | "expirada";

export interface Operacao {
  /** Quando a posição abriu (unix ms da vela do sinal). */
  abriuEm: number;
  /** Quando ela fechou. ⚠️ Sem isto não dá para medir EXPOSIÇÃO, e sem
   *  exposição a comparação com "segurar" esconde metade da história: 3% com a
   *  mesa 8% do tempo exposta é outra coisa que 3% exposto o tempo todo. */
  fechouEm: number;
  entrada: number;
  saida: number;
  desfecho: Desfecho;
  /** Resultado da operação em %, BRUTO — sem taxa. */
  brutoPct: number;
  /** O mesmo, já descontado o pedágio de ida e volta da praça e do papel. */
  liquidoPct: number;
  /** ⚠️ Qual playbook abriu — só no modo mesa. Numa estratégia própria o
   *  gatilho é o que o cliente escolheu, e não há playbook a nomear. */
  playbook?: string;
  /** O símbolo, para a tela não precisar adivinhar de qual série veio. */
  simbolo?: string;
}

/** Média simples das últimas `n` fechando em `i`. `null` antes de haver `n`. */
function media(closes: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  let s = 0;
  for (let k = i + 1 - n; k <= i; k++) s += closes[k];
  return s / n;
}

/** RSI de Wilder — a mesma definição de `benchmarks.ts`, para não haver duas. */
function rsi(closes: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let ganho = 0, perda = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) ganho += d; else perda -= d;
  }
  let mg = ganho / period, mp = perda / period;
  out[period] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0, p = d < 0 ? -d : 0;
    mg = (mg * (period - 1) + g) / period;
    mp = (mp * (period - 1) + p) / period;
    out[i] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
  }
  return out;
}

/**
 * Onde a estratégia QUER entrar — um booleano por vela.
 *
 * ⚠️⚠️ O SINAL DA VELA `i` USA SÓ DADO ATÉ `i`, e é isso que o separa de um
 * backtest que parece genial. Olhar o fechamento da vela seguinte para decidir
 * a entrada é o lookahead clássico, e ele transforma qualquer regra em ouro.
 *
 * ⚠️ E É CRUZAMENTO, NÃO ESTADO. "Fechou acima da média" ficaria verdadeiro por
 * cinquenta velas seguidas e abriria cinquenta posições na mesma perna do mesmo
 * movimento — a amostra incharia sem observação nova nenhuma, e o `n` da tela
 * mentiria sobre quantas vezes a ideia foi testada de verdade.
 */
export function sinais(velas: ReadonlyArray<VelaComTempo>, e: EstrategiaDoCliente): boolean[] {
  const closes = velas.map((v) => v.close);
  const compra = e.direcao === "compra";
  const marca: boolean[] = new Array(velas.length).fill(false);

  const dentro = serieDoGatilho(velas, closes, e.entrada, compra);

  let anterior: boolean | null = null;
  for (let i = 0; i < velas.length; i++) {
    const agora = dentro[i];
    if (agora == null) { anterior = null; continue; }
    // Cruzou de fora para dentro nesta vela.
    if (anterior === false && agora === true) marca[i] = true;
    anterior = agora;
  }
  return marca;
}

/**
 * O gatilho em CADA vela, calculado uma vez para a janela inteira. `null`
 * enquanto o indicador ainda não nasceu — ausência, não `false`.
 *
 * ⚠️⚠️ ANTES ISTO ERA UMA FUNÇÃO POR VELA (`valorDoGatilho(…, i)`), e o RSI
 * recalculava a SÉRIE INTEIRA dentro dela: N velas × uma série de N = O(N²).
 * Medido (CE-01): ~6,8 s contra ~0,45 ms para o mesmo resultado. A série do
 * RSI só depende do passado (Wilder é recursivo desde a primeira vela), então
 * calculá-la uma vez e ler o índice `i` é EXATAMENTE o que a versão antiga lia
 * — mesma função, mesmas operações de ponto flutuante, mesma ordem. O teste
 * diferencial contra `__referencia__/motor-legado.ts` exige igualdade exata.
 *
 * ⚠️ A MÉDIA CONTINUA SOMANDO AS `n` VELAS NA MESMA ORDEM, de propósito. Uma
 * soma móvel seria O(N) em vez de O(N·n), mas arredonda diferente: num
 * cruzamento exato (`close === média`) ela inverteria o sinal sem ninguém mexer
 * na regra. Com `n ≤ 400` (`LIMITES.nMax`) o custo é linear com teto conhecido.
 *
 * ⚠️ O CANAL usa um deque monotônico — máximo e mínimo são COMPARAÇÕES, não
 * somas, então não há arredondamento a mudar: o valor é idêntico ao da varredura.
 */
function serieDoGatilho(
  velas: ReadonlyArray<VelaComTempo>, closes: number[], entrada: Entrada, compra: boolean,
): Array<boolean | null> {
  const N = velas.length;
  const out: Array<boolean | null> = new Array(N).fill(null);
  switch (entrada.tipo) {
    case "media": {
      for (let i = 0; i < N; i++) {
        const m = media(closes, i, entrada.n);
        if (m == null) continue;
        out[i] = compra ? closes[i] > m : closes[i] < m;
      }
      return out;
    }
    case "canal": {
      // ⚠️ O canal olha as `n` velas ANTERIORES, não incluindo a atual: comparar
      // a máxima da janela consigo mesma nunca romperia.
      const n = entrada.n;
      const maximas = extremosDaJanelaAnterior(velas, n, "high");
      const minimas = extremosDaJanelaAnterior(velas, n, "low");
      for (let i = n; i < N; i++) {
        out[i] = compra ? closes[i] > maximas[i] : closes[i] < minimas[i];
      }
      return out;
    }
    case "rsi": {
      const serie = rsi(closes, entrada.n);
      for (let i = 0; i < N; i++) {
        const r = serie[i];
        if (r == null) continue;
        // Compra em sobrevenda (abaixo do nível), vende em sobrecompra (acima).
        out[i] = compra ? r < entrada.nivel : r > entrada.nivel;
      }
      return out;
    }
  }
}

/**
 * Para cada `i ≥ n`, o máximo (`high`) ou mínimo (`low`) das velas `[i-n, i)`.
 *
 * ⚠️ MESMA SEMÂNTICA da varredura antiga, inclusive com `NaN`: lá
 * `velas[k].high > maxima` é falso para NaN, então NaN nunca vira o extremo e
 * uma janela só de NaN fica em `-Infinity`/`Infinity`. Aqui o NaN é descartado
 * na entrada do deque pela mesma razão — e o diferencial cobre o caso.
 */
function extremosDaJanelaAnterior(
  velas: ReadonlyArray<VelaComTempo>, n: number, campo: "high" | "low",
): number[] {
  const N = velas.length;
  const vazio = campo === "high" ? -Infinity : Infinity;
  const out: number[] = new Array(N).fill(vazio);
  const melhor = campo === "high"
    ? (a: number, b: number) => a >= b
    : (a: number, b: number) => a <= b;
  // Índices candidatos; os valores em `velas[idx][campo]` ficam monotônicos.
  const deque: number[] = [];
  let cabeca = 0;
  for (let i = 0; i < N; i++) {
    if (i >= n) {
      // Janela de `i` é [i-n, i): descarta quem saiu pela esquerda.
      while (cabeca < deque.length && deque[cabeca] < i - n) cabeca++;
      out[i] = cabeca < deque.length ? velas[deque[cabeca]][campo] : vazio;
    }
    // A vela `i` entra para as janelas de i+1 … i+n.
    const x = velas[i][campo];
    if (Number.isNaN(x)) continue;
    while (deque.length > cabeca && melhor(x, velas[deque[deque.length - 1]][campo])) deque.pop();
    deque.push(i);
  }
  return out;
}

export interface RodadaDoMotor {
  operacoes: Operacao[];
  /** ⚠️ Quantas velas o motor de fato leu — é o `custo_velas` da cota. */
  velasLidas: number;
  /**
   * ⚠️ Posições que ainda estavam ABERTAS quando a janela acabou.
   *
   * Elas NÃO entram no resultado: incluí-las com o preço do último fechamento
   * seria marcar a mercado uma operação que a estratégia não mandou fechar, e
   * uma janela que termina numa alta viraria borda que não existe. Ficam
   * contadas para a tela poder dizer que existiram.
   */
  aindaAbertas: number;
}

/**
 * Roda a estratégia sobre a série e devolve as operações resolvidas.
 *
 * ⚠️ UMA POSIÇÃO POR VEZ. Deixar o sinal reabrir enquanto já há posição aberta
 * empilharia o mesmo movimento várias vezes e o `n` contaria repetição como
 * evidência — a mesma inflação de amostra que `sinais` evita usando cruzamento.
 */
export function rodar(
  velas: ReadonlyArray<VelaComTempo>, e: EstrategiaDoCliente,
): RodadaDoMotor {
  const custoIdaEVoltaPct = 2 * taxaDaBancadaPct(e.praca, e.papel);
  const marca = sinais(velas, e);
  const dir = e.direcao === "compra" ? 1 : -1;
  const horizonteMs = e.horasLimite * 3_600_000;

  // `computeExitPath` fala em velas com `t`, `high`, `low`, `close` — o mesmo
  // formato de `VelaComTempo`. Nenhuma conversão, nenhuma chance de trocar
  // high com low no caminho.
  const paraCaminho = velas.map((v) => ({ t: v.t, high: v.high, low: v.low, close: v.close }));

  const operacoes: Operacao[] = [];
  let aindaAbertas = 0;
  let livreApartirDe = 0;
  /**
   * ⚠️⚠️ A FATIA QUE VAI PARA `computeExitPath` TERMINA NA VELA DO FECHAMENTO
   * (CE-01). Antes era `slice(i + 1)` — o RESTO DA SÉRIE INTEIRA —, e o
   * `computeExitPath` ainda filtrava esse resto todo: O(N) por operação, O(N²)
   * numa estratégia que opera muito. Com 175 mil velas (o teto de uma rodada) e
   * milhares de operações isso era a rodada inteira.
   *
   * ⚠️ É EQUIVALENTE, não aproximado, e a condição é verificada aqui:
   *   · `computeExitPath` filtra `c.t >= abertaEm && c.t <= ate`. Se cada vela
   *     está pelo menos 1 ms depois da anterior, toda vela depois de `i` já
   *     satisfaz `c.t >= abriuEm + 1`, e as depois de `ate` saem pelo filtro;
   *   · ele devolve na PRIMEIRA vela que toca alvo ou stop — que é
   *     `indiceDoFechamento`, com a mesma regra. As velas depois dela nunca
   *     eram lidas; quando nada toca, o índice é a última vela `≤ ate`, que é
   *     a janela inteira de antes.
   * Série fora desse contrato (tempo repetido ou voltando) cai no caminho
   * antigo, sem atalho — o resultado nunca depende da otimização.
   */
  const fatiaCurta = tempoAvancaPeloMenos1ms(velas);

  for (let i = 0; i < velas.length; i++) {
    if (!marca[i] || i < livreApartirDe) continue;

    const entrada = velas[i].close;
    if (!(entrada > 0)) continue;

    const alvo = entrada * (1 + dir * (e.alvoPct / 100));
    const stop = entrada * (1 - dir * (e.stopPct / 100));
    const abriuEm = velas[i].t;
    /**
     * ⚠️⚠️ O HORIZONTE CONTA A PARTIR DE `abertaEm`, NÃO DE `abriuEm` — e a
     * diferença de UM MILISSEGUNDO decidia se a expiração acontecia.
     *
     * `opened_at` é `abriuEm + 1` (para a vela do sinal não voltar para a
     * varredura). `computeExitPath` calcula o horizonte a partir de `opened_at`,
     * então com `expiraEm = abriuEm + horizonte` o limite que eu passava ficava
     * sempre 1ms ABAIXO do horizonte dele: a condição `nowMs >= horizonMs`
     * nunca era verdadeira, e toda posição que devia EXPIRAR voltava como
     * "ainda aberta" — some do resultado sem aparecer como defeito em lugar
     * nenhum. O teste "a posição que estoura o horizonte expira" fixa isto.
     */
    const abertaEm = abriuEm + 1;
    const expiraEm = abertaEm + horizonteMs;

    /**
     * ⚠️ A VARREDURA COMEÇA NA VELA SEGUINTE. A vela do sinal é a que decidiu a
     * entrada: usar a máxima e a mínima DELA para resolver alvo e stop seria
     * fechar a posição com o movimento que ainda estava acontecendo quando a
     * decisão foi tomada. É o lookahead pela porta dos fundos.
     */
    // ⚠️ O fim desta posição é o que vier primeiro: o horizonte ou o fim da
    // janela pedida. `computeExitPath` recebe exatamente este limite.
    const ate = Math.min(velas[velas.length - 1].t, expiraEm);
    const iFechou = indiceDoFechamento(velas, i, alvo, stop, dir, ate);
    const daqui = fatiaCurta ? paraCaminho.slice(i + 1, iFechou + 1) : paraCaminho.slice(i + 1);

    const v = computeExitPath(
      {
        side: dir > 0 ? "buy" : "sell",
        entry_price: entrada,
        cost_usd: 1,
        target_price: alvo,
        stop_price: stop,
        // ⚠️ `opened_at` é o instante da PRÓXIMA vela, não o da vela do sinal:
        // `computeExitPath` filtra a janela por `c.t >= openedMs`, e usar o `t`
        // do sinal traria a própria vela do sinal de volta para a varredura.
        opened_at: new Date(abertaEm).toISOString(),
        horizon_hours: e.horasLimite,
      },
      daqui,
      undefined,
      // ⚠️ `nowMs` é o FIM DA JANELA, não `Date.now()`: um backtest não tem
      // "agora". Com o relógio real, uma janela histórica sempre teria o
      // horizonte vencido e toda posição fecharia como expirada.
      ate,
      custoIdaEVoltaPct,
    );

    if (!v) {
      /**
       * ⚠️⚠️ A POSIÇÃO QUE NÃO FECHOU AINDA OCUPA A MESA. A primeira versão
       * fazia `continue` aqui sem mover a barreira, e os sinais seguintes
       * abriam posição por cima de uma que continuava aberta — exatamente o
       * empilhamento que a trava existe para impedir, só que na fatia em que
       * ela mais engana: `aindaAbertas` subia para 3 e ninguém somava aquilo
       * com o resultado. Um teste pegou (05/09).
       *
       * Ela chega até o fim da janela, então nada mais abre depois dela.
       */
      aindaAbertas++;
      livreApartirDe = velas.length;
      continue;
    }

    const desfecho: Desfecho = v.reason === "target" ? "alvo" : v.reason === "stop" ? "stop" : "expirada";
    operacoes.push({
      abriuEm,
      fechouEm: velas[iFechou].t,
      entrada,
      saida: v.exit,
      desfecho,
      brutoPct: v.netPct + custoIdaEVoltaPct,
      liquidoPct: v.netPct,
    });

    /**
     * ⚠️ A PRÓXIMA ENTRADA SÓ NASCE DEPOIS QUE ESTA FECHOU, e o índice é
     * procurado com a MESMA regra e os MESMOS limites de `computeExitPath` —
     * senão a barreira e o resultado falariam de velas diferentes, e a mesma
     * série produziria contagens que não se explicam.
     */
    livreApartirDe = Math.max(i + 1, iFechou + 1);
  }

  return { operacoes, velasLidas: velas.length, aindaAbertas };
}

/**
 * O índice da vela em que a posição fechou — ou a última da janela quando ela
 * fechou por expirar.
 *
 * ⚠️ MESMO LIMITE (`ate`) E MESMA REGRA de `computeExitPath`. Duplicar a
 * varredura com bordas ligeiramente diferentes é como duas contagens do mesmo
 * evento passam a discordar sem ninguém mexer em nada.
 */
function indiceDoFechamento(
  velas: ReadonlyArray<VelaComTempo>, iSinal: number,
  alvo: number, stop: number, dir: number, ate: number,
): number {
  let ultima = iSinal;
  for (let j = iSinal + 1; j < velas.length && velas[j].t <= ate; j++) {
    ultima = j;
    if (precoResolve(velas[j], alvo, stop, dir)) return j;
  }
  return ultima;
}

/**
 * `true` quando cada vela está pelo menos 1 ms depois da anterior — o contrato
 * que torna a fatia curta de `rodar` idêntica à fatia longa. Tempo não finito
 * também cai fora (comparação com NaN é sempre falsa).
 */
function tempoAvancaPeloMenos1ms(velas: ReadonlyArray<VelaComTempo>): boolean {
  for (let j = 1; j < velas.length; j++) {
    if (!(velas[j].t - velas[j - 1].t >= 1)) return false;
  }
  return true;
}

/** Esta vela toca alvo ou stop? ⚠️ Stop-first, igual a `computeExitPath`. */
function precoResolve(
  c: { high: number; low: number }, alvo: number, stop: number, dir: number,
): boolean {
  const bateuStop = dir > 0 ? c.low <= stop : c.high >= stop;
  const bateuAlvo = dir > 0 ? c.high >= alvo : c.low <= alvo;
  return bateuStop || bateuAlvo;
}
