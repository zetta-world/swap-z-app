import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import type { AutopilotSessionRow, AutopilotRunRow } from "@/lib/supabase/types";
import { guardarConexao, lerConexaoPorId, decifrarConexao } from "@/lib/cex/conexoes";
import { recordEvent } from "@/lib/admin/track";
import type { CexCredentials } from "@/lib/cex/types";

/**
 * Server-only data layer for background autopilot sessions. Since the T3
 * (A115), credentials live ONLY in the vault (`cex_conexoes`) — the session
 * stores just the `conexao_id` link. Exposes the small surface the
 * arm/disarm API and the cron worker need. Every function tolerates an
 * unconfigured backend by returning null/empty rather than throwing, matching
 * the rest of the app's degrade-gracefully posture.
 */

export function utcDayKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export interface ArmSessionInput {
  walletAddress:     string;
  exchangeId:        string;
  riskMode:          "conservador" | "moderado" | "agressivo";
  marketType:        "spot" | "futures" | "margin";
  maxTradeUsd:       number;
  dailyLossStopUsd:  number;
  maxTradesPerDay:   number;
  allowedSymbols:    string[];
  lang:              string;
  credentials:       CexCredentials;
  /** How long the session may run unattended before auto-expiring (hours). */
  ttlHours:          number;
  /**
   * ⚠️ O VEREDITO DA CHAVE, obrigatório (Fase 7). Não é opcional de propósito:
   * opcional viraria "quem esqueceu de passar grava NULL", e NULL aqui significa
   * "nunca verificada". Quem chama tem que ter perguntado à corretora antes.
   */
  keyPermission:       "so_negocia" | "pode_sacar" | "nao_verificavel";
  keyPermissionDetail: string;
}

/**
 * Arm (or re-arm) a background session for this wallet+exchange. Writes the
 * credentials to the vault FIRST and THROWS if the vault fails (T3/A115: no
 * vault, no session — there is no local copy to degrade to). Returns the
 * session id, or null when the backend is unconfigured.
 */
export async function armSession(input: ArmSessionInput): Promise<string | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;

  /**
   * ⚠️⚠️⚠️ O SEGREDO TEM UM LUGAR SÓ — T3 do cofre concluído (achado A115).
   *
   * A versão T2 gravava a credencial DUAS VEZES: aqui (em `creds_cipher`) e
   * no cofre (`cex_conexoes`). Duas cópias é duas revogações necessárias,
   * dois lugares para vazar, e um fallback que valia justamente quando o
   * banco estava ruim. A coluna saiu na migration 0056 (produção medida com
   * 0 sessões): a sessão guarda SÓ o elo `conexao_id`.
   *
   * ⚠️⚠️ FALHA DO COFRE = SESSÃO NÃO ARMA. Antes isto degradava: armava com
   * `conexao_id` nulo e segredo local. Não existe mais local para onde
   * degradar — e não existiria nem se quiséssemos, porque `creds_cipher` não
   * existe mais. Se a credencial não entrou no cofre, NENHUMA sessão nasce
   * apontando para segredo nenhum. Falha fechado, como o botão de parar.
   */
  const cofre = await guardarConexao({
    walletAddress: input.walletAddress,
    exchangeId:    input.exchangeId,
    credentials:   input.credentials,
  });
  if (!cofre.ok) {
    await recordEvent("cofre_nao_gravou", { meta: {
      severity: "high",
      why: "T3: cofre falhou → sessão NÃO armada (não existe mais cópia local para degradar)",
      exchange: input.exchangeId, erro: cofre.erro,
    } });
    throw new Error(`armSession: cofre nao gravou — sessao nao armada (${cofre.erro})`);
  }
  const today = utcDayKey();
  const expiresAt = new Date(Date.now() + input.ttlHours * 3600_000).toISOString();

  const { data, error } = await db
    .from("autopilot_sessions")
    .upsert({
      wallet_address:      input.walletAddress,
      exchange_id:         input.exchangeId,
      risk_mode:           input.riskMode,
      market_type:         input.marketType,
      max_trade_usd:       input.maxTradeUsd,
      daily_loss_stop_usd: input.dailyLossStopUsd,
      max_trades_per_day:  input.maxTradesPerDay,
      allowed_symbols:     input.allowedSymbols,
      lang:                input.lang,
      conexao_id:          cofre.id,
      key_permission:        input.keyPermission,
      key_permission_detail: input.keyPermissionDetail.slice(0, 300),
      key_checked_at:        new Date().toISOString(),
      is_active:           true,
      expires_at:          expiresAt,
      // Reset counters on (re-)arm so a fresh session starts clean.
      trades_today:        0,
      pnl_today:           0,
      last_reset_day:      today,
      frozen_until_day:    null,
      last_error:          null,
      updated_at:          new Date().toISOString(),
    }, { onConflict: "wallet_address,exchange_id" })
    .select("id")
    .single();

  if (error) throw new Error(`armSession failed: ${error.message}`);
  return data?.id ?? null;
}

/**
 * O botão de PARAR do autopilot.
 *
 * ⚠️⚠️ ELE DEVOLVIA `Promise<void>` — e isso é o defeito, não um detalhe de
 * assinatura (achado A11 da auditoria externa, 14/09).
 *
 * `supabase-js` RESOLVE com `{ data, error }` e NÃO lança (invariante nº 1
 * desta casa). Sem `const { error } =`, um UPDATE recusado — banco fora,
 * PostgREST 5xx, rede — era indistinguível de sucesso. A rota respondia
 * `{ ok: true }`, a tela dizia "desligado, ele para de operar imediatamente",
 * e `is_active` continuava `true`: o cron de 5 minutos seguia negociando com a
 * credencial cifrada que ESTÁ no servidor. Dinheiro REAL na corretora do
 * cliente, no botão que existe para parar.
 *
 * ⚠️ E `Promise<void>` era o que tornava a conferência IMPOSSÍVEL para quem
 * chama. A trava `escritas-conferidas.test.ts` já proíbe exatamente isso — só
 * que ela lia `positions-server.ts` e o cron, e nunca este arquivo.
 *
 * ⚠️ O padrão certo existe duas pastas ao lado: `revogarConexao`
 * (`lib/cex/conexoes.ts`) é a MESMA classe de escrita e devolve `!error`.
 *
 * ⚠️ `linhas === 0` NÃO é falha: é idempotência — já estava desarmado, ou nunca
 * houve sessão. Tratar isso como erro faria um segundo clique parecer quebra.
 */
export async function disarmSession(
  walletAddress: string, exchangeId: string,
): Promise<{ ok: boolean; linhas: number }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, linhas: 0 };
  const { data, error } = await db
    .from("autopilot_sessions")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId)
    // ⚠️ `.select()` para SABER quantas linhas casaram. Sem ele, "gravou" e
    // "não achou nada para gravar" voltam idênticos.
    .select("id");
  return { ok: !error, linhas: data?.length ?? 0 };
}

/** Read the public-safe view of a session (NO decrypted credentials). */
export async function getSessionStatus(
  walletAddress: string,
  exchangeId: string,
): Promise<AutopilotSessionRow | null> {
  const db = getSupabaseAdmin();
  if (!db) return null;
  /**
   * ⚠️⚠️ FALHA DE LEITURA NÃO PODE VIRAR "NÃO HÁ SESSÃO" (14/09).
   *
   * Esta função devolvia `null` tanto para "não existe sessão" quanto para "não
   * consegui ler" — e o painel faz `isArmed = !!status?.is_active`. Numa queda
   * de banco, a escrita do desarme falha E a leitura falha juntas: a tela mostra
   * DESARMADO enquanto a linha continua `is_active = true`, e o cron retoma as
   * ordens na invocação seguinte, com o banco já de volta.
   *
   * Ausência continua ausência; erro agora LANÇA, e quem chama decide. É a mesma
   * escolha que `listRunnableSessions` logo abaixo já fazia.
   */
  const { data, error } = await db
    .from("autopilot_sessions")
    .select("*")
    .eq("wallet_address", walletAddress)
    .eq("exchange_id", exchangeId)
    .maybeSingle();
  if (error) throw new Error(`getSessionStatus failed: ${error.message}`);
  // Não há mais segredo na linha (T3): a visão pública É a linha.
  return data ?? null;
}

/** All active, non-expired sessions — the cron's work queue. */
export async function listRunnableSessions(): Promise<AutopilotSessionRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const nowIso = new Date().toISOString();
  const { data, error } = await db
    .from("autopilot_sessions")
    .select("*")
    .eq("is_active", true)
    .gt("expires_at", nowIso);
  if (error) throw new Error(`listRunnableSessions failed: ${error.message}`);
  return data ?? [];
}

/**
 * ⚠️⚠️⚠️ AS BANDEIRAS DA SESSÃO, RELIDAS DEPOIS DO SETTLE — item 11.
 *
 * O cron carrega a linha UMA vez, no começo da passada
 * (`listRunnableSessions`), e a passada ESCREVE nela: a liquidação da saída
 * armada chama `autopilot_marcar_contabilidade`, que grava
 * `contabilidade_incompleta_em`. O portão de entrada lia a cópia em MEMÓRIA
 * e portanto o valor de ANTES — a bandeira levantada nesta passada só
 * começava a valer na seguinte, cinco minutos depois, que é a cadência
 * inteira de decisão do bot.
 *
 * O stop de perda já tinha contrapartida em memória por este mesmo motivo
 * (`pnlToday += settle.realizedDelta`). A contabilidade não tinha — e um
 * espelho em memória não bastaria aqui, porque a mesma coluna também é
 * escrita pela varredura de pendências e pelo canal do navegador, fora desta
 * função. A fonte de verdade é a linha.
 *
 * ⚠️ TRI-STATE, e falha é falha: `null` = não deu para ler. Quem chama NÃO
 * abre entrada nova com as bandeiras desconhecidas — "não consegui ler" nunca
 * pode valer como "não há bandeira".
 */
export interface BandeirasDaSessao {
  quarentenaEm: string | null;
  contabilidadeIncompletaEm: string | null;
}

export async function relerBandeirasDaSessao(
  sessionId: string,
  /** Injetável para teste; o padrão é o cliente de serviço. */
  deps: { db?: SupabaseClient<Database> | null } = {},
): Promise<BandeirasDaSessao | null> {
  const db = deps.db ?? getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db
    .from("autopilot_sessions")
    .select("quarentena_em, contabilidade_incompleta_em")
    .eq("id", sessionId)
    .maybeSingle();
  // ⚠️ O cliente RESOLVE com `{ error }` — não lança. E linha ausente também
  // é ausência de resposta sobre uma sessão que deveria existir.
  if (error || !data) return null;
  const linha = data as unknown as {
    quarentena_em?: unknown; contabilidade_incompleta_em?: unknown;
  };
  return {
    quarentenaEm: linha.quarentena_em == null ? null : String(linha.quarentena_em),
    contabilidadeIncompletaEm: linha.contabilidade_incompleta_em == null
      ? null : String(linha.contabilidade_incompleta_em),
  };
}

/** De onde a credencial veio nesta leitura. T3: existe UM lugar — o cofre. */
export type OrigemCredencial = "cofre";

/**
 * ⚠️⚠️⚠️ O COFRE É A ÚNICA FONTE — achado A115, o T3 concluído (Round 2).
 *
 * A versão T2 tinha um FALLBACK: sessão sem elo no cofre lia o segredo de
 * `creds_cipher`, a segunda cópia guardada na própria sessão. O Round 1 já
 * tinha fechado o fallback PARA SESSÃO COM ELO; esta rodada removeu o ramo
 * inteiro — e a coluna (migration 0056, produção medida com 0 sessões).
 *
 * Agora NÃO EXISTE outro caminho, para nenhuma sessão:
 *
 *     sem conexao_id     ERRO EXPLÍCITO (sessão pré-cofre não existe mais)
 *     revogada           BLOQUEIA
 *     não existe         BLOQUEIA
 *     não deu para ler   BLOQUEIA
 *     cofre ilegível     BLOQUEIA (o `decifrarConexao` lança, e deve lançar)
 *
 * ⚠️ SE ALGUÉM REINTRODUZIR UM "CAMINHO ALTERNATIVO" aqui, o grep-guard de
 * `cofre-t3.test.ts` quebra o build. Um lugar para revogar que tem outro
 * lugar atrás dele não é um lugar para revogar.
 */
export async function credenciaisDaSessao(
  row: AutopilotSessionRow,
): Promise<{ creds: CexCredentials; origem: OrigemCredencial }> {
  if (!row.conexao_id) {
    throw new Error(
      "sessão sem elo com o cofre (conexao_id nulo) — a segunda cópia do segredo foi removida no T3; rearma a sessão");
  }
  const c = await lerConexaoPorId(row.conexao_id);
  if (c === undefined) {
    throw new Error("cofre: nao deu para ler a conexao — nenhuma ordem sai sobre duvida de credencial");
  }
  if (c === null) {
    throw new Error("cofre: conexao inexistente para esta sessao — vinculo quebrado");
  }
  if (!c.is_active) {
    throw new Error("cofre: conexão revogada pelo dono");
  }
  if (!c.is_current) {
    throw new Error("cofre: conexão substituída por rotação — rearme a sessão");
  }
  // ⚠️ `decifrarConexao` LANÇA em adulteração ou chave ausente. Não se
  // captura aqui de propósito: cofre ilegível é bloqueio, não motivo para
  // procurar o segredo em outro lugar.
  return { creds: decifrarConexao(c), origem: "cofre" };
}

/** Patch a session's mutable fields (counters, freeze, last_scan_at, error). */
/**
 * ⚠⚠ POR QUE ISTO DEIXOU DE SER `Promise<void>` (achado A11, segunda parte).
 *
 * As nove chamadas no cron não são iguais. Oito são telemetria
 * (`last_scan_at`, `last_error`): falhar ali envelhece a tela e nada mais.
 *
 * A NONA É A VIRADA DO DIA — `trades_today: 0, pnl_today: 0, last_reset_day`.
 * E ela decide dinheiro: o cron zera o contador NA MEMÓRIA e calcula
 * `remainingTrades = max_trades_per_day - tradesToday` a partir do valor local.
 * Se a gravação for recusada, `last_reset_day` continua em ontem, a passada
 * seguinte vê de novo "é outro dia", zera de novo na memória — e o limite
 * diário que o usuário configurou vira limite POR PASSADA, a cada 5 minutos.
 *
 * Com `Promise<void>` não havia o que conferir: `supabase-js` resolve com
 * `{ error }` e não lança, então recusa e sucesso eram indistinguíveis.
 *
 * ⚠️ `sem banco` também é `ok: false`. Antes o `return` cedo devolvia o mesmo
 * `undefined` do caminho feliz — ausente e gravado liam igual.
 */
export async function patchSession(
  id: string,
  patch: Partial<Pick<AutopilotSessionRow,
    "trades_today" | "pnl_today" | "last_reset_day" | "frozen_until_day" |
    "last_scan_at" | "last_error" | "is_active" |
    /** ⚠️ O carimbo do plano, revalidado com prazo pelo worker (achado A111). */
    "tier_snapshot" | "tier_checked_at">>,
): Promise<{ ok: boolean; erro?: string }> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "supabase nao configurado" };
  const { error } = await db
    .from("autopilot_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  return error ? { ok: false, erro: error.message.slice(0, 200) } : { ok: true };
}

/**
 * Atomically acquire the per-session lock (A2). Returns true only if this
 * caller won the lock — i.e. it was free (null) or its TTL had expired. The
 * conditional UPDATE is serialized by Postgres, so of two overlapping cron
 * runs exactly one acquires and the other sees zero rows updated.
 */
export async function tryLockSession(id: string, ttlMs: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const nowIso     = new Date().toISOString();
  const lockUntil  = new Date(Date.now() + ttlMs).toISOString();
  const { data, error } = await db
    .from("autopilot_sessions")
    .update({ locked_until: lockUntil, updated_at: nowIso })
    .eq("id", id)
    .or(`locked_until.is.null,locked_until.lt.${nowIso}`)
    .select("id");
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

/**
 * ⚠️⚠️⚠️ `bumpSessionTrades` VIVIA AQUI, E SAIU NO A132 (Round 9).
 *
 * Ela era o write-back do A1: somava `trades_today` DEPOIS que a ordem já
 * existia na corretora, por `rpc("bump_session_trades")` — que é
 * `trades_today = trades_today + n`, incremento atômico **sem conferir teto**.
 *
 * A cicatriz dela, que continua valendo como lição, era de OUTRO defeito: o
 * RPC era disparado sem conferir `error`, e o cliente do Supabase RESOLVE com
 * `{ error }` em vez de lançar. Se ele falhasse, o contador não subia e o
 * limite diário DEIXAVA DE EXISTIR, em silêncio, pelo resto do dia (auditoria
 * 23/08). Consertar isso não consertou o outro buraco — e o outro buraco era
 * estrutural:
 *
 *     navegador lê 4 → reserva → 5
 *     cron já tinha lido 4 → envia → soma → 6
 *
 * Teto de 5 fechando o dia em 6. Não havia conferência possível DEPOIS do
 * efeito externo: quando a soma acontece, o dinheiro já saiu.
 *
 * O Round 8 trocou o navegador para `reservarTradeDaSessao` (compare-and-swap,
 * ANTES do envio) e DECLAROU a corrida cron↔navegador como limitação
 * conhecida. O A132 é o fim dela: o cron passou a usar a mesma reserva, pela
 * mesma costura (`reservaDaVagaDiaria` → `ReservaDeRisco` do executor), e esta
 * função deixou de ter caller. Mantê-la exportada seria manter uma arma
 * carregada — um caminho que soma sem teto, a uma linha de distância de
 * qualquer um que "só precise contar um trade".
 *
 * O RPC `bump_session_trades` (migration 0010) continua existindo no banco;
 * nenhuma migration foi alterada para remover o que o código não chama mais.
 *
 * ⚠️ NÃO RESSUSCITAR. `escritas-conferidas.test.ts` tranca a ausência: nenhum
 * arquivo de produção pode voltar a chamar este RPC para contar trade.
 */

/**
 * ⚠️⚠️⚠️ RESERVA UMA VAGA DO TETO DIÁRIO, ATOMICAMENTE — achado A130-B, §17.
 *
 * O `bump_session_trades` acima é um `UPDATE ... SET trades_today = trades_today
 * + n` puro. O incremento em si é atômico, mas **não confere teto nenhum**. Com
 * `trades_today = 4` e `max = 5`, duas requisições concorrentes leem `4 < 5`,
 * as duas passam, e o contador termina em 6. O limite que o dono configurou
 * vira sugestão sob concorrência — e o canal do navegador é justamente o que
 * pode disparar duas vezes com um clique duplo.
 *
 * ⚠️ POR QUE COMPARE-AND-SWAP, E NÃO RPC NOVA. Uma função no banco resolveria
 * com `where trades_today < max_trades_per_day`, mas RPC nova exige migration
 * nova — e o §50 manda PARAR antes de criar migration no A130. O CAS resolve
 * sem tocar no esquema:
 *
 *     update ... set trades_today = <lido+1>
 *      where id = X and trades_today = <lido> and is_active and last_reset_day = <hoje>
 *
 * Em READ COMMITTED, quando duas transações disputam a MESMA linha, a segunda
 * espera o lock e então **reavalia o WHERE contra a versão já atualizada**
 * (EvalPlanQual). `trades_today = <lido>` deixa de casar e ela grava ZERO
 * linhas. `.select("id")` faz a diferença ser visível: sem ele, "reservei" e
 * "não reservei" voltariam idênticos — a cicatriz do A11 nesta mesma tabela.
 *
 * ⚠️ `last_reset_day` ENTRA NO WHERE de propósito. O contador só é zerado pela
 * virada do dia do cron; reservar contra um `trades_today` de ontem contaria a
 * vaga no balde errado. Dia diferente ⇒ nenhuma linha casa ⇒ `virou_o_dia`, e
 * quem chama decide (aqui: recusa, porque a virada é do cron e é melhor perder
 * um trade do que estourar o teto).
 *
 * ⚠️ TENTATIVAS: a corrida legítima (duas reservas simultâneas com vaga para
 * ambas) falha o CAS uma vez e sucede na releitura. Três tentativas cobrem
 * isso sem virar laço.
 */
export type ResultadoDaReserva =
  | { ok: true; tradesDepois: number }
  | { ok: false;
      motivo: "limite_diario" | "virou_o_dia" | "sessao_inativa" | "erro" | "contencao";
      porque: string };

export async function reservarTradeDaSessao(
  sessionId: string,
  hojeUtc: string,
  tentativas = 3,
): Promise<ResultadoDaReserva> {
  const db = getSupabaseAdmin();
  if (!db) return { ok: false, motivo: "erro", porque: "sem banco" };

  for (let i = 0; i < tentativas; i++) {
    const { data, error } = await db
      .from("autopilot_sessions")
      .select("trades_today, max_trades_per_day, is_active, last_reset_day")
      .eq("id", sessionId)
      .maybeSingle();
    // ⚠️ Falha de leitura NÃO é "sem sessão": não reservar é a direção certa,
    // mas o motivo precisa dizer que não deu para olhar.
    if (error) return { ok: false, motivo: "erro", porque: error.message.slice(0, 160) };
    if (!data) return { ok: false, motivo: "sessao_inativa", porque: "sessao nao encontrada" };
    if (!data.is_active) {
      return { ok: false, motivo: "sessao_inativa", porque: "sessao parada" };
    }
    if (data.last_reset_day !== hojeUtc) {
      return { ok: false, motivo: "virou_o_dia",
        porque: `contador e do dia ${data.last_reset_day}, hoje e ${hojeUtc} — `
          + "a virada e do cron; nenhuma vaga reservada" };
    }
    const atual = Number(data.trades_today);
    const teto  = Number(data.max_trades_per_day);
    if (!(atual < teto)) {
      return { ok: false, motivo: "limite_diario",
        porque: `teto diario atingido: ${atual}/${teto}` };
    }

    const { data: gravadas, error: erroUpdate } = await db
      .from("autopilot_sessions")
      .update({ trades_today: atual + 1, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("is_active", true)
      .eq("last_reset_day", hojeUtc)
      // ⚠️ O CAS: só casa se ninguém mexeu no contador desde a leitura.
      .eq("trades_today", atual)
      .select("id");
    if (erroUpdate) {
      return { ok: false, motivo: "erro", porque: erroUpdate.message.slice(0, 160) };
    }
    if ((gravadas?.length ?? 0) > 0) return { ok: true, tradesDepois: atual + 1 };
    // Ninguém casou: outra passada reservou primeiro. Relê e tenta de novo.
  }
  /**
   * ⚠️ ISTO NÃO É "TETO ATINGIDO" — achado da revisão adversarial do Round 9.
   *
   * Três colisões seguidas no CAS significam contenção, não dia encerrado. O
   * motivo `limite_diario` fazia o cron concluir "acabou a cota" e encerrar a
   * passada, com o sinal errado no log. A recusa continua (nenhuma vaga foi
   * reservada), mas ela agora diz o que aconteceu.
   */
  return { ok: false, motivo: "contencao",
    porque: `concorrencia no contador apos ${tentativas} tentativas — vaga nao reservada` };
}

/**
 * Devolve a vaga reservada.
 *
 * ⚠️⚠️ SÓ NA RECUSA PROVADA. O executor chama `liberar` em três pontos, todos
 * com prova de que NADA saiu (reserva negada a jusante, autorização recusada,
 * corretora respondeu "não") — e NUNCA em `UNKNOWN`. Devolver a vaga sobre
 * dúvida autorizaria um segundo envio para um dinheiro que talvez já tenha
 * saído: a INVARIANTE 4.
 *
 * ⚠️ Também é CAS. Se o contador andou entre a reserva e a devolução, a
 * devolução não acontece — e não acontecer é o lado seguro: sobra uma vaga
 * gasta, não uma vaga inventada.
 */
export async function liberarTradeDaSessao(
  sessionId: string, hojeUtc: string, valorReservado: number,
): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  const { data, error } = await db
    .from("autopilot_sessions")
    .update({ trades_today: Math.max(0, valorReservado - 1), updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("last_reset_day", hojeUtc)
    .eq("trades_today", valorReservado)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

/** Release the per-session lock so the next cron run can pick it up. */
export async function releaseLock(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db
    .from("autopilot_sessions")
    .update({ locked_until: null, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** Append one (or more) run-log rows. Best-effort — swallows DB errors. */
export async function recordRuns(rows: Array<Partial<AutopilotRunRow> & {
  wallet_address: string; exchange_id: string; status: string;
}>): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db || rows.length === 0) return;
  try {
    await db.from("autopilot_runs").insert(rows);
  } catch { /* logging must never break the worker */ }
}

/** Recent run-log rows for a wallet (for the UI to show what ran while away). */
export async function listRecentRuns(walletAddress: string, limit = 50): Promise<AutopilotRunRow[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const { data } = await db
    .from("autopilot_runs")
    .select("*")
    .eq("wallet_address", walletAddress)
    .order("ran_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
