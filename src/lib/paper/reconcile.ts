/**
 * RECONCILIAÇÃO DAS CARTEIRAS DE PAPEL — o capital que sumia em silêncio.
 *
 * O QUE FOI ENCONTRADO (01/08, ao zerar o Setor A):
 *
 * Quatorze das vinte carteiras de paper haviam perdido entre US$450 e US$1.000
 * de capital FANTASMA — dinheiro debitado que nunca voltou. Grok e Mistral
 * estavam literalmente em **$0,00**.
 *
 * E o pior não é o número: é que isso NÃO APARECIA EM LUGAR NENHUM. O painel
 * mostra `patrimônio = inicial + realizado + não-realizado`, que continuava
 * bonito (MÍMIR "$999", VÖLUNDR "$996"). Mas quem decide se uma mesa consegue
 * ABRIR uma posição é o `cash_usd`, e ele estava em $49 e $98.
 *
 * O efeito é brutal e invisível: `sizePosition` devolve 0 abaixo de
 * `MIN_CASH_USD`, então as mesas simplesmente PARAM de operar. Não há erro, não
 * há alerta, não há linha vermelha — elas ficam quietas, e quem olha conclui
 * "não apareceu setup". Parte das amostras minúsculas que o dono estranhou
 * (4, 10, 10 trades) é isso: as mesas não estavam paradas por disciplina,
 * estavam sem dinheiro.
 *
 * CAUSA RAIZ (encontrada e corrigida no mesmo dia — ver `paper/engine.ts`):
 * dois bugs se compondo. O conjunto de dedup vinha truncado em 1.000 linhas
 * pelo limite padrão do PostgREST, então as mesas tentavam reabrir posições que
 * já tinham; e o `insert` era embrulhado num `try/catch` que NUNCA disparava,
 * porque o cliente do Supabase resolve com `{ error }` em vez de lançar. A
 * violação de UNIQUE voltava calada e o caixa era debitado por posições que não
 * existiam. O MÍMIR estava com exatamente $950 a menos: dezenove lotes de $50.
 *
 * ESTE MÓDULO CONTINUA VALENDO, e é por isso que ele não foi apagado com o
 * conserto. Ele não depende de saber QUAL bug causa a fuga — só afirma que o
 * caixa tem de bater com os trades. Qualquer causa nova, ainda não imaginada,
 * aparece aqui no mesmo dia, em vez de ser descoberta por acaso semanas depois,
 * quando a amostra do experimento já foi comprometida.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { deskFor } from "@/lib/zion/desks";

/** Quanto de desvio ainda é arredondamento de ponto flutuante, e não fuga. */
export const DRIFT_TOLERANCE_USD = 0.5;

/**
 * ⚠️ MAIS APERTADA QUE A DO CAIXA, DE PROPÓSITO. O caixa tolera $0,50 porque
 * arredondamento de ponto flutuante em centenas de posições acumula. Este
 * contador é uma SOMA das mesmas linhas que o detector já leu — divergência
 * real aqui começa em centavos, e afrouxar esconderia justamente o caso
 * pequeno-e-crescente, que é como o de julho começou.
 */
export const REALIZED_TOLERANCE_USD = 0.01;

export interface WalletDrift {
  source: string;
  label: string;
  startingUsd: number;
  /** O caixa que a carteira DIZ ter. */
  cashUsd: number;
  /** O caixa que ela DEVERIA ter: inicial − preso em aberto + P&L realizado. */
  expectedUsd: number;
  /** Negativo = capital sumiu. */
  driftUsd: number;
  /** A mesa ainda consegue abrir posição, ou já está sem dinheiro? */
  starved: boolean;
  /**
   * A mesa está APOSENTADA?
   *
   * Distinção que a primeira versão não fazia, e sem ela a verificação ficaria
   * vermelha para sempre: treze carteiras de mesas aposentadas carregam a
   * cicatriz do vazamento antigo, já explicado e corrigido na origem. Elas não
   * podem vazar mais — não operam.
   *
   * Vermelho permanente é a mesma armadilha do alarme falso: o operador aprende
   * a ignorar. O desvio delas continua VISÍVEL (é a evidência histórica), mas
   * não reprova, porque a pergunta da bancada é "está vazando AGORA?".
   */
  retired: boolean;
  /**
   * A coluna `realized_pnl_usd` menos o P&L calculado das posições vivas.
   * Zero = as duas fontes concordam. Diferente de zero = contador velho, e o
   * painel (que lê a coluna) está mostrando outra coisa que a conferência.
   */
  realizedDriftUsd: number;
  /** O P&L que as posições não-arquivadas realmente somam. */
  computedRealizedUsd: number;
  /** O que a coluna denormalizada guarda. Ausente = não foi conferido. */
  storedRealizedUsd?: number;
  /**
   * ⚠️ OS CONTADORES `wins`/`losses` — a metade que ficou de fora (29/08).
   *
   * `realizedDriftUsd` existe desde 05/08 e confere o P&L. Os CONTADORES da
   * mesma linha nunca foram conferidos por nada — e foram justamente eles que
   * apareceram errados no digest do Telegram: `repairWallets` realinha
   * `realized_pnl_usd` ao livro vivo e **não toca** em `wins`/`losses`, que
   * seguem com o total de antes do arquivamento.
   *
   * Em 29/08 o Mistral tinha 44/38 na conta e 30/12 no livro vivo: dezessete
   * pontos de diferença na taxa de acerto, na mesma linha do painel.
   */
  decididosNaConta: number;
  decididosNoLivro: number;
  /** Positivo = a conta conta MAIS decisões que o livro vivo. */
  desvioDeContador: number;
  /**
   * ⚠️ A DIVERGÊNCIA É ESPERADA QUANDO HÁ POSIÇÃO ARQUIVADA, e sem esta
   * distinção o detector seria alarme falso permanente: a conta guarda a
   * história anterior ao arquivamento DE PROPÓSITO (ver `admin/api/paper`,
   * 13/08). O que merece atenção é a carteira que diverge SEM ter arquivado
   * nada — aí a conta e o livro descrevem a mesma janela e discordam.
   */
  temArquivadas: boolean;
}

/**
 * A conta é simples e é justamente por isso que ela pega: o caixa de uma
 * carteira de paper só pode ser o capital inicial, menos o que está preso em
 * posição aberta, mais o que já foi realizado. Qualquer outra coisa é dinheiro
 * que apareceu ou sumiu sem trade.
 */
export function computeDrift(
  a: { source: string; label: string; startingUsd: number; cashUsd: number;
       /** A coluna denormalizada. Opcional: quem não passa, não é conferido. */
       storedRealizedUsd?: number;
       /** Os contadores da conta. Ausentes contam como 0 decisões. */
       storedWins?: number; storedLosses?: number },
  openCostUsd: number,
  realizedPnlUsd: number,
  minCashUsd = 25,
  /** O que o LIVRO VIVO diz: alvos e stops de posições não arquivadas. */
  livro: { wins: number; losses: number; arquivadas: number } = { wins: 0, losses: 0, arquivadas: 0 },
): WalletDrift {
  const expectedUsd = a.startingUsd - openCostUsd + realizedPnlUsd;
  return {
    ...a, expectedUsd,
    /**
     * ⚠️ O SEGUNDO INVARIANTE, que faltava (05/08).
     *
     * Esta função sempre recebeu o P&L CALCULADO das posições não-arquivadas —
     * e está certa nisso. Só que `paper_accounts.realized_pnl_usd` guarda o
     * mesmo número denormalizado, e é ELE que o painel lê.
     *
     * Duas fontes para a mesma grandeza, e elas divergiram: o `radar` tem as
     * 89 posições arquivadas (logo, P&L calculado = 0) e a coluna guardada
     * em −$13,37. Foi um reset parcial — arquivou as posições e restaurou o
     * caixa, mas deixou o contador para trás.
     *
     * A conferência de caixa não pegava porque ela usa o calculado, que estava
     * certo. O defeito só aparece quando se comparam as DUAS.
     *
     * É a mesma família da mediana com duas implementações e do patrimônio
     * exibido sem o caixa: número derivado em dois lugares vira dois números.
     */
    realizedDriftUsd: a.storedRealizedUsd == null
      ? 0
      : Number((a.storedRealizedUsd - realizedPnlUsd).toFixed(2)),
    computedRealizedUsd: realizedPnlUsd,
    driftUsd: a.cashUsd - expectedUsd,
    // Sem caixa acima do piso, `sizePosition` devolve 0 e a mesa para de
    // operar sem dizer nada a ninguém.
    starved: a.cashUsd < minCashUsd,
    // Mesa fora de `desks.ts` é tratada como VIVA: o desconhecido não ganha
    // dispensa. Se apareceu uma carteira que ninguém declarou, ela merece
    // atenção, não silêncio.
    retired: deskFor(a.source)?.status === "valhalla",
    decididosNaConta: (Number(a.storedWins) || 0) + (Number(a.storedLosses) || 0),
    decididosNoLivro: livro.wins + livro.losses,
    desvioDeContador: ((Number(a.storedWins) || 0) + (Number(a.storedLosses) || 0))
      - (livro.wins + livro.losses),
    temArquivadas: livro.arquivadas > 0,
  };
}

/** Só o que importa: quem está fora da tolerância, pior primeiro. */
export function significantDrifts(all: WalletDrift[], tolerance = DRIFT_TOLERANCE_USD): WalletDrift[] {
  return all
    .filter((d) => Math.abs(d.driftUsd) > tolerance)
    .sort((x, y) => x.driftUsd - y.driftUsd);
}

/**
 * Carteiras cujo CONTADOR de P&L discorda das posições.
 *
 * Separado do desvio de caixa de propósito: são sintomas diferentes. Caixa
 * errado é dinheiro que apareceu ou sumiu; contador errado é a mesma verdade
 * escrita duas vezes com valores diferentes — e é o segundo que faz duas telas
 * mostrarem números distintos para a mesma carteira.
 */
export function realizedDrifts(all: WalletDrift[], tolerance = 0.01): WalletDrift[] {
  return all
    .filter((d) => Math.abs(d.realizedDriftUsd) > tolerance)
    .sort((x, y) => Math.abs(y.realizedDriftUsd) - Math.abs(x.realizedDriftUsd));
}

/**
 * Carteiras cujos CONTADORES discordam do livro vivo — a metade que faltava.
 *
 * ⚠️ POR QUE SEPARADO DE `realizedDrifts` (29/08). Aquele confere o P&L; este
 * confere `wins`/`losses`. São a mesma família — "a mesma verdade escrita duas
 * vezes com valores diferentes" — mas com causas e consequências distintas:
 * o P&L errado mostra dinheiro que não existe, o contador errado mostra uma
 * TAXA DE ACERTO que não existe. Foi o segundo que fez o digest do Telegram
 * anunciar 54% para uma mesa de 71%, e 100% para uma mesa parada há um mês.
 *
 * ⚠️ E `semArquivo` É O QUE SEPARA CICATRIZ DE FERIDA. Com posição arquivada, a
 * divergência é o desenho: a conta guarda a história e o livro guarda a rodada.
 * SEM arquivo, os dois falam da mesma janela — e discordar aí é defeito novo.
 */
export function contadorDrifts(
  all: WalletDrift[],
  opts: { semArquivo?: boolean } = {},
): WalletDrift[] {
  return all
    .filter((d) => d.desvioDeContador !== 0)
    .filter((d) => (opts.semArquivo ? !d.temArquivadas : true))
    .sort((x, y) => Math.abs(y.desvioDeContador) - Math.abs(x.desvioDeContador));
}

/** Carteiras que já não conseguem abrir posição — silêncio por falta de caixa. */
export function starvedWallets(all: WalletDrift[]): WalletDrift[] {
  return all.filter((d) => d.starved);
}

/**
 * O que REPROVA: só mesa viva. Uma aposentada não opera, então não vaza — o
 * desvio dela é cicatriz, não ferida aberta.
 */
export function liveDrifts(all: WalletDrift[], tolerance = DRIFT_TOLERANCE_USD): WalletDrift[] {
  return significantDrifts(all, tolerance).filter((d) => !d.retired);
}

/** O que aparece como CONTEXTO: a cicatriz do vazamento antigo. */
export function retiredDrifts(all: WalletDrift[], tolerance = DRIFT_TOLERANCE_USD): WalletDrift[] {
  return significantDrifts(all, tolerance).filter((d) => d.retired);
}

export interface RepairEntry { source: string; label: string; from: number; to: number; deltaUsd: number }

/**
 * DEVOLVE às carteiras vivas o capital que o vazamento levou.
 *
 * ⚠️ POR QUE ISTO É UM BOTÃO, E NUNCA UM CONSERTO AUTOMÁTICO.
 *
 * O bug da origem foi corrigido (`paper/engine.ts`), mas correção não devolve
 * dinheiro: o Radar ficou com $51 de $1.000, e com $51 ele não abre posição
 * nenhuma. A mesa continua viva no papel e morta na prática — e some do
 * experimento em silêncio, que é exatamente o defeito que a reconciliação
 * existe para pegar.
 *
 * Reparar automaticamente dentro da própria verificação seria destruí-la. Um
 * vazamento NOVO seria zerado a cada rodada e o detector nunca mais acusaria
 * nada: ele passaria a esconder o que foi construído para revelar. Por isso o
 * reparo é um ato do operador, deixa registro, e a bancada continua conferindo
 * DEPOIS — se o desvio voltar a aparecer, é fuga nova, não a cicatriz velha.
 *
 * Só mexe em mesa VIVA e só quando falta dinheiro. Caixa a MAIS não é reparado:
 * dinheiro que apareceu do nada é um bug diferente, provavelmente pior, e
 * "corrigir" tirando o excesso apagaria a única pista dele.
 */
export function planRepair(all: WalletDrift[], tolerance = DRIFT_TOLERANCE_USD): RepairEntry[] {
  return all
    .filter((d) => !d.retired && d.driftUsd < -tolerance)
    .map((d) => ({
      source: d.source, label: d.label,
      from: d.cashUsd, to: d.expectedUsd, deltaUsd: d.expectedUsd - d.cashUsd,
    }))
    .sort((a, b) => b.deltaUsd - a.deltaUsd);
}

/**
 * O CONTADOR DESNORMALIZADO CONTRA AS POSIÇÕES — o reparo que faltava.
 *
 * ⚠️ ACHADO NA AUDITORIA DE 18/08: **13 das 23 carteiras** têm
 * `realized_pnl_usd` divergindo da soma das próprias posições, até $13,37 no
 * radar. E o mais desconfortável é que o repo JÁ SABIA — `realizedDriftUsd`
 * existe desde 05/08, `realizedDrifts()` reporta, e nada nunca consertou.
 * Defeito medido e não resolvido é pior que defeito desconhecido: alguém já
 * pagou o custo de achar, e o painel segue lendo o número errado.
 *
 * ⚠️ QUAL DOS DOIS É A VERDADE. `reconcileWallets` soma apenas posições NÃO
 * arquivadas, e `reset.ts` zera `realized_pnl_usd` ao arquivar uma rodada.
 * As duas coisas juntas fixam o significado da coluna: **P&L realizado da
 * RODADA VIVA**. Logo o calculado está certo e o guardado está velho —
 * tipicamente um reset que arquivou as posições e deixou o contador para trás.
 *
 * ⚠️ POR QUE ESTE REPARO ANDA NOS DOIS SENTIDOS, ao contrário do caixa. No
 * caixa, sobra é bug DIFERENTE (dinheiro do nada) e consertar apagaria a
 * pista — por isso só o déficit é devolvido. Aqui não há dinheiro: é um espelho
 * de linhas que já existem no ledger. Divergência para cima e para baixo têm a
 * MESMA causa (contador que não acompanhou o arquivamento), então corrigir só
 * um lado deixaria metade da mentira na tela.
 *
 * ⚠️ MESA APOSENTADA FICA DE FORA, pela mesma regra do caixa: o número dela é
 * cicatriz, e reescrever cicatriz apaga o registro do vazamento de julho.
 */
export function planRealizedRepair(
  all: WalletDrift[], tolerance = REALIZED_TOLERANCE_USD,
): RepairEntry[] {
  return all
    .filter((d) => !d.retired && Math.abs(d.realizedDriftUsd) > tolerance)
    .map((d) => ({
      source: d.source, label: d.label,
      from: d.storedRealizedUsd ?? 0,
      to: d.computedRealizedUsd,
      deltaUsd: d.computedRealizedUsd - (d.storedRealizedUsd ?? 0),
    }))
    .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
}

/**
 * Lê o estado real e reconcilia. Best-effort: sem banco devolve lista vazia em
 * vez de derrubar quem chamou.
 */
export async function reconcileWallets(minCashUsd = 25): Promise<WalletDrift[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const [{ data: accounts }, positions] = await Promise.all([
    db.from("paper_accounts").select("id, source, label, starting_usd, cash_usd, realized_pnl_usd, wins, losses"),
    // ⚠️ SÓ AS NÃO-ARQUIVADAS (correção 03/08, achada pela própria bancada).
    //
    // A primeira versão somava o P&L de TODAS as posições, inclusive as
    // arquivadas. Quando o Setor A foi zerado — caixa de volta a $1.000,
    // `realized_pnl_usd` a zero, posições arquivadas — o P&L antigo continuava
    // entrando na conta do "esperado", e as três mesas apareceram com desvio de
    // +$3,72, +$3,75 e +$0,58: exatamente o espelho das perdas arquivadas.
    //
    // Ou seja: a verificação acusava fuga onde não havia, e num caso que vai se
    // repetir toda vez que um ledger for zerado. Alarme falso treina o operador
    // a ignorar o alarme verdadeiro — foi eu mesmo que escrevi isso, e violei na
    // linha seguinte.
    /**
     * ⚠️ PAGINADO (03/08, segunda correção do mesmo dia — e a mais cara).
     *
     * A versão anterior pedia `.limit(20000)` e achava que isso bastava. NÃO
     * BASTA: `limit` é um pedido do cliente, e o PostgREST tem um teto PRÓPRIO
     * de linhas no servidor. Pedir 20.000 devolve as primeiras ~1.000, sem
     * erro, sem aviso, e sem ordem definida.
     *
     * O estrago foi real e mensurável. Com ~2.100 posições vivas, a leitura
     * voltou truncada; as carteiras cujas posições ficaram FORA da janela
     * apareceram com zero posições, logo `esperado = capital inicial`, logo um
     * déficit fantasma — e o reparo pagou US$ 1.429,09 que ninguém devia. O
     * VÖLUNDR estava com US$ 843,74, que era exatamente o valor correto, e
     * recebeu US$ 156,26 para "consertar".
     *
     * O que torna isto pior que um bug comum: o cabeçalho DESTE arquivo
     * documenta essa mesma armadilha como causa raiz do vazamento original, e
     * `selectAllRows` existe no repositório exatamente para ela. Eu escrevi a
     * explicação e usei `limit` na linha seguinte, dentro do detector do
     * problema. Uma verificação que lê dado truncado não é uma verificação
     * frouxa — ela INVENTA os números que reporta.
     */
    selectAllRows<{ account_id: string; status: string; cost_usd: number | null; pnl_usd: number | null; exit_reason: string | null }>(
      // `exit_reason` entra para o contador de wins/losses do livro vivo (29/08).
      (from, to) => db.from("paper_positions").select("account_id, status, cost_usd, pnl_usd, exit_reason")
        .is("archived_at", null).order("id", { ascending: true }).range(from, to),
    ),
  ]);
  if (!accounts) return [];

  /**
   * ⚠️ LEITURA SEPARADA, E SÓ DE UMA COLUNA. Saber QUEM tem posição arquivada é
   * o que separa cicatriz de ferida no `contadorDrifts` — sem isso o detector
   * acusaria como defeito a divergência que o arquivamento cria de propósito.
   *
   * Vai em outra consulta em vez de tirar o filtro da leitura acima: aquele
   * filtro é a correção de 03/08 e mexer nele para ganhar uma contagem
   * arriscaria o cálculo do P&L, que é o que realmente importa ali.
   */
  const arquivadasPorConta = new Map<string, number>();
  for (const r of await selectAllRows<{ account_id: string }>(
    (from, to) => db.from("paper_positions").select("account_id")
      .not("archived_at", "is", null).order("id", { ascending: true }).range(from, to),
  )) {
    const id = String(r.account_id);
    arquivadasPorConta.set(id, (arquivadasPorConta.get(id) ?? 0) + 1);
  }

  const openBy = new Map<string, number>();
  const pnlBy = new Map<string, number>();
  const livroBy = new Map<string, { wins: number; losses: number }>();
  for (const p of positions ?? []) {
    const id = String((p as { account_id: string }).account_id);
    const row = p as { status: string; cost_usd: number | null; pnl_usd: number | null; exit_reason: string | null };
    if (row.status === "open") openBy.set(id, (openBy.get(id) ?? 0) + Number(row.cost_usd ?? 0));
    pnlBy.set(id, (pnlBy.get(id) ?? 0) + Number(row.pnl_usd ?? 0));
    // ⚠️ `expired` não entra: não é vitória nem derrota. É a mesma regra do
    // flywheel, e é o que faz a contagem daqui ser comparável à da conta.
    if (row.exit_reason === "target" || row.exit_reason === "stop") {
      const v = livroBy.get(id) ?? { wins: 0, losses: 0 };
      if (row.exit_reason === "target") v.wins++; else v.losses++;
      livroBy.set(id, v);
    }
  }

  return accounts.map((a) => {
    const row = a as { id: string; source: string; label: string | null; starting_usd: number; cash_usd: number; realized_pnl_usd: number; wins: number; losses: number };
    const id = String(row.id);
    const v = livroBy.get(id) ?? { wins: 0, losses: 0 };
    return computeDrift(
      {
        source: row.source, label: row.label ?? row.source,
        startingUsd: Number(row.starting_usd), cashUsd: Number(row.cash_usd),
        storedRealizedUsd: Number(row.realized_pnl_usd),
        storedWins: Number(row.wins), storedLosses: Number(row.losses),
      },
      openBy.get(id) ?? 0,
      pnlBy.get(id) ?? 0,
      minCashUsd,
      { wins: v.wins, losses: v.losses, arquivadas: arquivadasPorConta.get(id) ?? 0 },
    );
  });
}

/**
 * Executa o reparo e registra o que fez.
 *
 * O registro não é burocracia: sem ele, um desvio que reaparecesse amanhã seria
 * indistinguível do de hoje, e a pergunta que importa — "vazou DE NOVO?" — não
 * teria resposta. Com ele, a bancada mostra "reparado em tal data" ao lado, e
 * qualquer coisa nova aparece contra esse marco.
 */
export async function repairWallets(): Promise<{ repaired: RepairEntry[]; realizedFixed: RepairEntry[]; failed: string[] }> {
  const db = getSupabaseAdmin();
  if (!db) return { repaired: [], realizedFixed: [], failed: [] };
  const estado = await reconcileWallets();
  const plan = planRepair(estado);
  const repaired: RepairEntry[] = [], failed: string[] = [];

  /**
   * ⚠️ O CONTADOR É CONSERTADO NA MESMA PASSADA, e num `update` SEPARADO do
   * caixa. Juntar os dois campos num só `update` amarraria duas correções de
   * causas diferentes: uma carteira pode ter o caixa certo e o contador
   * errado (é o caso do `arbiter2` hoje), e um update conjunto ou mexeria no
   * que está certo ou deixaria de fora o que está errado.
   */
  const planRealized = planRealizedRepair(estado);
  const realizedFixed: RepairEntry[] = [];
  for (const e of planRealized) {
    const { error } = await db.from("paper_accounts")
      .update({ realized_pnl_usd: e.to }).eq("source", e.source);
    if (error) failed.push(`${e.source}:realized`); else realizedFixed.push(e);
  }

  for (const e of plan) {
    // Um `update` por carteira, e o erro é LIDO. O cliente do Supabase resolve
    // com `{ error }` em vez de lançar — foi assim que o vazamento original
    // passou calado, e repetir o mesmo padrão aqui seria cômico.
    const { error } = await db.from("paper_accounts")
      .update({ cash_usd: e.to }).eq("source", e.source);
    if (error) failed.push(e.source); else repaired.push(e);
  }

  if (repaired.length > 0 || realizedFixed.length > 0) {
    const total = repaired.reduce((s, e) => s + e.deltaUsd, 0);
    await db.from("admin_kv").upsert({
      key: "paper_repair:last",
      updated_at: new Date().toISOString(),
      value: JSON.stringify({
        at: new Date().toISOString(),
        totalUsd: Math.round(total * 100) / 100,
        entries: repaired.map((e) => ({ source: e.source, delta: Math.round(e.deltaUsd * 100) / 100 })),
        // ⚠️ Separado do caixa no registro: são reparos de causas distintas,
        // e somar os dois num total só esconderia qual deles aconteceu.
        realizados: realizedFixed.map((e) => ({ source: e.source, delta: Math.round(e.deltaUsd * 100) / 100 })),
      }),
    }, { onConflict: "key" });
  }
  return { repaired, realizedFixed, failed };
}

/** O marco do último reparo, para a bancada distinguir cicatriz de ferida nova. */
export async function lastRepair(): Promise<{ at: string; totalUsd: number } | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  const { data } = await db.from("admin_kv").select("value").eq("key", "paper_repair:last").maybeSingle();
  if (!data?.value) return null;
  try {
    const p = JSON.parse(String((data as { value: string }).value)) as { at: string; totalUsd: number };
    return p.at ? { at: p.at, totalUsd: Number(p.totalUsd) || 0 } : null;
  } catch { return null; }
}
