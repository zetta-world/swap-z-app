/**
 * O RELÓGIO DO DCA — a aritmética, em função pura.
 * (`docs/PLANO-DCA-AUTOMATICO.md`, fase D1)
 *
 * ⚠️⚠️ POR QUE ISTO É PURO E VEM ANTES DO CRON.
 *
 * Este módulo decide QUANDO comprar e QUANTO comprar. É caminho de dinheiro, e
 * não toca banco nem corretora — então dá para exercitar cada caso de borda com
 * um teste em vez de com o dinheiro de alguém.
 *
 * Foi assim que `lib/orders/plano.ts` pegou os sete valores impossíveis que a
 * tela do DCA aceitava (auditoria de 24/08, PR #347), e é barato repetir.
 *
 * ⚠️ TUDO EM UTC. Fuso com horário de verão faria um plano "diário" pular ou
 * repetir um dia duas vezes por ano, e o defeito apareceria seis meses depois
 * da entrega, num país só.
 */

export type Intervalo = "hourly" | "daily" | "weekly" | "monthly";

const MS: Record<Exclude<Intervalo, "monthly">, number> = {
  hourly: 3_600_000,
  daily:  86_400_000,
  weekly: 604_800_000,
};

/**
 * A próxima janela depois de `atualIso`.
 *
 * ⚠️⚠️ MÊS NÃO É OFFSET FIXO, e tratar como se fosse é a armadilha clássica.
 * 31/01 + 1 mês não é 31/02 — que não existe. Somar 30 dias também está
 * errado: faria o plano andar para trás no calendário todo mês.
 *
 * A regra aqui é a que as pessoas esperam: mesmo dia do mês seguinte, e quando
 * esse dia não existe, o ÚLTIMO dia do mês. 31/01 → 28/02 (ou 29 em bissexto).
 *
 * ⚠️ E NÃO "GRUDA" NO FIM DO MÊS. Depois de 31/01 → 28/02, o mês seguinte é
 * 28/03 e não 31/03: a data corrente é sempre a base. É uma escolha, e a
 * alternativa (voltar para o dia 31) exigiria guardar o dia original do plano.
 * Registrado para quem for mexer não achar que é descuido.
 */
export function proximaJanela(atualIso: string, intervalo: Intervalo): string {
  const t = Date.parse(atualIso);
  if (!Number.isFinite(t)) return atualIso;
  if (intervalo !== "monthly") return new Date(t + MS[intervalo]).toISOString();

  const d = new Date(t);
  const ano = d.getUTCFullYear();
  const mes = d.getUTCMonth();
  const dia = d.getUTCDate();
  // Dia 0 do mês seguinte = último dia do mês alvo.
  const ultimoDoAlvo = new Date(Date.UTC(ano, mes + 2, 0)).getUTCDate();
  const alvo = new Date(Date.UTC(
    ano, mes + 1, Math.min(dia, ultimoDoAlvo),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
  ));
  return alvo.toISOString();
}

/**
 * ⚠️ TETO DE JANELAS PROCESSADAS NUMA PASSADA.
 *
 * Um plano horário dormente por um ano tem ~8.760 janelas vencidas. Sem teto, a
 * passada tentaria gravar 8.760 linhas de `pulado` e estouraria o tempo da
 * função na Vercel — derrubando os planos dos OUTROS usuários junto.
 */
export const MAX_JANELAS_POR_PASSADA = 200;

export type MotivoEncerrar = "completo" | "orcamento_esgotado" | "conexao_expirada" | "pausado";
export type MotivoPulo = "janela_perdida";

export interface CicloPulado { ciclo: number; agendadoPara: string; motivo: MotivoPulo }

export type Decisao =
  | { acao: "esperar";  proximaEm: string }
  | { acao: "encerrar"; motivo: MotivoEncerrar; pular: CicloPulado[] }
  /**
   * ⚠️ Só registra as janelas perdidas e avança o relógio, SEM comprar.
   *
   * Acontece quando a passada bateu o `MAX_JANELAS_POR_PASSADA` antes de
   * alcançar a janela corrente: a janela em que paramos ainda é velha, e
   * comprar ali seria uma ordem num momento arbitrário. A próxima passada
   * continua de onde esta parou.
   */
  | { acao: "pular";    pular: CicloPulado[]; proximoRunAt: string }
  | { acao: "executar"; ciclo: number; agendadoPara: string; pular: CicloPulado[]; proximoRunAt: string };

export interface EstadoPlano {
  agoraIso:       string;
  nextRunAtIso:   string;
  intervalo:      Intervalo;
  ciclosFeitos:   number;
  ciclosPulados:  number;
  ciclosTotal:    number;
  status:         "ativo" | "pausado" | "completo" | "encerrado";
  /** `expires_at` da conexão. Plano não sobrevive à credencial. */
  conexaoExpiraIso: string;
}

/**
 * O que fazer com este plano AGORA.
 *
 * ⚠️⚠️ A REGRA DAS JANELAS PERDIDAS, e por que ela é assim.
 *
 * Se o cron ficou fora três dias, um plano diário tem TRÊS janelas vencidas.
 * Comprar as três de uma vez é gastar 3× o previsto num único preço — o oposto
 * exato do que DCA existe para fazer, e o jeito mais rápido de transformar uma
 * poupança em aposta.
 *
 * Então: as janelas vencidas são CONSUMIDAS (cada uma gasta um número de
 * ciclo, gravado como `pulado`), e só a ÚLTIMA delas executa.
 *
 * ⚠️ É a última, não a primeira, de propósito: comprar "referente a três dias
 * atrás" com o preço de hoje não é o que o dono pediu nem no valor nem na data.
 * A janela corrente é a única que significa "agora".
 *
 * ⚠️ E `pulado` ≠ `feito` ≠ `falhou`. Três estados, como `expired` ≠ win/loss
 * no flywheel. Somar os três daria um plano "completo" que comprou metade.
 */
export function decidirCiclo(e: EstadoPlano): Decisao {
  const agora = Date.parse(e.agoraIso);
  const expira = Date.parse(e.conexaoExpiraIso);

  if (e.status === "pausado")  return { acao: "encerrar", motivo: "pausado", pular: [] };
  if (e.status !== "ativo")    return { acao: "encerrar", motivo: "completo", pular: [] };
  // ⚠️ A credencial vence ANTES de qualquer conta: um plano vivo com conexão
  // morta é uma ordem que vai falhar na corretora e sujar o extrato.
  if (Number.isFinite(expira) && expira <= agora) {
    return { acao: "encerrar", motivo: "conexao_expirada", pular: [] };
  }

  const restantes = e.ciclosTotal - e.ciclosFeitos - e.ciclosPulados;
  if (restantes <= 0) return { acao: "encerrar", motivo: "completo", pular: [] };

  let janela = e.nextRunAtIso;
  let tJanela = Date.parse(janela);
  if (!Number.isFinite(tJanela) || !Number.isFinite(agora)) {
    // Data ilegível não pode virar "compra agora". Espera e deixa o registro.
    return { acao: "esperar", proximaEm: e.nextRunAtIso };
  }
  if (tJanela > agora) return { acao: "esperar", proximaEm: janela };

  /**
   * Anda pelas janelas vencidas. A cada volta, se a PRÓXIMA também já venceu,
   * a atual foi perdida; senão a atual é a que executa.
   */
  const pular: CicloPulado[] = [];
  let ciclo = e.ciclosFeitos + e.ciclosPulados + 1;

  for (;;) {
    const seguinte = proximaJanela(janela, e.intervalo);
    const tSeguinte = Date.parse(seguinte);
    const seguinteVencida = Number.isFinite(tSeguinte) && tSeguinte <= agora;

    /**
     * ⚠️⚠️ CHEGAMOS NA JANELA CORRENTE — e só ELA pode comprar.
     *
     * "Corrente" significa que a janela seguinte ainda é futura, ou seja, esta
     * janela tem no máximo um intervalo de idade. É a única definição de
     * "agora" que não depende de tolerância arbitrária.
     */
    if (!seguinteVencida) {
      return { acao: "executar", ciclo, agendadoPara: janela, pular, proximoRunAt: seguinte };
    }

    /**
     * ⚠️⚠️ OS CICLOS ACABARAM ANTES DE CHEGAR NA JANELA CORRENTE.
     *
     * Isto significa que o INTERVALO INTEIRO do plano já passou: um plano de 3
     * compras diárias, com o cron fora cinco semanas, tem as três janelas no
     * passado distante.
     *
     * A primeira versão deste código DISPARAVA a última mesmo assim, e o teste
     * pegou. Uma compra cinco semanas depois do plano ter terminado, num
     * momento que o dono não escolheu, não é DCA — é uma ordem a mercado
     * avulsa com o dinheiro de uma poupança. Encerra, e diz que encerrou.
     */
    if (pular.length + 1 >= restantes) {
      pular.push({ ciclo, agendadoPara: janela, motivo: "janela_perdida" });
      return { acao: "encerrar", motivo: "completo", pular };
    }

    /**
     * ⚠️ TETO DA PASSADA. Paramos por limite de tempo, não por ter alcançado o
     * presente — então NÃO compra. Registra o que andou e deixa a próxima
     * passada continuar. Mesmo raciocínio do bloco acima: a janela onde
     * paramos ainda é velha.
     */
    if (pular.length >= MAX_JANELAS_POR_PASSADA) {
      return { acao: "pular", pular, proximoRunAt: janela };
    }

    pular.push({ ciclo, agendadoPara: janela, motivo: "janela_perdida" });
    ciclo += 1;
    janela = seguinte;
    tJanela = tSeguinte;
  }
}

// ─── Os tetos ──────────────────────────────────────────────────────────

export type MotivoRecusa =
  | "orcamento_esgotado"
  | "teto_diario_carteira"
  | "teto_plataforma"
  | "abaixo_do_minimo";

export interface Tetos {
  porCicloUsd:            number;
  gastoAcumuladoUsd:      number;
  orcamentoTotalUsd:      number;
  gastoHojeCarteiraUsd:   number;
  tetoDiarioCarteiraUsd:  number;
  tetoPlataformaUsd:      number;
  /** Mínimo de ordem da corretora. Abaixo disso a ordem é recusada por ela. */
  minimoUsd:              number;
}

/**
 * Quanto ESTE ciclo pode gastar.
 *
 * ⚠️⚠️ O TETO DIÁRIO POR CARTEIRA É NOVO, E A SEPARAÇÃO O EXIGIU.
 *
 * Enquanto o DCA vivia pendurado no autopilot, ele herdava o `max_trade_usd` da
 * sessão. Separado, não herda nada — e dez planos de US$ 100/dia na mesma
 * carteira seriam US$ 1.000/dia com nada olhando o conjunto.
 *
 * ⚠️ O ÚLTIMO CICLO VARRE O RESTO. Se sobram US$ 40 num plano de US$ 100 por
 * ciclo, o ciclo gasta 40 e o plano fecha — em vez de recusar e deixar dinheiro
 * parado que o dono acha que foi investido. Mas só ACIMA do mínimo da
 * corretora: abaixo dele a ordem seria recusada lá, e o plano ficaria tentando
 * para sempre.
 */
export function tetoDoCiclo(t: Tetos): { ok: true; valorUsd: number } | { ok: false; motivo: MotivoRecusa } {
  const naoNegativo = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

  const restanteOrcamento = naoNegativo(t.orcamentoTotalUsd - t.gastoAcumuladoUsd);
  if (restanteOrcamento <= 0) return { ok: false, motivo: "orcamento_esgotado" };

  const restanteDiario = naoNegativo(t.tetoDiarioCarteiraUsd - t.gastoHojeCarteiraUsd);
  if (restanteDiario <= 0) return { ok: false, motivo: "teto_diario_carteira" };

  const teto = naoNegativo(t.tetoPlataformaUsd);
  if (teto <= 0) return { ok: false, motivo: "teto_plataforma" };

  const valor = Math.min(naoNegativo(t.porCicloUsd), restanteOrcamento, restanteDiario, teto);
  if (valor <= 0) return { ok: false, motivo: "orcamento_esgotado" };

  // ⚠️ Compara com o mínimo DEPOIS de aplicar os tetos: um ciclo que caberia no
  // orçamento mas foi cortado pelo teto diário até virar poeira tem de ser
  // recusado por "abaixo do mínimo", e não disparar uma ordem que a corretora
  // vai rejeitar.
  if (valor < naoNegativo(t.minimoUsd)) return { ok: false, motivo: "abaixo_do_minimo" };

  return { ok: true, valorUsd: valor };
}
