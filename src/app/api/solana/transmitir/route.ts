import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { transmitir, validarTransacaoAssinada } from "@/lib/solana/transmissao";
import { LIGHTHOUSE } from "@/lib/solana/lighthouse";
import { hashDaMensagem, conferirVinculo } from "@/lib/solana/vinculo";
import { marcarTentativa, reservarTransmissao } from "@/lib/solana/em-voo";

export const runtime = "nodejs";

/**
 * POST /api/solana/transmitir `{ tx: base64 (assinada pela carteira), owner }` (W3).
 *
 * Transmite pelo RPC do SERVIDOR uma transação que a carteira do usuário JÁ assinou — o RPC público
 * recusa (403) qualquer envio vindo de navegador. Nada é assinado aqui; ver `lib/solana/transmissao.ts`.
 *
 *   200 `{ estado: "enviada" | "nao_enviada" | "incerta", assinatura, motivo? }` — a assinatura vai
 *       SEMPRE junto (derivada da própria transação), para reconciliar mesmo se o envio falhar.
 *   400 transação inválida (não chegou ao RPC) · 413 grande demais · 429/503 limites.
 *   409 `anterior_em_aberto` — W3-C: outra transação DESTA carteira ainda pode pousar (trava no banco,
 *       vale entre aparelhos). 503 `trava_indisponivel` — banco fora: falha FECHADA, nada transmitido.
 */
const RL_IP     = { windowMs: 60_000, max: 20 };
const RL_GLOBAL = { windowMs: 60_000, max: Number(process.env.TRANSMISSAO_SOLANA_GLOBAL_MAX ?? 600) };
const SEM_CACHE = { "Cache-Control": "no-store" };
/**
 * ⚠️ Marca das recusas feitas pela APLICAÇÃO antes de qualquer chamada ao RPC. Só com ela o cliente
 * pode afirmar "não transmitida" num 4xx/503 — um 503/429/504 de gateway/infra (sem a marca) pode ter
 * vindo DEPOIS de o servidor transmitir, e é tratado como incerto.
 */
const ANTES = { fase: "antes_do_rpc" } as const;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tamanho = Number(req.headers.get("content-length") ?? "0");
  if (tamanho > 4096) return NextResponse.json({ ok: false, ...ANTES, erro: "grande_demais" }, { status: 413, headers: SEM_CACHE });
  let corpo: { tx?: unknown; owner?: unknown; vinculo?: unknown; mensagemOriginal?: unknown };
  try {
    const texto = await req.text();
    if (texto.length > 4096) return NextResponse.json({ ok: false, ...ANTES, erro: "grande_demais" }, { status: 413, headers: SEM_CACHE });
    corpo = JSON.parse(texto);
  } catch { return NextResponse.json({ ok: false, ...ANTES, erro: "json" }, { status: 400, headers: SEM_CACHE }); }

  const rl = await rateLimitDurable(`sol-tx:${getClientId(req.headers)}`, RL_IP);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, ...ANTES, erro: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { ...SEM_CACHE, "Retry-After": String(rl.retryAfter) } });
  }
  const gb = await rateLimitDurable("sol-tx:global", RL_GLOBAL);
  if (!gb.ok) return NextResponse.json({ ok: false, ...ANTES, erro: "ocupado" }, { status: 503, headers: SEM_CACHE });

  const v = validarTransacaoAssinada(corpo.tx, corpo.owner);
  if (!v.ok) {
    console.warn("[sol-tx]", JSON.stringify({ recusada: v.motivo }));
    return NextResponse.json({ ok: false, ...ANTES, erro: v.motivo }, { status: 400, headers: SEM_CACHE });
  }
  // W3: só a transação que a Z-SWAP cotou (hash, pagador, taxa decidida no servidor) — ver `vinculo.ts`.
  const vin = conferirVinculo(corpo.vinculo, v.tx, Date.now(), corpo.mensagemOriginal);
  if (!vin.ok) {
    console.warn("[sol-tx]", JSON.stringify({ recusada: vin.motivo }));
    return NextResponse.json({ ok: false, ...ANTES, erro: vin.motivo }, { status: 400, headers: SEM_CACHE });
  }
  const assertions = v.tx.message.compiledInstructions.filter(ix =>
    v.tx.message.staticAccountKeys[ix.programIdIndex]?.toBase58() === LIGHTHOUSE);
  if (assertions.length) {
    // Only after HMAC + signatures: structural evidence, never signed bytes or token.
    console.info("[sol-tx-lighthouse]", JSON.stringify({
      origem: hashDaMensagem(v.tx.message.serialize()) === vin.dados.h ? "na_cotacao" : "apos_cotacao",
      variantes: assertions.map(ix => ix.data[0]),
    }));
  }
  /**
   * ⚠️ W3-C: reserva DURÁVEL por carteira antes do RPC. Só chega aqui quem provou a assinatura da
   * carteira sobre a mensagem e o vínculo do servidor — ninguém trava a carteira de outra pessoa.
   */
  const reserva = await reservarTransmissao({
    carteira: v.tx.message.staticAccountKeys[0].toBase58(), assinatura: v.assinatura,
    hashMensagem: vin.dados.h, blockhash: v.tx.message.recentBlockhash, validoAteBloco: vin.dados.l,
  });
  if (reserva.resultado === "indisponivel") {
    console.warn("[sol-tx]", JSON.stringify({ recusada: "trava_indisponivel", motivo: reserva.motivo }));
    return NextResponse.json({ ok: false, ...ANTES, erro: "trava_indisponivel" }, { status: 503, headers: SEM_CACHE });
  }
  if (reserva.resultado === "bloqueada") {
    return NextResponse.json({ ok: false, ...ANTES, erro: "anterior_em_aberto", assinaturaEmAberto: reserva.assinatura },
      { status: 409, headers: SEM_CACHE });
  }
  if (reserva.resultado === "ja_resolvida") {
    // A MESMA transação já tem desfecho: não vai de novo à rede. Expirada nunca pousa (não enviada);
    // confirmada / falhou_na_rede FORAM transmitidas — o status diz o resto.
    const r = reserva.desfecho === "expirada"
      ? { estado: "nao_enviada" as const, assinatura: v.assinatura, motivo: "expirada", transitorio: false }
      : { estado: "enviada" as const, assinatura: v.assinatura };
    return NextResponse.json({ ok: true, ...r }, { headers: SEM_CACHE });
  }
  const r = await transmitir(v);
  await marcarTentativa(v.assinatura, r.estado === "enviada" ? { estado: "enviada" }
    : r.estado === "incerta" ? { estado: "incerta", motivo: r.motivo }
    : { estado: "resolvida", desfecho: "nao_enviada", motivo: r.motivo });
  // Só estado/motivo/assinatura pública — nunca a transação, nunca a URL do RPC.
  console.info("[sol-tx]", JSON.stringify({ estado: r.estado, motivo: "motivo" in r ? r.motivo : null, assinatura: r.assinatura.slice(0, 12) }));
  return NextResponse.json({ ok: true, ...r }, { headers: SEM_CACHE });
}
