import { NextRequest } from "next/server";
import { verifyEvmSignature, normalizeEvmAddress } from "@/lib/auth/siwe";
import { verifySolanaSignature, normalizeSolanaAddress } from "@/lib/auth/siws";
import { issueSession, setSessionCookie, isSessionConfigured } from "@/lib/auth/session";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";
import type { WalletChain } from "@/lib/supabase/types";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/verify
 * Body: { address, chain: "evm"|"solana", signature }
 *
 * Verifies the signature against the pending (single-use) nonce, upserts the
 * user, issues a 30-day JWT, and sets it as an httpOnly session cookie.
 */
export async function POST(req: NextRequest) {
  const clientId = getClientId(req.headers);
  const rl = await rateLimitDurable(`auth-verify:${clientId}`, { windowMs: 60_000, max: 20 });
  if (!rl.ok) {
    return json({ ok: false, error: "rate_limited" }, 429, { "Retry-After": String(rl.retryAfter) });
  }

  if (!isSupabaseConfigured() || !isSessionConfigured()) {
    return json({ ok: false, error: "auth_unconfigured" }, 503);
  }

  let body: { address?: string; chain?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const chain = body.chain;
  if (chain !== "evm" && chain !== "solana") {
    return json({ ok: false, error: "invalid_chain" }, 400);
  }
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!signature || signature.length > 200) {
    return json({ ok: false, error: "invalid_signature" }, 400);
  }

  const address =
    chain === "evm"
      ? normalizeEvmAddress(body.address ?? "")
      : normalizeSolanaAddress(body.address ?? "");
  if (!address) {
    return json({ ok: false, error: "invalid_address" }, 400);
  }

  return finishVerify(address, chain, signature);
}

async function finishVerify(address: string, chain: WalletChain, signature: string) {
  // Pull and consume the stored nonce for this wallet. We stored only one, so
  // we look it up, validate the signature against it, then it's already gone.
  const db = getSupabaseAdmin();
  if (!db) return json({ ok: false, error: "auth_unconfigured" }, 503);

  /**
   * ⚠⚠ CONSUMIR É O DELETE, NÃO O SELECT — achado A01 da auditoria externa.
   *
   * Antes eram três passos: SELECT, verifica, DELETE. Dois pedidos concorrentes
   * com a MESMA assinatura liam os dois a mesma linha, verificavam os dois com
   * sucesso, e saíam os dois com sessão. O comentário abaixo diz
   * *"Single-use regardless of outcome"* — a intenção estava certa e o passo
   * que a garantia vinha DEPOIS da decisão.
   *
   * ⚠⚠ E ERA PIOR PELO OUTRO LADO: o `error` do DELETE era jogado fora.
   * `supabase-js` RESOLVE com `{ error }` e não lança, então um DELETE recusado
   * deixava o nonce DE PÉ — reutilizável até expirar, para quem tivesse a
   * assinatura. Uso único que depende de uma escrita nunca conferida não é uso
   * único.
   *
   * `DELETE … RETURNING` resolve os dois de uma vez: o Postgres serializa, e de
   * duas chamadas concorrentes exatamente UMA leva a linha. Quem não levou não
   * tem contra o que verificar — que é a resposta certa. É o mesmo mecanismo de
   * `tryLockSession` e da trava do DCA.
   */
  const { data: consumidas, error: erroDoConsumo } = await db
    .from("auth_nonces")
    .delete()
    .eq("wallet_address", address)
    .select("nonce, issued_at, expires_at");

  if (erroDoConsumo) {
    /**
     * ⚠️ FALHA FECHADO. Sem conseguir CONSUMIR o desafio não dá para conceder
     * sessão: seguir aqui é exatamente o caminho que deixava o nonce vivo.
     */
    return json({ ok: false, error: "auth_unavailable" }, 503);
  }

  const nonceRow = consumidas?.[0];
  if (!nonceRow) return json({ ok: false, error: "no_challenge" }, 400);
  if (new Date(nonceRow.expires_at).getTime() < Date.now()) {
    // Já foi removido pelo próprio consumo acima — nada a apagar aqui.
    return json({ ok: false, error: "challenge_expired" }, 400);
  }

  // The wallet signed a message built with `new Date().toISOString()` (…Z),
  // but PostgREST returns timestamptz as `…+00:00`. Round-trip through Date
  // so the reconstructed message matches the signed bytes exactly.
  const issuedAt = new Date(nonceRow.issued_at).toISOString();

  const ok =
    chain === "evm"
      ? await verifyEvmSignature({ address, signature, nonce: nonceRow.nonce, issuedAt })
      : verifySolanaSignature({ address, signature, nonce: nonceRow.nonce, issuedAt });

  // ⚠️ O nonce JÁ foi queimado — o consumo aconteceu no `DELETE … RETURNING`
  // lá em cima, ANTES da verificação. Uso único independente do desfecho
  // continua valendo (tentativa falha também gasta o desafio), e agora vale
  // também sob concorrência.

  if (!ok) {
    console.warn(`[auth] signature verification failed for ${chain} wallet ${address.slice(0, 6)}…`);
    return json({ ok: false, error: "bad_signature" }, 401);
  }

  // Upsert the user record (wallet-first; email stays null until captured).
  await db
    .from("users")
    .upsert(
      { wallet_address: address, wallet_chain: chain, last_seen_at: new Date().toISOString() },
      { onConflict: "wallet_address" },
    );

  const token = await issueSession({ sub: address, chain });
  await setSessionCookie(token);

  return json({ ok: true, address, chain });
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}
