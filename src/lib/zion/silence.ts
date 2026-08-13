/**
 * POR QUE ESTA MESA ESTÁ CALADA — a leitura que faltava no painel.
 *
 * ⚠️ DE ONDE VEIO (06/08).
 *
 * A URÐR aparecia no painel com zero trades e caixa intacto. Qualquer um que
 * olhasse concluiria "quebrada" ou "esqueceram de ligar". O rastro dizia outra
 * coisa: 142 ticks, 15 com oferta, e nas 15 `vetoedByRecord: 1`.
 *
 * Ou seja — a mesa cujo mandato é escolher pelo HISTÓRICO MEDIDO recebeu
 * candidatos e recusou todos, porque o histórico da biblioteca é negativo.
 * **Ela é a única mesa fazendo exatamente o que deveria**, e no painel parecia
 * a mais morta de todas.
 *
 * Eu mesmo quase errei o diagnóstico: olhei UM tick, vi `offered: 0`, e ia
 * reportar "desconectada". Com os 142 a resposta é o contrário.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A DISTINÇÃO QUE ESTE MÓDULO EXISTE PARA FAZER:
 *
 *   silêncio por DISCIPLINA  → a mesa recebeu e recusou. É o sistema funcionando.
 *   silêncio por FOME        → sem caixa acima do piso, ela não consegue abrir.
 *   silêncio por SECA        → nada chegou. Pode ser o mercado ou a fonte.
 *   silêncio por QUEBRA      → o tick registrou erro.
 *   silêncio SEM RASTRO      → não há tick nenhum. Não dá para julgar.
 *
 * Os cinco parecem iguais numa tela que só mostra "0 trades". Três deles pedem
 * ação oposta: fome se conserta com capital, quebra com código, disciplina com
 * NADA — e desligar a mesa disciplinada seria desligar a única certa.
 *
 * ⚠️ E o quinto é o pior: sem rastro, qualquer veredito é chute. Não se
 * aposenta o que não se consegue diagnosticar.
 */

/** O que um tick de mesa reporta, no formato comum às fontes. */
export interface DeskTick {
  /** Quantos candidatos chegaram. */
  offered?: number | null;
  /** Quantos viraram posição. */
  taken?: number | null;
  /** Quantos foram recusados pelo histórico medido. */
  vetoedByRecord?: number | null;
  /** Motivos de descarte, quando a fonte os reporta. */
  skipped?: Array<{ symbol: string; reason: string }> | null;
  /** A mesa quebrou neste tick. */
  erro?: string | null;
  /**
   * ⚠️ DE QUEM É ESTE TICK, quando várias mesas dividem o mesmo `event_type`.
   *
   * `arb2_window_empty` é emitido pelas TRÊS variantes do Arbiter 2.0 e traz o
   * dono em `metadata.source`. Sem este campo, cada uma lia os ticks das outras
   * duas junto com os seus — e a tela dizia "nenhum candidato em 71 ticks"
   * quando o rastro real de cada uma tem 24. Errar o denominador não muda o
   * veredito aqui, mas muda a FRASE, e a frase é o que alguém vai citar.
   *
   * `null` = a fonte não identifica a mesa; o tick vale para quem mapear nele.
   */
  desk?: string | null;
}

export type SilenceKind =
  | "disciplina"   // recebeu e recusou — o sistema funcionando
  | "nao_executou" // DECIDIU e a carteira não abriu — o sinal existe, a posição não
  | "fome"         // sem caixa para abrir
  | "seca"         // nada chegou
  | "quebra"       // o tick registrou erro
  | "sem_rastro"   // não há tick — não dá para julgar
  | "operando";    // não está calada

export interface SilenceVerdict {
  kind: SilenceKind;
  /** Uma frase para a tela. Curta: cabe embaixo do nome da mesa. */
  label: string;
  /** O que fazer a respeito — ou explicitamente nada. */
  action: string;
  /** Isto reprova a mesa? Disciplina NÃO reprova. */
  isProblem: boolean;
}

/** Piso abaixo do qual `sizePosition` devolve 0 e a mesa para sem avisar. */
export const MIN_CASH_USD = 25;

/**
 * Lê o silêncio de uma mesa a partir dos ticks recentes e do caixa.
 *
 * ⚠️ `ticks` é uma JANELA, não um tick. Um tick isolado não distingue "seca de
 * agora" de "seca sempre" — foi exatamente o erro que quase cometi com a URÐR.
 * Por isso a assinatura pede a lista, e não o último.
 */
export function readSilence(
  ticks: DeskTick[],
  cashUsd: number,
  openPositions: number,
  closedPositions: number,
): SilenceVerdict {
  if (openPositions > 0 || closedPositions > 0) {
    return { kind: "operando", label: "operando", action: "", isProblem: false };
  }

  // Sem tick nenhum, qualquer veredito seria chute — e é o pior estado dos
  // cinco justamente porque parece igual aos outros.
  if (ticks.length === 0) {
    return {
      kind: "sem_rastro",
      label: "sem rastro — não dá para julgar",
      action: "a mesa precisa emitir tick antes de qualquer veredito",
      isProblem: true,
    };
  }

  // Quebra vence os outros: uma mesa que estoura não chegou a decidir nada.
  const comErro = ticks.filter((t) => t.erro);
  if (comErro.length > 0) {
    return {
      kind: "quebra",
      label: `quebrou em ${comErro.length} de ${ticks.length} ticks`,
      action: `último erro: ${String(comErro[0].erro).slice(0, 120)}`,
      isProblem: true,
    };
  }

  // Fome vem antes de seca: sem caixa a mesa não abriria nem se recebesse.
  if (cashUsd < MIN_CASH_USD) {
    return {
      kind: "fome",
      label: `sem caixa — $${cashUsd.toFixed(2)} abaixo do piso de $${MIN_CASH_USD}`,
      action: "recapitalizar, ou aposentar se a rodada dela acabou",
      isProblem: true,
    };
  }

  const ofertas = ticks.reduce((s, t) => s + (t.offered ?? 0), 0);
  const vetos = ticks.reduce((s, t) => s + (t.vetoedByRecord ?? 0), 0);
  const tomadas = ticks.reduce((s, t) => s + (t.taken ?? 0), 0);

  /**
   * ⚠️⚠️ O SEXTO ESTADO — "decidiu, e a carteira não abriu" (13/08).
   *
   * Este módulo nasceu para separar cinco silêncios e ficou seis dias afirmando
   * que eram cinco. A conferência da rota contra o banco de verdade achou o que
   * faltava, e ele estava na mesa mais quieta do painel.
   *
   * A FREYJA (`strat_dex`) gerou **19 sugestões desde 03/08** — elas estão no
   * `zion_suggestions`, com alvo e stop, e RESOLVERAM (`hit_stop`,
   * `hit_target`). O torneio mediu todas. A carteira de papel dela nunca abriu
   * **uma única posição** e continua com os $1.000 intactos.
   *
   * Nos cinco estados antigos isso caía em `disciplina`, com o rótulo
   * "nenhuma tomada" — que é literalmente falso: ela tomou 4 decisões só nas
   * últimas 24h. O silêncio não estava na DECISÃO, estava na EXECUÇÃO, e os
   * dois lugares pedem investigações que não se parecem: recusa se lê no
   * playbook, execução se lê no preço de pool / `canEnter` / caixa.
   *
   * ⚠️ E ele vem ANTES da disciplina de propósito. Uma mesa que decide e não
   * executa também recusou candidatos no mesmo tick — as duas condições são
   * verdadeiras ao mesmo tempo, e a que precisa de gente é esta.
   */
  if (tomadas > 0) {
    return {
      kind: "nao_executou",
      label: `decidiu ${tomadas} vez(es) e a carteira não abriu nada`,
      action: "o sinal está no ledger e a posição não existe — conferir o caminho de "
        + "abertura (preço do pool, `canEnter`, piso de caixa), não o playbook",
      isProblem: true,
    };
  }

  /**
   * ⚠️ DISCIPLINA NÃO É PROBLEMA, e esta é a linha mais importante do módulo.
   *
   * Recebeu candidatos e recusou todos por veto do histórico é a mesa
   * cumprindo o mandato dela. A URÐR existe para obedecer ao que foi MEDIDO,
   * e o medido é negativo — operar seria o defeito, não o silêncio.
   */
  if (ofertas > 0 && vetos >= ofertas) {
    return {
      kind: "disciplina",
      label: `recusou ${vetos} de ${ofertas} — histórico medido negativo`,
      action: "nada a fazer: é a mesa cumprindo o mandato dela",
      isProblem: false,
    };
  }

  const motivos = ticks.flatMap((t) => t.skipped ?? []);

  if (ofertas > 0) {
    /**
     * ⚠️ RECUSA EXPLICADA NÃO É DEFEITO — o caso da FREYJA (13/08).
     *
     * Esta linha dizia `isProblem: true` com a ação "conferir por que o bracket
     * não fechou". Mas a FREYJA reporta o motivo de CADA recusa: em 24h foram
     * 414 candidatos, 4 aproveitados e **410 motivos escritos** — um para cada
     * um dos 410 restantes. Ela já tinha respondido a pergunta que o texto
     * mandava fazer, e mesmo assim acendia igual a uma mesa quebrada.
     *
     * É a armadilha da URÐR outra vez, com outra roupa: em 06/08 a mesa que
     * recusava por VETO DO HISTÓRICO parecia morta; agora era a que recusava
     * por GEOMETRIA. As duas documentam a recusa, e o alarme punia justamente
     * quem documenta.
     *
     * ⚠️ A COBERTURA É EXIGIDA, não presumida. Se a fonte explicou menos
     * recusas do que fez, o resto continua sem explicação e o alarme fica de
     * pé — senão bastaria escrever UM motivo para calar o controle inteiro.
     */
    const recusas = ofertas - tomadas; // `tomadas` é 0 aqui: o ramo acima já saiu
    const explicadas = motivos.length >= recusas && recusas > 0;
    return {
      kind: "disciplina",
      label: `${ofertas} oferta(s), nenhuma tomada`,
      action: explicadas
        ? `todas as ${recusas} recusas têm motivo: ${[...new Set(motivos.map((m) => m.reason))].slice(0, 3).join(" · ")}`
        : "conferir por que o bracket não fechou — o veto não foi do histórico",
      isProblem: !explicadas,
    };
  }

  // Chegou aqui: ticks existem, sem erro, com caixa, e zero ofertas em todos.
  return {
    kind: "seca",
    label: `nenhum candidato em ${ticks.length} ticks`,
    action: motivos.length > 0
      ? `motivos: ${[...new Set(motivos.map((m) => m.reason))].slice(0, 3).join(" · ")}`
      : "a fonte não reporta motivo — pode ser mercado ou pode ser a fonte caída",
    isProblem: motivos.length === 0,
  };
}

/**
 * ─────────────────────────────────────────────────────────────────────────
 * O RASTRO DE CADA MESA — onde ele mora, e como se lê.
 *
 * ⚠️ POR QUE ISTO PRECISOU EXISTIR (13/08).
 *
 * `readSilence` foi escrito em 06/08 e ficou seis dias sem NENHUM chamador
 * fora do próprio teste. O módulo que abre citando a invariante nº 14 — "um
 * controle que ninguém lê não é um controle" — era exatamente isso: um
 * controle que ninguém lia. Ele classificava cinco silêncios perfeitamente
 * dentro de um arquivo que nenhuma tela importava.
 *
 * O que faltava não era a classificação, era a PONTE: cada mesa grava o tick
 * dela com um nome de evento próprio e um formato de metadados próprio, e sem
 * essa tradução o painel não tinha como alimentar a função.
 *
 * ⚠️ E OS NOMES DOS CAMPOS NÃO COINCIDEM ENTRE AS FONTES. A ULLR chama de
 * `eligible`/`fired` o que a URÐR chama de `offered`/`taken`, e a FREYJA
 * chama de `candidates`/`logged`. Ler `offered` cru daria ZERO nas três — e
 * zero oferta é o veredito "seca", que acusa a fonte de estar caída. Duas
 * mesas trabalhando com disciplina seriam reportadas como quebradas.
 */

/** O `event_type` em `platform_events` onde cada mesa deixa rastro. */
export const TICK_EVENT_BY_SOURCE: Readonly<Record<string, string>> = {
  strat_dex:    "strat_dex_tick",
  strat_ai:     "strat_ai_tick",
  strat_record: "strat_record_tick",
  ullr_launch:  "ullr_tick",
  arbiter:      "arb_window_empty",
  arbiter2:     "arb2_window_empty",
  arbiter2_3x:  "arb2_window_empty",
  arbiter2_5x:  "arb2_window_empty",
};

/** Metadados crus de `platform_events` — jsonb, então tudo é `unknown`. */
type Meta = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Traduz o metadado cru de um tick para o formato comum de `DeskTick`.
 *
 * ⚠️ O PRIMEIRO CAMPO QUE EXISTIR VENCE, e a ordem é deliberada: `offered`
 * antes de `eligible` antes de `candidates`. Uma fonte que grave dois deles
 * está dizendo a mesma coisa duas vezes, e o primeiro é o nome canônico.
 */
export function deskTickFrom(eventType: string, meta: Meta | null | undefined): DeskTick {
  const m = meta ?? {};
  const erro = typeof m.erro === "string" ? m.erro : null;

  /**
   * ⚠️ A JANELA DO ARBITER NÃO É SECA — ela é uma conta que não fecha.
   *
   * `arb_window_empty` grava `why: "piso de custo acima do teto de
   * credibilidade"`. Sem trazer esse texto, a mesa cairia em "seca sem motivo
   * reportado", que aponta para fonte caída — e a fonte está ótima: são as
   * PREMISSAS que tornam a janela vazia por aritmética (piso 0,55% > teto
   * 0,30%). Confundir os dois manda consertar a coleta em vez do custo.
   */
  const whyBruto = typeof m.why === "string" ? m.why : null;

  /**
   * ⚠️ E `arb2_window_empty` NÃO GRAVA `why` — só `ceil_pct` e `floor_pct`.
   *
   * Achado ao conferir a rota contra o banco de verdade: a arbiter (1×) saía
   * como seca COM motivo e as três variantes 2.0 como seca SEM motivo, que é o
   * veredito que acusa a fonte de estar caída. A causa das quatro é idêntica —
   * o piso de custo acima do teto de credibilidade — e as duas colunas que
   * provam isso estavam no metadado das quatro.
   *
   * ⚠️ A DERIVAÇÃO SÓ ACONTECE QUANDO A ARITMÉTICA FECHA. Se `floor <= ceil` a
   * janela não é vazia por conta, e inventar um motivo aqui seria pior que não
   * ter nenhum: colocaria uma explicação plausível em cima de uma causa
   * desconhecida, e ninguém procuraria a de verdade.
   */
  const piso = num(m.floor_pct), teto = num(m.ceil_pct);
  const why = whyBruto ?? (piso != null && teto != null && piso > teto
    ? `piso de custo ${piso}% acima do teto de credibilidade ${teto}% — janela vazia por aritmética`
    : null);

  const skipped = Array.isArray(m.skipped)
    ? (m.skipped as Array<{ symbol?: unknown; reason?: unknown }>).map((s) => ({
        symbol: String(s?.symbol ?? "—"), reason: String(s?.reason ?? "—"),
      }))
    : why
      ? [{ symbol: "—", reason: why }]
      : null;

  return {
    offered: num(m.offered) ?? num(m.eligible) ?? num(m.candidates),
    taken:   num(m.taken)   ?? num(m.fired)    ?? num(m.logged),
    vetoedByRecord: num(m.vetoedByRecord),
    skipped,
    erro: erro ?? (eventType.endsWith("_error") ? "tick registrou erro" : null),
    desk: typeof m.source === "string" ? m.source : null,
  };
}
