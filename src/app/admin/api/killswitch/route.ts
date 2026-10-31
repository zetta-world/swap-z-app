import { NextRequest, NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { logSecurity } from "@/lib/admin/track";
import { CHAVES_DE_INTERRUPTOR } from "@/lib/admin/gate-keys";
import {
  lerInterruptores, observarInterruptores, estadoDoValor, type LinhaKv,
} from "@/lib/admin/kill-switches";
import {
  comandoAuditado, avisoDeAuditoria, PORQUE_AUDITORIA_INDISPONIVEL,
} from "@/lib/admin/auditoria-duravel";

export const dynamic = "force-dynamic";

/**
 * Chaves aceitas = kill-switches da plataforma + TODOS os gates do flywheel,
 * derivados de `gate-keys.ts`.
 *
 * Antes esta lista era digitada à mão e já tinha ficado para trás: `pause_oracle`
 * e `pause_arbiter2` existiam no cron mas NÃO eram desligáveis pelo painel — uma
 * mesa que só se apaga por deploy não tem kill-switch de verdade. Derivar da
 * fonte única faz uma mesa nova nascer controlável, sem ninguém lembrar de
 * atualizar dois arquivos.
 */
const VALID_KEYS: string[] = CHAVES_DE_INTERRUPTOR;

/**
 * GET — o estado de cada interruptor, tri-estado (ADM-004).
 *
 * ⚠️⚠️ A FALHA NÃO VIRA "TUDO DESLIGADO". Esta rota respondia 200
 * `{ switches: {} }` com a nota "admin_kv not yet migrated" em qualquer erro de
 * banco, e os painéis desenhavam OFF/ON a partir do nada. Agora: leitura falha
 * ou passa de 3 s → 503 `unavailable`, e nenhum mapa de estados é devolvido.
 */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("security.killswitch.read");
  const leitura = await lerInterruptores(VALID_KEYS);
  if (!leitura.lido) {
    logSecurity("killswitch_painel_ilegivel", { errorCode: leitura.errorCode }, "med");
    return NextResponse.json({
      state: "unavailable", estado: "unavailable",
      errorCode: leitura.errorCode, source: "admin_kv", asOf: leitura.asOf,
      error: "kill_switches_ilegiveis",
      porque: "não consegui ler o estado dos interruptores — isto NÃO quer dizer que estão desligados",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    state: "ok", asOf: leitura.asOf, source: "admin_kv",
    interruptores: observarInterruptores(leitura, CHAVES_DE_INTERRUPTOR),
  }, { headers: { "Cache-Control": "no-store" } });
}

type Gravacao = { key: string; enabled: boolean; antes: string | null };

/**
 * POST — vira UM interruptor, com compare-and-set e trilha durável.
 *
 * Corpo: `{ key, enabled: boolean, esperado?: boolean, idem?: string }`.
 *   · `esperado` = o estado que a tela MOSTRAVA. Divergiu → 409 `conflito`: dois
 *     admins clicando juntos não desfazem mais um ao outro em silêncio;
 *   · a escrita é condicional ao valor lido (UPDATE … WHERE value = lido), então
 *     uma mudança entre a leitura e a gravação também vira 409, nunca sobrescrita;
 *   · `idem` = chave de idempotência do clique (repetir não grava duas vezes).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await autorizarAdmin("security.killswitch.set");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null) as
    { key?: unknown; enabled?: unknown; esperado?: unknown; idem?: unknown } | null;
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const key = typeof body.key === "string" ? body.key : "";
  if (!VALID_KEYS.includes(key))
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  // ⚠️ `String(undefined)` gravava "undefined" — um valor que nenhum consumidor
  // lê como ligado e que o painel desenhava como desligado.
  if (typeof body.enabled !== "boolean")
    return NextResponse.json({ error: "enabled deve ser booleano" }, { status: 400 });
  const enabled = body.enabled;
  if (body.esperado !== undefined && typeof body.esperado !== "boolean")
    return NextResponse.json({ error: "esperado deve ser booleano" }, { status: 400 });
  const esperado = body.esperado as boolean | undefined;
  const idem = typeof body.idem === "string" && body.idem.length > 0 && body.idem.length <= 100 ? body.idem : null;

  const atual = await lerInterruptores([key]);
  if (!atual.lido) {
    return NextResponse.json({
      error: "leitura_falhou", errorCode: atual.errorCode, key,
      porque: "o interruptor NÃO foi alterado: não consegui ler o estado atual para conferir",
    }, { status: 503 });
  }
  const linha: LinhaKv | null = atual.linhas.get(key) ?? null;
  const antes = linha ? linha.value : null;
  const estadoAntes = estadoDoValor(antes);
  if (esperado !== undefined && estadoAntes !== (esperado ? "on" : "off")) {
    return NextResponse.json({
      error: "conflito", key, atual: estadoAntes, persistido: antes,
      porque: "o interruptor NÃO foi alterado: o estado no banco já não é o que a tela mostrava — releia",
    }, { status: 409 });
  }

  const r = await comandoAuditado<Gravacao>({
    acao: `killswitch.${key}`, ator: actor, alvo: key, antes, depois: String(enabled), idem,
    dados: { enabled },
    executar: async () => {
      /**
       * ⚠️⚠️ UM KILL-SWITCH QUE DIZ "LIGADO" SEM TER GRAVADO É PIOR QUE NÃO TER
       * KILL-SWITCH (achado A25 da auditoria externa, 14/09). `supabase-js`
       * RESOLVE com `{ error }` e não lança: o erro é lido, e o `.select()`
       * separa "gravou" de "a condição não casou" (outro admin mudou antes).
       */
      const agora = new Date().toISOString();
      const escrita = linha
        ? db.from("admin_kv").update({ value: String(enabled), updated_at: agora })
            .eq("key", key).eq("value", linha.value).select("key")
        : db.from("admin_kv").upsert(
            { key, value: String(enabled), updated_at: agora },
            { onConflict: "key", ignoreDuplicates: true },
          ).select("key");
      const { data: gravadas, error: erroDaEscrita } = await escrita;
      if (erroDaEscrita) {
        return { ok: false, codigo: "nao_gravou", detalhe: String(erroDaEscrita.message ?? "").slice(0, 160) };
      }
      if ((gravadas ?? []).length === 0) return { ok: false, codigo: "conflito" };
      return { ok: true, valor: { key, enabled, antes } };
    },
  });

  if (r.estado === "recusado") {
    return NextResponse.json({
      error: "auditoria_indisponivel", key, enabled, porque: PORQUE_AUDITORIA_INDISPONIVEL,
    }, { status: 503 });
  }
  if (r.estado === "repetido") {
    return NextResponse.json({ ok: true, repetido: true, key, enabled });
  }
  if (r.estado === "falhou") {
    const conflito = r.codigo === "conflito";
    return NextResponse.json({
      error: conflito ? "conflito" : r.codigo === "nao_gravou" ? "nao_gravou" : "estado_incerto",
      key, enabled, ...avisoDeAuditoria(r.auditoria),
      porque: conflito
        ? "o interruptor NÃO foi alterado: outro admin mudou o valor durante a gravação — releia"
        : r.codigo === "nao_gravou"
          ? `o interruptor NÃO foi alterado: ${r.detalhe ?? "escrita recusada"}`
          : "a gravação lançou exceção — o estado pode ter mudado; releia antes de repetir",
    }, { status: conflito ? 409 : 500 });
  }

  broadcastAdminRefresh("killswitch");
  broadcastAdminRefresh("audit");
  return NextResponse.json({ ok: true, key, enabled, antes, ...avisoDeAuditoria(r.auditoria) });
}
