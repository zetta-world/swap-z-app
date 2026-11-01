import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { lerModoAuth } from "@/lib/admin/authz-modo";

/**
 * Edge middleware — roda antes de toda requisição do matcher abaixo.
 *
 * ⚠️ ELE NÃO DECIDE QUEM É ADMIN, E ISSO É CORREÇÃO DE DEFEITO (11/08).
 *
 * A versão anterior devolvia 404 baseada SÓ em `ADMIN_WALLETS`, com o
 * comentário dizendo que era uma "pré-triagem" e que o `requireAdmin` da
 * página revalidaria depois. Não era pré-triagem: era um PORTÃO. Quando ele
 * dizia não, nada depois dele rodava.
 *
 * Resultado: `requireAdmin` aceita TRÊS origens de permissão — a variável de
 * ambiente, a tabela `platform_admins` e o legado `tier_cache.source='admin'`
 * — e as duas últimas **nunca puderam funcionar**. Conceder acesso pelo painel
 * gravava a linha, mostrava sucesso, e o admin novo levava 404 para sempre.
 * O dono ficou de fora do próprio painel com a carteira que ele mesmo tinha
 * cadastrado.
 *
 * É a família de sempre: duas travas que deviam concordar, a mais estreita
 * rodando primeiro e sendo final.
 *
 * ⚠️ QUEM DECIDE AGORA É UM SÓ: `requireAdmin`. Aqui fica apenas o que a borda
 * consegue fazer barato e sem banco — conferir que existe uma SESSÃO VÁLIDA.
 * Sem sessão, 404 direto (o `requireAdmin` faria o mesmo, e isso poupa a ida
 * ao banco). Com sessão, passa, e a decisão acontece um nível abaixo.
 *
 * ⚠️ E ISSO NÃO AFROUXA NADA. As 54 superfícies sob `/admin` são cobertas:
 * 53 chamam `requireAdmin` diretamente e a restante (`admin/page.tsx`) é
 * embrulhada pelo `admin/layout.tsx`, que chama. Há teste exigindo isso.
 *
 * ⚠️ E MELHORA A OBSERVABILIDADE. Antes, carteira não-admin era barrada na
 * borda em silêncio; agora ela chega ao `requireAdmin`, que grava
 * `admin_access_denied` como sinal de intrusão. Tentativa que ninguém registra
 * não vira alerta.
 *
 * 404 e nunca 403 — a existência do painel não é revelada a quem não entra.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    /**
     * R1 (Admin CC 2.0): em `dual` vale a sessão da carteira OU o cookie corporativo com o FORMATO
     * certo (`za1_` + 43); em `corp` só o corporativo. A borda não tem banco: confere presença/formato,
     * e quem decide é `autorizarAdmin` (revogação, papel, MFA). `legacy` (padrão) = exatamente antes.
     */
    const modo = lerModoAuth();
    const corp = /^za1_[A-Za-z0-9_-]{43}$/.test(req.cookies.get(COOKIE_ADMIN)?.value ?? "");
    // Modo inválido: deixa passar quem tem sessão para o `autorizarAdmin` NEGAR com alerta alto
    // (fechar aqui em silêncio esconderia o erro de operador).
    const temSessao = !modo.ok || modo.modo === "legacy" ? await sessaoValida(req)
      : modo.modo === "corp" ? corp
      : corp || await sessaoValida(req);
    if (!temSessao) {
      return new NextResponse(null, { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

// ---------------------------------------------------------------------------

const ISSUER   = "z-swap";
const AUDIENCE = "z-swap-app";
const COOKIE   = "zswap_session";
/** Mesmo nome de `sessao-corporativa.ts` (repetido: aquele módulo usa node:crypto, a borda é Edge). */
const COOKIE_ADMIN = "__Host-zswap_admin";

/**
 * Existe cookie de sessão assinado e válido? Só isso.
 *
 * ⚠️ NÃO CONFERE PERMISSÃO DE PROPÓSITO. Ver o cabeçalho: permissão é decisão
 * do `requireAdmin`, que enxerga as três origens. Reintroduzir uma checagem de
 * lista aqui recria o portão que trancou o dono para fora.
 */
async function sessaoValida(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return false;

  const secretStr = process.env.AUTH_JWT_SECRET;
  if (!secretStr || secretStr.length < 16) return false;

  try {
    const secret = new TextEncoder().encode(secretStr);
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return typeof payload.sub === "string" && payload.sub.length > 0;
  } catch {
    return false;
  }
}
