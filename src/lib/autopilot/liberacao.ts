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
import { isEnvAdmin } from "@/lib/admin/require";

export const CHAVE_LIBERACAO = "autopilot_cex_liberado";
export const CHAVE_MOTIVO    = "autopilot_cex_liberado:motivo";
export const CHAVE_PILOTOS   = "autopilot_cex_pilotos";

/**
 * ⚠️⚠️ O DCA TEM ESTADO PRÓPRIO — e a falta dele custou o primeiro teste real.
 *
 * `docs/PLANO-DCA-AUTOMATICO.md` §5 diz, com todas as letras, que o gate do DCA
 * é PRÓPRIO: abrir robô de IA ao público e abrir plano de poupança ao público
 * são decisões diferentes, com riscos diferentes. Eu escrevi isso no plano e
 * chamei `lerLiberacao()` no código — que lê a chave do AUTOPILOT.
 *
 * Em 25/08 o dono criou o primeiro plano simulado. A chave
 * `autopilot_cex_liberado` nunca existiu no banco, então o gate leu
 * `sem_registro` = FECHADO, e o plano — que nem toca a IA — foi barrado por uma
 * trava que existe para segurar o robô.
 *
 * ⚠️ E O DCA SIMULADO NÃO GASTA NADA. Exigir liberação de plataforma para um
 * plano que não coloca ordem é trava sem risco do outro lado: ela só impede o
 * teste que existe para provar que o resto funciona.
 */
export const CHAVE_LIBERACAO_DCA = "dca_liberado";
export const CHAVE_MOTIVO_DCA    = "dca_liberado:motivo";
export const CHAVE_PILOTOS_DCA   = "dca_pilotos";

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
export async function lerLiberacao(produto: "autopilot" | "dca" = "autopilot"): Promise<Liberacao> {
  const chaveLib = produto === "dca" ? CHAVE_LIBERACAO_DCA : CHAVE_LIBERACAO;
  const chaveMot = produto === "dca" ? CHAVE_MOTIVO_DCA    : CHAVE_MOTIVO;
  const db = getSupabaseAdmin();
  if (!db) return FECHADO("indisponivel");
  try {
    const { data, error } = await db
      .from("admin_kv")
      .select("key, value, updated_at")
      .in("key", [chaveLib, chaveMot]);
    if (error) return FECHADO("indisponivel");

    const linhas = data ?? [];
    const chave  = linhas.find((r) => r.key === chaveLib);
    if (!chave) return FECHADO("sem_registro");
    // Só a string exata "true" abre. Qualquer outro conteúdo — inclusive lixo
    // de uma escrita antiga — é lido como fechado.
    if (chave.value !== "true") {
      return { ...FECHADO("fechado_por_decisao"), desde: chave.updated_at ?? null };
    }
    const motivo = linhas.find((r) => r.key === chaveMot)?.value ?? null;
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

/* ─────────────────────────────────────────────────────────────────────────
 * OS PILOTOS — quem roda a automação enquanto ela está FECHADA ao público.
 *
 * O dono: *"a carteira Admin ou uma carteira autorizada pelo painel de controle
 * pode rodar a automação, assim podemos fazer testes futuramente com dinheiro
 * real"*.
 *
 * ⚠️ ISTO É UM FURO DELIBERADO NA TRAVA, e é assim que tem que ser lido. Uma
 * carteira nesta lista negocia com DINHEIRO REAL numa feature que está fechada
 * para todo o resto do mundo. Por isso:
 *
 *   · a lista é EXPLÍCITA e separada — ninguém entra nela por consequência;
 *   · entrar exige uma NOTA escrita, igual a abrir a trava;
 *   · e `platform_admins` NÃO qualifica. Quem recebeu admin para OLHAR
 *     métricas não pode virar, em silêncio, autorizado a rodar o robô de
 *     dinheiro. Isso seria a invariante nº 14 outra vez: um controle cujo nome
 *     ("admin") diz uma coisa e cujo efeito é outra.
 *
 * O `ADMIN_WALLETS` do ambiente é a exceção, e é exceção por um motivo
 * concreto: é a carteira do dono, mora em variável de ambiente e mudar exige
 * redeploy — não há como alguém ganhar esse poder com um clique.
 * ───────────────────────────────────────────────────────────────────────── */

export interface Piloto {
  wallet: string;
  /** Por que esta carteira foi autorizada. Obrigatória — ver a nota acima. */
  nota:   string;
  at:     string;
}

/** Lê a lista de pilotos. Erro de leitura devolve lista VAZIA — fecha, não abre. */
export async function lerPilotos(produto: "autopilot" | "dca" = "autopilot"): Promise<Piloto[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data, error } = await db
      .from("admin_kv").select("value")
      .eq("key", produto === "dca" ? CHAVE_PILOTOS_DCA : CHAVE_PILOTOS).maybeSingle();
    if (error || !data?.value) return [];
    const bruto = JSON.parse(data.value) as unknown;
    if (!Array.isArray(bruto)) return [];
    return bruto
      .filter((p): p is Piloto =>
        !!p && typeof (p as Piloto).wallet === "string" && (p as Piloto).wallet.length > 0)
      .map((p) => ({ wallet: p.wallet.toLowerCase(), nota: String(p.nota ?? ""), at: String(p.at ?? "") }));
  } catch { return []; }
}

export async function gravarPilotos(lista: Piloto[]): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return false;
  await db.from("admin_kv").upsert(
    { key: CHAVE_PILOTOS, value: JSON.stringify(lista.slice(0, 50)), updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  return true;
}

export type CausaAutomacao = CausaLiberacao | "piloto_autorizado";

export interface VereditoAutomacao {
  permitido: boolean;
  causa:     CausaAutomacao;
}

/**
 * ⚠️ A DECISÃO POR CARTEIRA, separada da leitura — mesma razão de
 * `decidirArmar`: decisão sem teste é como o `readOnly` nasceu fixo.
 *
 * Recebe o estado já lido para o cron poder julgar N sessões com UMA ida ao
 * banco. Chamar por sessão faria a trava custar uma consulta por cliente.
 */
export function decidirAutomacao(
  wallet:    string,
  liberacao: Liberacao,
  pilotos:   Piloto[],
): VereditoAutomacao {
  if (liberacao.liberado) return { permitido: true, causa: "aberto" };

  const w = (wallet ?? "").toLowerCase();
  if (!w) return { permitido: false, causa: liberacao.causa };
  // A carteira do dono (env) e as autorizadas explicitamente no painel.
  if (isEnvAdmin(w) || pilotos.some((p) => p.wallet === w)) {
    return { permitido: true, causa: "piloto_autorizado" };
  }
  return { permitido: false, causa: liberacao.causa };
}

/** Atalho para quem julga UMA carteira só (rotas de request). */
export async function podeAutomatizar(wallet: string): Promise<VereditoAutomacao> {
  const [liberacao, pilotos] = await Promise.all([lerLiberacao(), lerPilotos()]);
  return decidirAutomacao(wallet, liberacao, pilotos);
}
