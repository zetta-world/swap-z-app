import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth/session";
import { configOu404, mesmaOrigem, recusaCsrf, SEM_CACHE } from "@/lib/admin/corp/http";
import { COOKIE_ADMIN } from "@/lib/admin/sessao-corporativa";
import { bootstrapFundador, lerConfigFundador, recuperarMfaFundador, transicionarParaMulti } from "@/lib/admin/corp/fundador";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin-auth/fundador — governança do SOLO FOUNDER MODE (`docs/ADMIN-SOLO-FOUNDER-MODE.md`).
 *
 *   · `{ acao: "bootstrap", autorizacao: "zfb_…" }` — sessão corporativa do fundador com step-up
 *     recente + autorização de uso único (sha256 e janela na env do servidor). UMA vez;
 *   · `{ acao: "recuperar_mfa", autorizacao: "zfb_…" }` — carteira (SIWE) de `ADMIN_WALLETS` +
 *     autorização de RECUPERAÇÃO; devolve o novo código de ativação UMA vez;
 *   · `{ acao: "transicionar_multi" }` — sessão do fundador com step-up; a RPC exige o gate de 2 pessoas.
 *
 * Sem R1 configurado (inclui `legacy`) ou sem `ADMIN_FOUNDER_EMAIL` → 404 (a rota não existe).
 * Toda recusa tem a MESMA resposta (403 `recusado`); o motivo vai para `admin_audit` + evento alto.
 */
const recusado = () => NextResponse.json({ ok: false, erro: "recusado" }, { status: 403, headers: SEM_CACHE });
const inexistente = () => new NextResponse(null, { status: 404, headers: SEM_CACHE });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  if (!lerConfigFundador()) return inexistente();
  if (!mesmaOrigem(req, c.cfg)) return recusaCsrf();
  const rl = await rateLimitDurable(`admin-auth-fundador:${getClientId(req.headers)}`, { windowMs: 60_000, max: 5 });
  if (!rl.ok) return NextResponse.json({ ok: false, erro: "limite" }, { status: 429, headers: SEM_CACHE });
  const corpo = await req.json().catch(() => null) as { acao?: unknown; autorizacao?: unknown } | null;
  const tokenAdmin = req.cookies.get(COOKIE_ADMIN)?.value;

  if (corpo?.acao === "bootstrap") {
    const r = await bootstrapFundador(tokenAdmin, corpo.autorizacao);
    if (!r.ok) return r.codigo === "desligado" ? inexistente() : recusado();
    return NextResponse.json({ ok: true, modo: "solo_founder", porque: "superadmin do fundador criado; o bootstrap não se repete" }, { headers: SEM_CACHE });
  }
  if (corpo?.acao === "recuperar_mfa") {
    const s = await getSession();
    const r = await recuperarMfaFundador(s?.sub ?? null, corpo.autorizacao);
    if (!r.ok) return r.codigo === "desligado" ? inexistente() : recusado();
    return NextResponse.json({
      ok: true, codigoAtivacao: r.codigoAtivacao, validoPorHoras: r.validoPorHoras, fatorSupabase: r.fatorSupabase,
      porque: "guarde este código: ele não aparece de novo. Entre pelo IdP, digite-o e cadastre o novo TOTP",
    }, { headers: SEM_CACHE });
  }
  if (corpo?.acao === "transicionar_multi") {
    const r = await transicionarParaMulti(tokenAdmin);
    if (!r.ok) return recusado();
    return NextResponse.json({ ok: true, modo: "multi_admin" }, { headers: SEM_CACHE });
  }
  return NextResponse.json({ ok: false, erro: "acao_desconhecida" }, { status: 400, headers: SEM_CACHE });
}
