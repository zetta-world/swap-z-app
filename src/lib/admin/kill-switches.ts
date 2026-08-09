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

export const PLATFORM_KILL_KEYS = ["disable_swap", "disable_cex", "maintenance_mode"] as const;
export type PlatformKillKey = (typeof PLATFORM_KILL_KEYS)[number];

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
