/**
 * OS KILL-SWITCHES DA PLATAFORMA — agora LIDOS por alguém.
 *
 * ⚠️ POR QUE ISTO EXISTE (Fase 7.3, 09/08).
 *
 * `disable_swap`, `disable_cex` e `maintenance_mode` existiam no painel de
 * admin desde sempre: clicáveis, gravando em `admin_kv`, entrando no log de
 * auditoria — e **lidos por ninguém**. Um documento nosso de auditoria chegou a
 * reportar *"✅ plataforma aberta"* lendo um interruptor que não controlava
 * coisa nenhuma. É a invariante nº 14 na sua forma mais cara: o operador vê a
 * chave virar e **acredita que desligou**.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A DIREÇÃO DE FALHA É POR ROTA, NÃO UMA REGRA SÓ.
 *
 * A pergunta "e se o banco não responder?" não tem uma resposta boa para as
 * duas pontas, então ela é respondida por consequência, não por costume:
 *
 *   · **Ordem de corretora** (`/api/cex/order`) — dinheiro SAI da conta do
 *     cliente. FALHA FECHADA. Bloquear uma ordem durante uma queda de banco
 *     custa um trade perdido; deixar passar durante um incidente pode custar
 *     fundos. É também a regra da casa para o caminho do dinheiro, e as outras
 *     guardas desta rota (preço de referência, notional) já dependem de dado
 *     externo — sem banco, ela já está operando sem as travas dela.
 *
 *   · **Cotação de swap** (`/api/quote`) — devolve uma transação que o usuário
 *     ainda precisa ASSINAR na carteira, revisando. FALHA ABERTA. Derrubar o
 *     produto inteiro para todo mundo por causa de um Postgres intermitente é o
 *     dano certo; o cenário em que isso protege alguém exige a conjunção de
 *     "o dono desligou" com "a leitura falhou exatamente agora".
 *
 * Isto NÃO é a nº 16 sendo contrariada — é ela sendo aplicada: o default segue
 * o que está em jogo. Aqui o que está em jogo muda de rota para rota.
 *
 * ⚠️ E A FALHA DE LEITURA É BARULHENTA (invariante nº 7). Quando o estado dos
 * interruptores não pôde ser lido, isso vira evento de segurança — senão
 * "ninguém desligou nada" e "não consegui olhar" ficariam idênticos.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { logSecurity } from "@/lib/admin/track";
import { comTeto } from "@/lib/admin/auditoria-duravel";
import {
  PLATFORM_KILL_KEYS, MAPA_INTERRUPTORES,
  type PlatformKillKey, type ChaveDeInterruptor, type DirecaoNaFalha,
} from "@/lib/admin/gate-keys";

// As chaves moram em `gate-keys.ts` (módulo puro) para os painéis client
// derivarem da mesma fonte. Reexportadas para quem já importa daqui.
export { PLATFORM_KILL_KEYS };
export type { PlatformKillKey };

export interface EstadoKillSwitches {
  disable_swap:     boolean;
  disable_cex:      boolean;
  maintenance_mode: boolean;
  /** A leitura funcionou? `false` obriga quem chama a escolher a direção. */
  lido:             boolean;
}

const TUDO_ABERTO = (lido: boolean): EstadoKillSwitches =>
  ({ disable_swap: false, disable_cex: false, maintenance_mode: false, lido });

/** Lê os três. NUNCA lança; devolve `lido: false` quando não deu para olhar. */
export async function lerKillSwitches(): Promise<EstadoKillSwitches> {
  const db = getSupabaseAdmin();
  if (!db) return TUDO_ABERTO(false);
  try {
    const { data, error } = await db
      .from("admin_kv").select("key, value")
      .in("key", PLATFORM_KILL_KEYS as unknown as string[]);
    if (error) return TUDO_ABERTO(false);
    const e = TUDO_ABERTO(true);
    for (const r of data ?? []) {
      if ((PLATFORM_KILL_KEYS as readonly string[]).includes(r.key)) {
        e[r.key as PlatformKillKey] = r.value === "true";
      }
    }
    return e;
  } catch { return TUDO_ABERTO(false); }
}

export interface VereditoKill {
  bloqueado: boolean;
  /** Qual interruptor barrou — ou por que não deu para saber. */
  motivo:    PlatformKillKey | "leitura_falhou" | null;
}

/**
 * Decisão pura para uma rota de DINHEIRO QUE SAI (ordem de corretora).
 * Falha de leitura BLOQUEIA. Ver a nota do topo.
 */
export function decidirCaminhoDeDinheiro(
  e: EstadoKillSwitches, quais: PlatformKillKey[],
): VereditoKill {
  if (!e.lido) return { bloqueado: true, motivo: "leitura_falhou" };
  for (const k of quais) if (e[k]) return { bloqueado: true, motivo: k };
  return { bloqueado: false, motivo: null };
}

/**
 * Decisão pura para uma rota que o usuário ainda CONFIRMA depois (cotação).
 * Falha de leitura DEIXA PASSAR. Ver a nota do topo.
 */
export function decidirCaminhoConfirmado(
  e: EstadoKillSwitches, quais: PlatformKillKey[],
): VereditoKill {
  if (!e.lido) return { bloqueado: false, motivo: null };
  for (const k of quais) if (e[k]) return { bloqueado: true, motivo: k };
  return { bloqueado: false, motivo: null };
}

/**
 * O atalho das rotas. `tipo` escolhe a direção de falha — e é um parâmetro
 * OBRIGATÓRIO de propósito: um default aqui faria a rota nova herdar a direção
 * errada por omissão, que é exatamente como estes três interruptores passaram
 * anos sem ninguém notar.
 */
export async function checarKillSwitches(
  quais: PlatformKillKey[],
  tipo:  "dinheiro_sai" | "usuario_confirma",
): Promise<VereditoKill> {
  const estado = await lerKillSwitches();
  if (!estado.lido) {
    logSecurity("killswitch_read_failed", { quais: quais.join(","), tipo }, "high");
  }
  return tipo === "dinheiro_sai"
    ? decidirCaminhoDeDinheiro(estado, quais)
    : decidirCaminhoConfirmado(estado, quais);
}

/* ─────────────────────────────────────────────────────────────────────────
 * A LEITURA DO PAINEL — tri-estado, com teto de tempo (ADM-004).
 *
 * ⚠️⚠️ `GET /admin/api/killswitch` devolvia 200 `{ switches: {} }` com a nota
 * "admin_kv not yet migrated" em QUALQUER erro de banco — tabela ausente,
 * permissão negada, timeout. Um painel desenhava os três interruptores OFF e o
 * outro desenhava os dezenove gates ON: "não consegui ler" virava "está tudo
 * desligado / tudo rodando", no momento exato em que alguém abre o painel
 * para desligar algo.
 *
 * Esta leitura é SÓ do painel. Os consumidores de dinheiro continuam com
 * `lerKillSwitches`/`getFlywheelGates` e a direção de falha deles — nada aqui
 * muda política de dinheiro.
 * ───────────────────────────────────────────────────────────────────────── */

/** Mesmo orçamento de `GATE_KV_TIMEOUT_MS`: com o banco fora, a leitura levava ~20 s para falhar. */
export const KILL_LEITURA_TIMEOUT_MS = 3_000;

export type CodigoLeituraKill = "db_indisponivel" | "leitura_falhou" | "tempo_esgotado" | "excecao";

export interface LinhaKv { value: string; updated_at: string | null }

export type LeituraInterruptores =
  | { lido: true; asOf: string; linhas: Map<string, LinhaKv> }
  | { lido: false; asOf: string; errorCode: CodigoLeituraKill };

/** Lê as chaves pedidas. NUNCA lança; qualquer falha (inclusive o relógio) é `lido: false`. */
export async function lerInterruptores(
  chaves: readonly string[], tetoMs: number = KILL_LEITURA_TIMEOUT_MS,
): Promise<LeituraInterruptores> {
  const asOf = new Date().toISOString();
  const leitura = (async (): Promise<LeituraInterruptores> => {
    try {
      const db = getSupabaseAdmin();
      if (!db) return { lido: false, asOf, errorCode: "db_indisponivel" };
      const { data, error } = await db
        .from("admin_kv").select("key, value, updated_at").in("key", [...chaves]);
      if (error) return { lido: false, asOf, errorCode: "leitura_falhou" };
      const linhas = new Map<string, LinhaKv>();
      for (const r of data ?? []) {
        linhas.set(r.key, { value: typeof r.value === "string" ? r.value : String(r.value), updated_at: r.updated_at ?? null });
      }
      return { lido: true, asOf, linhas };
    } catch {
      return { lido: false, asOf, errorCode: "excecao" };
    }
  })();
  return comTeto(leitura, tetoMs, { lido: false, asOf, errorCode: "tempo_esgotado" });
}

/** O estado de UMA linha lida. Sem linha = desligado (seed da 0006; gate ausente = rodando). */
export type EstadoPersistido = "on" | "off" | "invalido";

export function estadoDoValor(valor: string | null): EstadoPersistido {
  if (valor === null) return "off";
  if (valor === "true") return "on";
  if (valor === "false") return "off";
  // `"TRUE"`, `"1"`, lixo: os consumidores comparam `=== "true"`, então isto
  // FUNCIONA como desligado — mas o painel não pode fingir que leu um `false`.
  return "invalido";
}

export type EstadoInterruptor = EstadoPersistido | "desconhecido";

export interface InterruptorObservado {
  chave:          ChaveDeInterruptor;
  /** `desconhecido` = a leitura falhou; `invalido` = valor fora de "true"/"false". */
  estado:         EstadoInterruptor;
  /** O valor bruto gravado. `null` = sem linha (ou leitura falhou). */
  persistido:     string | null;
  atualizadoEm:   string | null;
  direcaoNaFalha: DirecaoNaFalha;
  consumidores:   string[];
}

/** Decisão pura: leitura → estado de cada chave. Leitura falha → TODAS desconhecidas, nunca OFF. */
export function observarInterruptores(
  l: LeituraInterruptores, chaves: readonly ChaveDeInterruptor[],
): Record<string, InterruptorObservado> {
  const out: Record<string, InterruptorObservado> = {};
  for (const chave of chaves) {
    const mapa = MAPA_INTERRUPTORES[chave];
    const linha = l.lido ? l.linhas.get(chave) ?? null : null;
    out[chave] = {
      chave,
      estado: l.lido ? estadoDoValor(linha ? linha.value : null) : "desconhecido",
      persistido: linha ? linha.value : null,
      atualizadoEm: linha ? linha.updated_at : null,
      direcaoNaFalha: mapa.direcaoNaFalha,
      consumidores: mapa.consumidores,
    };
  }
  return out;
}
