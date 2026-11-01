import { NextResponse } from "next/server";
import { comandoAuditado, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import {
  lerMensagens, escreverMensagem, interlocutorValido, INTERLOCUTORES,
} from "@/lib/ulfhednar/mensagens";
import { sanitizePromptText } from "@/lib/validate";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ÚLFHÉÐNAR — a matilha (`docs/PLANO-ULFHEDNAR.md`).
 *
 * GET  → a linha do tempo do que os agentes fizeram + a caixa de mensagens.
 * POST → o dono escreve uma pergunta para um agente.
 */

/**
 * ⚠️ O QUE CONTA COMO "TRABALHO DE AGENTE" NA LINHA DO TEMPO.
 *
 * Lista EXPLÍCITA, e não "tudo que não for `page_view`". O `platform_events`
 * recebe de tudo — inclusive telemetria de navegação e erro de rede — e uma
 * linha do tempo que mistura os dois vira log cru, que é exatamente o que o
 * dono já tem no painel de eventos e não quer aqui.
 */
const EVENTOS_DE_TRABALHO = [
  "lab_derrapagem", "lab_descartadas", "lab_custo_cex",
  "celeiro_tick", "volante_aprendizado",
  "paper_open_skip", "paper_sem_caixa", "paper_regime_tick",
  "arb_window_empty", "arb2_window_empty", "arb_data_anomaly",
  "autopilot_registro_perdido", "autopilot_taxa_nao_precificada",
  "alert", "security",
] as const;

interface EventoRow { event_type: string; metadata: Record<string, unknown> | null; created_at: string }

export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("agents.mailbox.read");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [eventos, mensagens] = await Promise.all([
    // leitura-limitada: 400 linhas cobrem 7 dias do volume atual (~522/dia no
    // total, dos quais os de trabalho são minoria). Estouro vira `truncado` na
    // resposta — corte silencioso lê-se como "vi tudo".
    selectAllRows<EventoRow>((from, to) =>
      db.from("platform_events")
        .select("event_type, metadata, created_at")
        .in("event_type", EVENTOS_DE_TRABALHO as unknown as string[])
        .gte("created_at", desde)
        .order("created_at", { ascending: false })
        .range(from, to),
    ).catch(() => [] as EventoRow[]),
    lerMensagens(50),
  ]);

  const linha = eventos.slice(0, 400).map((e) => ({
    tipo: e.event_type,
    quando: e.created_at,
    // O `why` é o campo que este repositório usa para a frase legível do
    // evento; sem ele, o resumo é o tipo mesmo.
    resumo: typeof e.metadata?.why === "string"
      ? String(e.metadata.why).slice(0, 240)
      : null,
    fonte: typeof e.metadata?.source === "string" ? String(e.metadata.source) : null,
  }));

  return NextResponse.json({
    linha,
    truncado: eventos.length > 400,
    mensagens,
    interlocutores: INTERLOCUTORES,
    /**
     * ⚠️ AS RESSALVAS VIAJAM NA RESPOSTA. Lida sem elas, esta tela vira "tudo
     * que os agentes fizeram" — e ela mostra só o que passa pelo BANCO.
     */
    naoMostra: [
      "commits e pull requests: eles vivem no GitHub, não no banco, e esta "
        + "aplicação não tem token para lê-los. O registro do código está lá",
      "conversa entre os agentes antes de 23/08: não existe — até então eles "
        + "nunca trocaram uma mensagem, e a coordenação foi pelo git",
      "resposta imediata: uma página web não injeta mensagem numa sessão do "
        + "Claude Code; o agente lê a caixa quando volta a trabalhar",
    ],
    fetchedAt: new Date().toISOString(),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  // `de: "dono"` é o PAPEL no protocolo do mural; quem escreveu de fato vai no
  // evento (`ator`) — com mais de um admin, "dono" sozinho não diz quem foi.
  const { wallet: ator } = await autorizarAdmin("agents.mailbox.write");
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const para = String(body.para ?? "");
  if (!interlocutorValido(para) || para === "dono") {
    return NextResponse.json({ error: "destinatario_invalido" }, { status: 400 });
  }
  const assunto = sanitizePromptText(String(body.assunto ?? ""), 200);
  const corpo   = sanitizePromptText(String(body.corpo ?? ""), 4000);
  if (!assunto || !corpo) {
    return NextResponse.json({ error: "assunto_ou_corpo_vazio" }, { status: 400 });
  }

  /**
   * ⚠️ A matriz marca isto como `duravel_fail_closed` e a rota só tinha
   * `recordEvent` (que engole erro) — revisão adversarial. Instrução a um agente
   * é comando: quem mandou, para quem e o quê ficam na trilha ANTES de gravar.
   */
  const cmd = await comandoAuditado<true>({
    acao: "agents.mailbox.write", ator, alvo: para, dados: { assunto },
    executar: async () => {
      const w = await escreverMensagem({ de: "dono", para, assunto, corpo });
      return w.ok ? { ok: true, valor: true } : { ok: false, codigo: "nao_gravou", detalhe: String(w.erro ?? "").slice(0, 160) };
    },
  });
  if (cmd.estado === "recusado" || cmd.estado === "repetido") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  const r = cmd.estado === "executado" ? { ok: true as const } : { ok: false as const, erro: cmd.detalhe ?? cmd.codigo };
  if (!r.ok) {
    // ⚠️ Pergunta que o dono acha que fez e não existe é pior que erro na cara
    // dele. Mesma lição do autopilot: o cliente resolve com `{ error }`.
    return NextResponse.json({ error: "nao_gravou", detalhe: r.erro }, { status: 500 });
  }
  // ⚠️ AGUARDADO: na Vercel a função congela depois da resposta e o insert se
  // perde. A trava `event-durability` pegou isto — a mesma classe do dia.
  await recordEvent("ulfhednar_pergunta", { meta: { para, assunto, ator } });
  return NextResponse.json({ ok: true });
}
