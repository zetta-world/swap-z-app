import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { revogarConexao } from "@/lib/cex/conexoes";
import { rateLimitDurable } from "@/lib/rate-limit";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DESLIGAR A CÓPIA DO SERVIDOR — achado A15 da auditoria externa.
 *
 * ⚠️⚠️ `revogarConexao` EXISTIA E NÃO ERA CHAMADA POR NINGUÉM. O cabeçalho dela
 * declara, em caixa alta:
 *
 *     ⚠️ REVOGAR É AQUI, E VALE PARA OS DOIS PRODUTOS. É o ponto inteiro do
 *     cofre: um lugar para desligar tudo que usa esta chave.
 *
 * E não havia rota, nem botão, nem chamada. As duas únicas men��ões ao nome no
 * repositório estavam DENTRO DE COMENTÁRIOS de outros arquivos — uma citando-a
 * como cicatriz passada, outra como "o padrão certo duas pastas ao lado".
 *
 * ⚠️ O QUE ISSO SIGNIFICAVA. "Desconectar" no painel limpava o keystore cifrado
 * do NAVEGADOR. A cópia cifrada em `cex_conexoes` — que é a que o CRON usa para
 * negociar com o dono ausente, no DCA real e no autopilot de fundo — continuava
 * `is_active = true` para sempre. O dono desconectava e o servidor seguia com a
 * chave da corretora dele.
 *
 * É a peça certa, escrita, e ligada a NADA — pela décima vez nesta auditoria, e
 * desta vez em credencial de corretora.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  // Revogar é raro e é a ação que mais importa proteger de rajada acidental.
  const rl = await rateLimitDurable(`cex_revogar:${session.sub}`, { windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const exchangeId = String(b.exchangeId ?? "").trim();
  if (!exchangeId || exchangeId.length > 24) {
    return NextResponse.json({ ok: false, error: "exchange_invalida" }, { status: 400 });
  }

  /**
   * ⚠️⚠️ FALHA FECHADO, E DIZ O QUE CONTINUA DE PÉ.
   *
   * `revogarConexao` devolve `false` quando o banco recusa. Responder `ok` aqui
   * seria a mentira mais cara do produto: o dono fecharia a tela acreditando
   * que tirou a chave do servidor, e o cron continuaria negociando com ela.
   */
  const revogou = await revogarConexao(session.sub, exchangeId);
  if (!revogou) {
    await recordEvent("cex_revogacao_falhou", { wallet: session.sub, meta: {
      exchangeId, severity: "high",
      why: "a conexao do SERVIDOR continua ativa: o cron ainda pode negociar com "
        + "esta chave. O dono precisa revogar a chave NA CORRETORA.",
    } });
    return NextResponse.json(
      { ok: false, error: "nao_revogou", exchangeId,
        porque: "a conexão do SERVIDOR continua ATIVA — o robô ainda pode negociar "
          + "com esta chave. Revogue a chave na própria corretora agora." },
      { status: 500 },
    );
  }

  await recordEvent("cex_revogada", { wallet: session.sub, meta: { exchangeId } });
  return NextResponse.json({ ok: true, exchangeId });
}
