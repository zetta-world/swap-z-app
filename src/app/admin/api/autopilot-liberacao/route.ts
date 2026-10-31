import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { comandoAuditado, avisoDeAuditoria, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  lerLiberacao, registrarLiberacao, MIN_MOTIVO,
  lerPilotosConferido, gravarPilotos, type Piloto,
} from "@/lib/autopilot/liberacao";

export const dynamic = "force-dynamic";

/**
 * A LIBERAÇÃO DA AUTOMAÇÃO DE CEX — o interruptor da Fase 7.2.
 *
 * ⚠️ NÃO ENTROU NA ROTA DE KILL-SWITCH de propósito. Lá o default é
 * "ausência = ligado", que é certo para as mesas internas e ERRADO para uma
 * trava de liberação: ali um `admin_kv` vazio deixaria a automação aberta.
 * Semânticas opostas na mesma rota viram, três meses depois, alguém copiando o
 * padrão errado.
 *
 * E abrir exige justificativa ESCRITA — a decisão vale mais que o clique. A
 * pergunta daqui a um mês é *"o que justificava isto?"*, e a resposta tem que
 * estar no banco.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  // Leitura falha NÃO vira "nenhum piloto": a tela mostra que não sabe.
  const p = await lerPilotosConferido();
  return NextResponse.json({
    ...(await lerLiberacao()),
    minMotivo: MIN_MOTIVO,
    verdes: await verdesDoLaboratorio(),
    pilotos: p.ok ? p.lista : [],
    pilotosLidos: p.ok,
    ...(p.ok ? {} : { pilotosErro: p.erro }),
  });
}

/**
 * As estratégias que o laboratório aprovou, ao lado do interruptor.
 *
 * ⚠️ POR QUE A EVIDÊNCIA VEM JUNTO: o dono pediu para liberar *"quando tiver
 * algo que realmente seja justificável"*. Um interruptor sozinho depende da
 * memória de quem aperta; com as verdes na tela, a decisão é tomada na frente
 * do que foi medido.
 *
 * ⚠️ E NÃO FILTRO POR "É DE CORRETORA": `lab_strategies.family` é
 * carrego/direcional/estrutura — não existe campo de venue. Inventar a
 * classificação aqui por adivinhação de nome seria pior que mostrar tudo e
 * dizer a ressalva na tela.
 */
async function verdesDoLaboratorio(): Promise<Array<{
  name: string; family: string; capitalUsd: number;
}>> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("lab_strategies")
      .select("name, family, capital_required_usd")
      .eq("status", "verde")
      .order("name");
    return (data ?? []).map((r) => ({
      name: r.name, family: r.family, capitalUsd: Number(r.capital_required_usd),
    }));
  } catch { return []; }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();

  const body = await req.json().catch(() => null) as
    { liberar?: unknown; motivo?: unknown; piloto?: unknown; remover?: unknown } | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  /**
   * ⚠️ AUTORIZAR UMA CARTEIRA PILOTO É ABRIR UM FURO NA TRAVA: ela vai negociar
   * com DINHEIRO REAL numa feature fechada para todo o resto. Por isso custa
   * nota escrita, igual a abrir a trava — e sai no log de auditoria com a nota.
   */
  if (typeof body.piloto === "string" || typeof body.remover === "string") {
    /**
     * ⚠️⚠️ LEITURA CONFERIDA ANTES DE REGRAVAR (Admin CC 2.0, P0 de 25/10). Com
     * `lerPilotos` (que devolve [] na falha, certo para a trava), uma leitura que
     * falhava fazia este POST gravar a lista só com a carteira nova — APAGANDO os
     * outros pilotos. Agora: falhou → 503 e nada é gravado; gravação condicional
     * ao valor lido (outro admin mudou → 409).
     */
    const leitura = await lerPilotosConferido();
    if (!leitura.ok) {
      return NextResponse.json({
        error: "pilotos_ilegiveis", detalhe: leitura.erro,
        porque: "NADA foi alterado: não consegui ler a lista atual de pilotos para conferir",
      }, { status: 503 });
    }
    const lista = leitura.lista;
    let acao: string, alvo: string, nova: Piloto[], dados: Record<string, unknown>;
    if (typeof body.remover === "string") {
      alvo = body.remover.toLowerCase();
      nova = lista.filter((p) => p.wallet !== alvo);
      acao = "autopilot.piloto.remover";
      dados = {};
    } else {
      alvo = (body.piloto as string).trim().toLowerCase();
      const nota = typeof body.motivo === "string" ? body.motivo.trim() : "";
      if (alvo.length < 8) return NextResponse.json({ error: "carteira_invalida" }, { status: 400 });
      if (nota.length < MIN_MOTIVO) {
        return NextResponse.json({ error: "motivo_curto", minMotivo: MIN_MOTIVO }, { status: 400 });
      }
      // Reautorizar a mesma carteira ATUALIZA a nota em vez de duplicar a linha:
      // duas entradas para a mesma carteira com notas diferentes seriam dois
      // registros contando histórias diferentes sobre o mesmo poder.
      nova = [
        ...lista.filter((p) => p.wallet !== alvo),
        { wallet: alvo, nota: nota.slice(0, 300), at: new Date().toISOString() },
      ];
      acao = "autopilot.piloto.autorizar";
      dados = { nota: nota.slice(0, 300) };
    }
    const r = await comandoAuditado({
      acao, ator: actor, alvo, antes: lista.map((p) => p.wallet), depois: nova.map((p) => p.wallet), dados,
      executar: async () => {
        const g = await gravarPilotos(nova, leitura.bruto);
        return g.ok ? { ok: true, valor: nova } : { ok: false, codigo: g.erro };
      },
    });
    if (r.estado === "recusado") {
      return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
    }
    if (r.estado === "falhou") {
      return NextResponse.json({
        error: r.codigo, ...avisoDeAuditoria(r.auditoria),
        porque: r.codigo === "conflito"
          ? "NADA foi alterado: outro admin mudou a lista de pilotos — releia"
          : r.codigo === "excecao"
            ? "a gravação lançou exceção — a lista pode ter mudado; releia antes de repetir"
            : "a lista de pilotos NÃO foi gravada",
      }, { status: r.codigo === "conflito" ? 409 : r.codigo === "excecao" ? 500 : 503 });
    }
    broadcastAdminRefresh("audit");
    return NextResponse.json({ ok: true, pilotos: r.estado === "executado" ? r.valor : nova, ...(r.estado === "executado" ? avisoDeAuditoria(r.auditoria) : {}) });
  }

  if (typeof body.liberar !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const liberar = body.liberar;
  const motivo = typeof body.motivo === "string" ? body.motivo : "";
  if (liberar && motivo.trim().length < MIN_MOTIVO) {
    return NextResponse.json({ error: "motivo_curto", minMotivo: MIN_MOTIVO }, { status: 400 });
  }

  // O log de auditoria carrega a justificativa junto — um registro de "abriu"
  // sem o porquê é a metade que não serve para nada depois.
  const r = await comandoAuditado({
    acao: "autopilot.liberacao", ator: actor, depois: String(liberar),
    dados: { liberar, motivo: motivo.slice(0, 500) },
    executar: async () => {
      const g = await registrarLiberacao(liberar, motivo);
      return g.ok ? { ok: true, valor: true } : { ok: false, codigo: g.erro ?? "escrita_falhou" };
    },
  });
  if (r.estado === "recusado") {
    return NextResponse.json({ error: "auditoria_indisponivel", porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  if (r.estado === "falhou") {
    return NextResponse.json(
      { error: r.codigo, minMotivo: MIN_MOTIVO, ...avisoDeAuditoria(r.auditoria),
        porque: "a liberação NÃO foi alterada: o banco recusou a gravação" },
      { status: r.codigo === "motivo_curto" ? 400 : 503 },
    );
  }
  broadcastAdminRefresh("audit");
  return NextResponse.json({ ok: true, ...(await lerLiberacao()), ...(r.estado === "executado" ? avisoDeAuditoria(r.auditoria) : {}) });
}
