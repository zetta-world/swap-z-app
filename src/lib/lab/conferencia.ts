/**
 * A CONFERÊNCIA DO LIVRO — a tela e o `lab_results` contam a mesma história?
 *
 * ⚠️ POR QUE ISTO EXISTE (Fase 10, 11/08).
 *
 * A auditoria cruzou `lab_strategies.status` com o veredito da última rodada
 * `ok` de cada estratégia. **Onze das 28 linhas discordavam**, e em oito delas
 * a tela contava a versão mais favorável:
 *
 *   · `grid_bot`  — perdeu 54,19% do capital, e a tela dizia "não medida"
 *   · `momentum_rotation` — perdeu 3,01% por período, e a tela dizia o mesmo
 *   · `dex_cex_arb` — o livro tinha gravado MORTA dois dias antes
 *   · `amm_lp` — o EMPATE mais caro da Fase 8, invisível
 *
 * A causa raiz foi vocabulário curto (ver `LabStatus`), e ela foi corrigida.
 * Mas vocabulário certo não impede a próxima drenagem: o registro é escrito à
 * mão, o livro é escrito por medição, e **eles vão divergir de novo** — a
 * pergunta é se alguém vai perceber.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ E POR QUE ELE VAI PARA A TELA, E NÃO SÓ PARA O TESTE.
 *
 * Um teste unitário conferiria o registro contra um livro FALSO, montado no
 * próprio teste. Isso pega erro de código e não pega o que aconteceu aqui:
 * o código estava certo e o DADO apodreceu. A conferência só vale contra o
 * livro de verdade, e o livro de verdade só existe em tempo de execução.
 *
 * Por isso esta função é PURA e recebe o livro como argumento: o teste prova
 * a classificação, a rota fornece o dado, e a tela mostra o resultado. É a
 * invariante nº 14 — "um controle que ninguém lê não é um controle" — aplicada
 * ao próprio detector.
 */

import { type LabStatus, type LabStrategy, STATUS_COM_VEREDITO } from "./registry";

/**
 * O que o livro sabe sobre uma estratégia. Vem de `lab_runs` + `lab_results`.
 *
 * ⚠️ `rodadasOk` conta rodadas que FECHARAM bem. Rodada em `rodando` e rodada
 * `falhou` não contam como parcela — senão "tentei medir e explodiu" viraria
 * prova de medição, que é a inversão exata que esta tabela existe para evitar.
 */
export interface LivroDaEstrategia {
  slug: string;
  /** Rodadas com `status = 'ok'`. */
  rodadasOk: number;
  /** Veredito da rodada `ok` MAIS RECENTE. `null` = nenhuma fechou. */
  ultimoVeredito: LabStatus | null;
  /** Rodadas presas em `rodando` — começaram e nunca terminaram. */
  penduradas: number;
}

export type TipoDiscordancia =
  /** O registro afirma medição e o livro não tem parcela nenhuma. */
  | "veredito_sem_parcela"
  /** O livro fechou uma rodada com veredito diferente do que a tela pinta. */
  | "livro_discorda"
  /** Há rodada `ok` no livro e o registro insiste em "não medida". */
  | "medida_mas_cinza"
  /** `nao_mensuravel` sem o porquê escrito — o novo esconderijo. */
  | "sem_motivo"
  /** Rodada FECHADA que gravou "não medida" — um estado que ela não pode ter. */
  | "livro_incoerente"
  /** Rodada que começou e nunca fechou. */
  | "rodada_pendurada";

export interface Discordancia {
  slug: string;
  nome: string;
  tipo: TipoDiscordancia;
  /** O que a tela diz hoje. */
  tela: LabStatus;
  /** O que o livro diz — `null` quando ele não diz nada. */
  livro: LabStatus | null;
  /** Uma frase, em português, do que está errado. */
  o_que: string;
  /** Uma frase do que fazer. Discordância sem ação vira decoração. */
  fazer_o_que: string;
}

/** Rótulo curto de cada estado, para as frases abaixo lerem como português. */
const COMO_SE_LE: Record<LabStatus, string> = {
  verde:          "medida e positiva",
  morta:          "medida e negativa",
  empate:         "medida, e sem vantagem distinguível",
  inconclusiva:   "rodou sem dar para concluir",
  cinza:          "não medida",
  nao_mensuravel: "não mensurável com fonte que alcançamos",
};

/**
 * Cruza o registro com o livro e devolve TODA discordância encontrada.
 *
 * ⚠️ ORDEM IMPORTA: as regras são checadas da mais grave para a menos, e cada
 * estratégia produz NO MÁXIMO uma discordância de estado — senão `grid_bot`
 * apareceria três vezes na tela dizendo a mesma coisa de três jeitos, e uma
 * lista que repete é uma lista que ninguém termina de ler. A rodada pendurada
 * é a exceção: ela é ortogonal ao estado e sai como linha própria.
 */
export function conferirLivro(
  registro: readonly LabStrategy[],
  livro: readonly LivroDaEstrategia[],
): Discordancia[] {
  const porSlug = new Map(livro.map((l) => [l.slug, l]));
  const achados: Discordancia[] = [];

  for (const s of registro) {
    const l = porSlug.get(s.slug);
    const rodadasOk = l?.rodadasOk ?? 0;
    const ultimo    = l?.ultimoVeredito ?? null;
    const afirma    = STATUS_COM_VEREDITO.includes(s.status);

    if (s.status === "nao_mensuravel" && !(s.notMeasurableWhy ?? "").trim()) {
      achados.push({
        slug: s.slug, nome: s.name, tipo: "sem_motivo",
        tela: s.status, livro: ultimo,
        o_que: "marcada como não mensurável sem o motivo escrito",
        fazer_o_que: "escrever `notMeasurableWhy` no registro — \"não dá\" não é motivo, "
          + "\"a fonte não publica o dado por endereço\" é",
      });
    } else if (afirma && rodadasOk === 0 && !(s.measuredElsewhere ?? "").trim()) {
      /**
       * ⚠️ ESTA É A REGRA QUE PEGA O VEREDITO INVENTADO. Um selo VERDE sem
       * nenhuma rodada fechada no livro é uma afirmação sem parcela — que é a
       * invariante nº 6 no seu caso mais direto. `measuredElsewhere` DISPENSA
       * a parcela, mas não em silêncio: exige dizer onde ela mora.
       */
      achados.push({
        slug: s.slug, nome: s.name, tipo: "veredito_sem_parcela",
        tela: s.status, livro: null,
        o_que: `a tela diz "${COMO_SE_LE[s.status]}" e o livro não tem nenhuma rodada fechada`,
        fazer_o_que: "medir aqui, ou declarar em `measuredElsewhere` onde a medição vive",
      });
    } else if (s.status === "cinza" && rodadasOk > 0) {
      /**
       * ⚠️ O CASO DO `grid_bot`. A estratégia RODOU, e a tela diz "não medida"
       * — o estado que não pede nada de ninguém. Foi assim que uma mesa que
       * torrou metade do capital ficou parecendo uma que ninguém abriu.
       */
      achados.push({
        slug: s.slug, nome: s.name, tipo: "medida_mas_cinza",
        tela: s.status, livro: ultimo,
        o_que: `a tela diz "não medida" e o livro tem ${rodadasOk} rodada(s) fechada(s)`
          + (ultimo ? `, a última com veredito ${ultimo.toUpperCase()}` : ""),
        fazer_o_que: ultimo
          ? `corrigir o registro para ${ultimo.toUpperCase()}, ou escrever por que ele discorda`
          : "ler a rodada e dar um estado ao registro",
      });
    } else if (rodadasOk > 0 && ultimo === "cinza") {
      /**
       * ⚠️ UMA RODADA QUE FECHOU NÃO PODE TER GRAVADO "NÃO MEDIDA".
       *
       * Isto não é discordância entre duas leituras — é uma linha do livro
       * afirmando algo impossível sobre si mesma, e por isso tem tipo próprio:
       * dizer "a tela discorda do livro" sugeriria que uma das duas está certa.
       *
       * Hoje ele acusa seis linhas gravadas ANTES da Fase 10, quando `cinza`
       * era o único destino para "empate", "inconclusivo" e "perdeu dinheiro
       * mas bateu o índice". Os números e os textos delas estão corretos — só
       * o rótulo não tinha para onde ir. Remedir regrava a mesma conta com a
       * palavra certa; reescrever a coluna à mão seria inventar veredito que
       * medição nenhuma produziu.
       *
       * ⚠️ E ELE NÃO É SÓ TRANSITÓRIO. Qualquer defeito futuro que grave
       * `cinza` numa rodada `ok` cai aqui — é uma trava permanente contra a
       * classe inteira, não a limpeza de uma vez.
       */
      achados.push({
        slug: s.slug, nome: s.name, tipo: "livro_incoerente",
        tela: s.status, livro: ultimo,
        o_que: `a última rodada FECHOU e gravou "não medida" — estado que rodada `
          + "concluída não pode ter (linha anterior à Fase 10)",
        fazer_o_que: "remedir: a conta é a mesma e o veredito sai com a palavra certa",
      });
    } else if (ultimo && afirma && ultimo !== s.status
               && !(s.discordaDoLivroPorque ?? "").trim()) {
      /**
       * ⚠️ DISCORDAR NÃO É NECESSARIAMENTE ERRO DO REGISTRO.
       *
       * `carteira_verde` é o exemplo vivo: o livro gravou `cinza` e o dono leu
       * a mesma rodada como reprovação da hipótese, com meia página de motivo.
       * Quem estava errado era o resumo automático, não a leitura. Por isso o
       * texto oferece os DOIS caminhos — remedir com o veredito corrigido, ou
       * escrever por que o registro discorda de propósito.
       *
       * ⚠️ E ATÉ 14/08 O SEGUNDO CAMINHO NÃO EXISTIA. O texto mandava escrever
       * a discordância e não havia ONDE — nenhum campo a recebia. Resultado: uma
       * discordância pensada e uma esquecida acusavam igual, para sempre, e as
       * duas viravam ruído permanente na lista. Um alarme que não pode ser
       * respondido é um alarme que se aprende a ignorar, e aí ele deixa de valer
       * para a linha que importa.
       *
       * `discordaDoLivroPorque` é esse lugar. Ele dispensa SÓ este tipo: veredito
       * sem parcela, rodada pendurada e livro incoerente continuam acusando,
       * porque nenhum deles é questão de leitura.
       */
      achados.push({
        slug: s.slug, nome: s.name, tipo: "livro_discorda",
        tela: s.status, livro: ultimo,
        o_que: `a tela diz "${COMO_SE_LE[s.status]}" e a última rodada gravou `
          + `"${COMO_SE_LE[ultimo]}"`,
        fazer_o_que: "remedir para o livro alcançar o registro, ou corrigir o registro "
          + "para o livro — e se a discordância for de propósito, escrevê-la",
      });
    }

    if (l && l.penduradas > 0) {
      achados.push({
        slug: s.slug, nome: s.name, tipo: "rodada_pendurada",
        tela: s.status, livro: ultimo,
        o_que: `${l.penduradas} rodada(s) começaram e nunca fecharam`,
        fazer_o_que: "conferir se a medição morreu no meio — rodada pendurada não é parcela, "
          + "e o resultado dela não está em lugar nenhum",
      });
    }
  }
  return achados;
}

/**
 * O resumo de uma linha, para o topo do painel.
 *
 * ⚠️ Devolve string vazia quando não há nada — e a tela NÃO deve inventar um
 * "✅ tudo confere" a partir disso. Ausência de discordância entre registro e
 * livro não é ausência de problema: as duas fontes podem estar erradas juntas.
 * O detector prova consistência, nunca correção.
 */
export function resumoDaConferencia(achados: readonly Discordancia[]): string {
  if (achados.length === 0) return "";
  const n = achados.length;
  return `${n} ${n === 1 ? "discordância" : "discordâncias"} entre a tela e o livro`;
}
