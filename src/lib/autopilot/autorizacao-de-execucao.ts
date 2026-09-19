/**
 * ⚠️⚠️⚠️ A AUTORIZAÇÃO DE NOVA EXECUÇÃO DO PILOTO — achados A130 e A130-B.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE O AUDITOR ACHOU (A130).
 *
 * O botão PARAR faz `disarmSession` gravar `is_active = false` — e a LINHA
 * continua lá. A rota `/api/cex/order`, no ramo do piloto, lia a sessão com
 * `getSessionStatus(wallet, exchange)`, que seleciona por (carteira, corretora)
 * e **não filtra nada**: nem `is_active`, nem `expires_at`, nem congelamento.
 *
 * Daí em diante o fluxo seguia: `sessao.conexao_id` → conexão CURRENT →
 * credencial do cofre → `executarOrdemCex`. Ou seja: **sessão PARADA continuava
 * autorizando ordem nova.**
 *
 * ⚠️ E A CONEXÃO CONTINUAR ATIVA ESTÁ CERTO — ela serve DCA e reconciliação
 * histórica. O erro era tratar "a conexão pode operar" como "a sessão pode
 * operar". São perguntas diferentes:
 *
 *     sessão PARADA  +  conexão CURRENT   ≠   autorização para o piloto
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A ASSIMETRIA ERA A MESMA FAMÍLIA DO A113, e dava para medir:
 *
 *     cron      listRunnableSessions()   .eq("is_active",true).gt("expires_at",now)
 *                                        + freeze + teto diário, inline
 *     navegador getSessionStatus()       nenhum filtro
 *
 * Duas superfícies do MESMO produto, com semânticas de autorização diferentes.
 * Por isso este módulo existe: uma decisão, chamada pelos dois (§34/§35).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ FUNÇÃO PURA, E A ENTRADA É NORMALIZADA DE PROPÓSITO.
 *
 * O cron já virou o dia NA MEMÓRIA antes de decidir (`trades_today` zerado,
 * `frozen_until_day` reavaliado); o navegador lê a linha crua. Se este módulo
 * lesse a linha sozinho, os dois canais chamariam "a mesma função" com estados
 * diferentes — que é a forma sutil do defeito que ele veio consertar. Então
 * quem chama NORMALIZA, e a decisão é uma só.
 *
 * ⚠️ E ELA NÃO LÊ BANCO NEM REDE. Autorização é decisão; leitura de credencial
 * é outra coisa (§36). "Consegui abrir o cofre" nunca prova "posso operar".
 */

import { utcDayKey } from "@/lib/autopilot/sessions";

export type MotivoDaRecusaDeExecucao =
  | "sessao_inexistente"
  | "sessao_inativa"
  | "sessao_expirada"
  | "sessao_congelada"
  | "limite_diario"
  | "conexao_ausente";

/**
 * O estado da sessão, já normalizado por quem chama.
 *
 * ⚠️ `tradesHoje` É O EFETIVO, com a virada do dia JÁ APLICADA. Passar o valor
 * cru da linha num dia novo bloquearia o piloto com um contador de ontem.
 */
export interface EstadoParaExecucao {
  ativa: boolean;
  /** ISO. Ilegível é tratado como expirado — falha FECHADA. */
  expiraEm: string | null;
  /** A chave UTC do dia congelado, ou `null`. */
  congeladaAte: string | null;
  tradesHoje: number;
  maxTradesPorDia: number;
  /** O teto DURÁVEL por trade. Autoridade — ver `tetoEfetivoDaOrdem`. */
  maxTradeUsd: number;
  conexaoId: string | null;
  /**
   * ⚠️ A sessão está de quarentena por deriva de conta (`quarentena_em`)?
   *
   * Ele mora aqui, no estado NORMALIZADO, e não numa checagem solta de quem
   * chama, justamente para que um canal novo não consiga esquecer de existir.
   * Mas quem o LÊ é `entradaAutorizadaNaSessao`, não a autorização de sessão —
   * a razão está no docblock dela.
   */
  emQuarentena: boolean;
}

export type AutorizacaoDeExecucao =
  | { ok: true; conexaoId: string; tetoDaSessaoUsd: number; tradesRestantesHoje: number }
  | { ok: false; motivo: MotivoDaRecusaDeExecucao; porque: string };

/**
 * Esta sessão pode originar UMA nova execução real agora?
 *
 * ⚠️ VALE PARA COMPRA E PARA VENDA. Aqui NÃO existe a isenção que o
 * certificado de estratégia tem: aquela protege o cliente de ficar preso numa
 * posição por uma licença vencida. Esta é o botão PARAR — e "parar" que deixa
 * vender sozinho não é parar. O cron já se comporta assim: congelado ou no
 * teto, ele retorna antes do scan, sem compra e sem venda.
 */
export function avaliarAutorizacaoDaSessaoParaExecucao(
  estado: EstadoParaExecucao | null,
  agora: Date = new Date(),
): AutorizacaoDeExecucao {
  const nao = (motivo: MotivoDaRecusaDeExecucao, porque: string): AutorizacaoDeExecucao =>
    ({ ok: false, motivo, porque });

  if (!estado) {
    return nao("sessao_inexistente",
      "nao ha sessao de piloto para esta carteira/corretora — nenhuma ordem autonoma sai");
  }

  // ── 1. PARAR é PARAR ──────────────────────────────────────────────────
  if (!estado.ativa) {
    return nao("sessao_inativa",
      "a sessao do piloto esta PARADA — conexao ativa nao autoriza execucao nova");
  }

  // ── 2. a validade ─────────────────────────────────────────────────────
  /**
   * ⚠️ AUSENTE OU ILEGÍVEL É EXPIRADO. "Não consigo saber até quando isto
   * vale" não pode virar "vale para sempre" — a direção de falha do caminho
   * de dinheiro é fechada.
   */
  const expiraMs = estado.expiraEm ? Date.parse(estado.expiraEm) : NaN;
  if (!Number.isFinite(expiraMs)) {
    return nao("sessao_expirada", "validade da sessao ausente ou ilegivel");
  }
  if (expiraMs <= agora.getTime()) {
    return nao("sessao_expirada", `a sessao expirou em ${estado.expiraEm}`);
  }

  // ── 3. o congelamento ─────────────────────────────────────────────────
  const hoje = utcDayKey(agora);
  if (estado.congeladaAte === hoje) {
    return nao("sessao_congelada",
      "a sessao esta congelada hoje pelo stop de perda diaria");
  }

  // ── 4. o teto diário ──────────────────────────────────────────────────
  /**
   * ⚠️ `>=`, NÃO `>`. Com 5 de 5 feitos, a sexta não pode sair. E `tradesHoje`
   * já chega com a virada do dia aplicada — ver o docblock de `EstadoParaExecucao`.
   */
  if (estado.tradesHoje >= estado.maxTradesPorDia) {
    return nao("limite_diario",
      `teto diario atingido: ${estado.tradesHoje}/${estado.maxTradesPorDia}`);
  }

  /**
   * ⚠️ A QUARENTENA NÃO ENTRA AQUI, e isso é decisão escrita.
   *
   * Esta função vale para COMPRA E VENDA (ver o cabeçalho). A quarentena vale
   * só para ENTRADAS — "o saldo real não sustenta o inventário" é motivo para
   * parar de comprar, nunca para prender o cliente numa posição. Misturá-la
   * neste veredito trancaria a saída junto. Ela tem a função ao lado.
   */

  // ── 5. o elo com o cofre (A127) ───────────────────────────────────────
  /**
   * ⚠️ SESSÃO LEGADA SEM `conexao_id` NÃO OPERA (§31). Não se infere conexão
   * por carteira, nem pela CURRENT global: o intent precisa nascer amarrado à
   * MESMA versão do cofre que produziu o efeito externo.
   */
  if (!estado.conexaoId) {
    return nao("conexao_ausente",
      "sessao sem vinculo com o cofre — nenhuma ordem autonoma sai");
  }

  return { ok: true, conexaoId: estado.conexaoId,
    tetoDaSessaoUsd: estado.maxTradeUsd,
    tradesRestantesHoje: Math.max(0, estado.maxTradesPorDia - estado.tradesHoje) };
}

export type MotivoDaRecusaDeEntrada = "sessao_em_quarentena";

export type AutorizacaoDeEntrada =
  | { ok: true }
  | { ok: false; motivo: MotivoDaRecusaDeEntrada; porque: string };

/**
 * ⚠️⚠️⚠️ A QUARENTENA VALIA SÓ NO CRON — achado da revisão adversarial do A130.
 *
 * `reconciliar-conta.ts` grava `quarentena_em` quando o saldo real deixa de
 * sustentar o inventário do bot. O cron obedece (`if (s.quarentena_em)
 * entradasLiberadas = false`) e para de COMPRAR sozinho até mão humana.
 *
 * ⚠️ O NAVEGADOR NÃO OBEDECIA. Mesma sessão, mesma carteira, mesma deriva: o
 * cron parava de comprar e o piloto do navegador seguia comprando pela
 * `/api/cex/order`. É, outra vez, a família do A113 — a peça certa, com a
 * cicatriz escrita, obedecida num caminho e ignorada no outro. Por isso a
 * decisão mudou de lugar: uma função, dois canais.
 *
 * ⚠️ SÓ ENTRADAS. Copiado do cron ao pé da letra, inclusive o motivo:
 * "SAÍDAS/redução NUNCA são presas — quarentena não pode trancar o cliente
 * numa posição."
 *
 * ⚠️ E ELA NÃO É A RECONCILIAÇÃO. O cron confere a conta contra a corretora a
 * cada passada e PODE gravar a quarentena; esta função só LÊ o que já está
 * gravado. O navegador herda o freio, não a perícia — a limitação está dita na
 * entrega, em vez de virar uma paridade que não existe.
 */
export function entradaAutorizadaNaSessao(
  estado: Pick<EstadoParaExecucao, "emQuarentena">,
): AutorizacaoDeEntrada {
  if (estado.emQuarentena) {
    return { ok: false, motivo: "sessao_em_quarentena",
      porque: "a conta esta em quarentena por deriva de inventario — "
        + "zero compra autonoma ate conferencia humana; saidas seguem liberadas" };
  }
  return { ok: true };
}

/**
 * ⚠️⚠️ O TETO DA ORDEM — achado A130-B.
 *
 * A rota fazia:
 *
 *     const cap = typeof body.maxNotionalUsd === "number" && body.maxNotionalUsd > 0
 *       ? body.maxNotionalUsd
 *       : HARD_NOTIONAL_CEILING_USD;
 *
 * e esse `cap` ia tanto para `checkRealNotional` quanto para
 * `avaliarDecisaoDeEstrategia({ maxTradeUsd: cap })`. O `max_trade_usd` da
 * sessão — o número que o DONO configurou e que está PERSISTIDO — não era
 * consultado em lugar nenhum. Sessão a US$ 50, corpo pedindo US$ 1.000: o
 * servidor avaliava contra 1.000.
 *
 * ⚠️ O CLIENTE SÓ PODE PEDIR MENOS. Ele é uma preferência da tela — "hoje quero
 * ser mais conservador" é legítimo e continua funcionando. Aumentar, não: isso
 * seria o cliente se autorizando.
 *
 * ⚠️ E O TETO GLOBAL CONTINUA VALENDO POR CIMA DE TUDO (§26): nem a
 * configuração da sessão pode passar dele.
 */
export function tetoEfetivoDaOrdem(args: {
  tetoDaSessaoUsd: number;
  tetoGlobalUsd: number;
  /** O que o corpo pediu. Só entra na conta se for positivo e finito. */
  pedidoPeloClienteUsd?: unknown;
}): number {
  /**
   * ⚠️ TETO DURÁVEL ILEGÍVEL É TETO ZERO, não teto ausente.
   *
   * `max_trade_usd` chega de uma linha do banco. `NaN` ou negativo ali não pode
   * cair fora do `Math.min` e deixar o teto GLOBAL valendo sozinho — seria o
   * dado corrompido AMPLIANDO a autorização. Zero recusa qualquer ordem, que é
   * a direção certa de falha para dinheiro que sai.
   */
  const durar = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const candidatos = [durar(args.tetoDaSessaoUsd), durar(args.tetoGlobalUsd)];
  const doCliente = args.pedidoPeloClienteUsd;
  if (typeof doCliente === "number" && Number.isFinite(doCliente) && doCliente > 0) {
    candidatos.push(doCliente);
  }
  return Math.min(...candidatos);
}
