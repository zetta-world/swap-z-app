/**
 * A TRAVA DE LIBERAÇÃO DA AUTOMAÇÃO DE CEX — Fase 7.2 (09/08).
 *
 * O dono: *"podemos deixar a fase pronta, porém só vamos liberar ao público
 * quando tiver algo que realmente seja justificável"*.
 *
 * ⚠️ PRIMEIRO ACHADO DA VERIFICAÇÃO DE ESTADO: não existia a trava.
 *
 * O worker que gasta o dinheiro REAL DO CLIENTE (`/api/autopilot/cron`) era o
 * ÚNICO caminho de dinheiro sem kill-switch. Dezessete mesas internas — que
 * gastam só o NOSSO token — tinham gate cada uma; a automação que compra na
 * corretora do usuário não tinha nenhum. Grep de `pause` no cron: zero.
 *
 * ⚠️ SEGUNDO ACHADO, pior: `disable_cex`, `disable_swap` e `maintenance_mode`
 * existem no painel, são clicáveis, gravam em `admin_kv`, entram no log de
 * auditoria — e NÃO SÃO LIDOS POR NINGUÉM. Um documento de auditoria chegou a
 * reportar "✅ plataforma aberta" lendo um interruptor que não controla nada.
 * É a invariante nº 14 outra vez, e mais cara que a primeira: aqui o operador
 * vê a chave virar e acredita que desligou.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O DEFAULT AQUI É O INVERSO DO DEFAULT DOS GATES DO FLYWHEEL.
 *
 * `gates.ts` diz, com razão para o caso dele: *"a missing/empty admin_kv never
 * accidentally pauses the flywheel"* — ausência = rodando. Para uma mesa
 * interna isso é certo: o pior caso é gastar token.
 *
 * Para uma trava de LIBERAÇÃO é exatamente o contrário. Ausência de registro
 * NÃO é autorização: é a mesma invariante nº 6 (*não medimos ≠ medimos zero*)
 * aplicada a uma decisão em vez de a uma medição. Linha ausente, tabela
 * ausente, banco fora do ar — tudo isso resulta em FECHADO, e o motivo de estar
 * fechado viaja junto, porque "fechado porque o dono decidiu" e "fechado porque
 * não consegui ler o banco" pedem ações diferentes.
 *
 * Isso também é a regra da casa para o caminho do dinheiro (CLAUDE.md): sem
 * referência confiável, REJEITA. Não negociar é seguro; negociar às cegas não.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const CHAVE_LIBERACAO = "autopilot_cex_liberado";
export const CHAVE_MOTIVO    = "autopilot_cex_liberado:motivo";

/**
 * Por que a automação está no estado em que está.
 *
 * ⚠️ Quatro causas, não duas. Colapsar `indisponivel` em `fechado_por_decisao`
 * transformaria uma falha de infraestrutura em "o dono não liberou" — e ninguém
 * iria olhar o banco.
 */
export type CausaLiberacao =
  | "aberto"
  | "fechado_por_decisao"
  | "sem_registro"
  | "indisponivel";

export interface Liberacao {
  liberado: boolean;
  causa:    CausaLiberacao;
  /** A justificativa escrita na hora de abrir. Null quando fechado. */
  motivo:   string | null;
  /** Quando o estado atual foi gravado. */
  desde:    string | null;
}

const FECHADO = (causa: CausaLiberacao): Liberacao =>
  ({ liberado: false, causa, motivo: null, desde: null });

/**
 * Lê o estado da liberação. NUNCA lança e NUNCA devolve `liberado: true` por
 * omissão — os dois caminhos de erro caem em fechado, com a causa.
 */
export async function lerLiberacao(): Promise<Liberacao> {
  const db = getSupabaseAdmin();
  if (!db) return FECHADO("indisponivel");
  try {
    const { data, error } = await db
      .from("admin_kv")
      .select("key, value, updated_at")
      .in("key", [CHAVE_LIBERACAO, CHAVE_MOTIVO]);
    if (error) return FECHADO("indisponivel");

    const linhas = data ?? [];
    const chave  = linhas.find((r) => r.key === CHAVE_LIBERACAO);
    if (!chave) return FECHADO("sem_registro");
    // Só a string exata "true" abre. Qualquer outro conteúdo — inclusive lixo
    // de uma escrita antiga — é lido como fechado.
    if (chave.value !== "true") {
      return { ...FECHADO("fechado_por_decisao"), desde: chave.updated_at ?? null };
    }
    const motivo = linhas.find((r) => r.key === CHAVE_MOTIVO)?.value ?? null;
    return {
      liberado: true, causa: "aberto",
      motivo, desde: chave.updated_at ?? null,
    };
  } catch {
    return FECHADO("indisponivel");
  }
}

/** Piso do texto de justificativa — o mesmo de `lab_capital_log.reason`. */
export const MIN_MOTIVO = 15;

export interface ResultadoRegistro {
  ok:      boolean;
  erro?:   "motivo_curto" | "db_indisponivel";
}

/**
 * Abre ou fecha a automação.
 *
 * ⚠️ A ASSIMETRIA É DE PROPÓSITO: ABRIR exige justificativa escrita; FECHAR
 * não exige nada. Abrir é a direção que põe dinheiro de cliente em risco e
 * merece atrito; fechar é a direção segura, e um campo obrigatório na hora de
 * desligar seria atrito no lugar errado — exatamente quando se quer desligar
 * rápido.
 *
 * A justificativa fica GRAVADA porque a decisão vale mais que o clique: daqui a
 * um mês a pergunta será *"o que justificava isto?"*, e a resposta tem que estar
 * no banco, não na memória de quem apertou.
 */
export async function registrarLiberacao(
  liberar: boolean,
  motivo:  string,
): Promise<ResultadoRegistro> {
  const texto = (motivo ?? "").trim();
  if (liberar && texto.length < MIN_MOTIVO) return { ok: false, erro: "motivo_curto" };

  const db = getSupabaseAdmin();
  if (!db) return { ok: false, erro: "db_indisponivel" };

  const agora = new Date().toISOString();
  await db.from("admin_kv").upsert(
    { key: CHAVE_LIBERACAO, value: String(liberar), updated_at: agora },
    { onConflict: "key" },
  );
  await db.from("admin_kv").upsert(
    // Ao fechar, o motivo do fechamento substitui o da abertura — mas o campo
    // nunca fica com a justificativa VELHA ao lado de um estado novo, que seria
    // a pior das leituras: texto convincente descrevendo o que já não vale.
    { key: CHAVE_MOTIVO, value: texto.slice(0, 500) || "(sem motivo declarado)", updated_at: agora },
    { onConflict: "key" },
  );
  return { ok: true };
}
