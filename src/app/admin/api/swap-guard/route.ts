import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { JUPITER_ALLOWED_PROGRAMS, verifyJupiterTransaction, extractProgramIds } from "@/lib/swap/solana-guard";
import { fetchJupiterQuote, fetchJupiterSwap, JUPITER_SOL_MINT } from "@/lib/api/jupiter";
import { VersionedTransaction, PublicKey } from "@solana/web3.js";

export const dynamic = "force-dynamic";

/**
 * Leitura do guard de Solana. Existe pra responder UMA pergunta em segundos:
 * "o guard está recusando swap que devia passar?".
 *
 * O número que importa é a TAXA de recusa, não a contagem. 12 recusas pode ser
 * um ataque isolado (12 de 50.000) ou o guard quebrado (12 de 12) — sem o
 * denominador, o número não diz nada. Por isso o cliente reporta os dois lados.
 */
type Row = {
  metadata: { ok?: boolean; mode?: string; blocked?: boolean; unknownPrograms?: string[]; symbol?: string } | null;
  created_at: string;
};

export async function GET(req: NextRequest): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const rawHours = Number(req.nextUrl.searchParams.get("hours") ?? "");
  const hours = Number.isFinite(rawHours) && rawHours > 0 && rawHours <= 720 ? rawHours : 24;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();

  const { data } = await db.from("platform_events")
    .select("metadata, created_at")
    .eq("event_type", "swap_guard")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  const rows = (data ?? []) as Row[];
  let passed = 0, refused = 0, blocked = 0;
  const byProgram = new Map<string, { count: number; lastSeen: string; symbols: Set<string> }>();
  let mode = "shadow";

  for (const r of rows) {
    const m = r.metadata;
    if (!m) continue;
    if (typeof m.mode === "string") mode = m.mode; // o mais recente vence
    if (m.ok) { passed++; continue; }
    refused++;
    if (m.blocked) blocked++;
    for (const p of m.unknownPrograms ?? []) {
      const cur = byProgram.get(p) ?? { count: 0, lastSeen: r.created_at, symbols: new Set<string>() };
      cur.count++;
      if (r.created_at > cur.lastSeen) cur.lastSeen = r.created_at;
      if (m.symbol) cur.symbols.add(m.symbol);
      byProgram.set(p, cur);
    }
  }

  const total = passed + refused;
  const refusalRate = total > 0 ? refused / total : null;

  // Um programa desconhecido que aparece MUITO e de forma consistente quase
  // certamente é a Jupiter tendo mudado algo — não um atacante. Atacante não
  // consegue disparar em toda a base de usuários ao mesmo tempo.
  const unknown = [...byProgram.entries()]
    .map(([program, v]) => ({
      program, count: v.count, lastSeen: v.lastSeen,
      symbols: [...v.symbols].slice(0, 6),
      likelyJupiterChange: total > 0 && v.count / total > 0.3,
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    mode, hours,
    passed, refused, blocked, total, refusalRate,
    unknown,
    allowedPrograms: JUPITER_ALLOWED_PROGRAMS,
    // Veredito pronto: o painel não deve exigir que alguém faça a conta na hora
    // de um incidente.
    verdict:
      total === 0 ? "sem tráfego Solana nesta janela"
      : refusalRate! > 0.5 ? "⚠ MAIORIA RECUSADA — provável mudança da Jupiter, NÃO ataque. Verifique o programa abaixo e adicione à lista."
      : refusalRate! > 0.05 ? "recusas acima do esperado — investigar"
      : "saudável",
    fetchedAt: new Date().toISOString(),
  });
}

/**
 * POST — SONDA DE VERIFICAÇÃO.
 *
 * O problema que isto resolve: o guard só ganha confiança vendo transações
 * REAIS da Jupiter, mas esperar tráfego orgânico de uma plataforma que ainda
 * não lançou é esperar para sempre. E a dúvida central — se algum program ID
 * legítimo chega por Address Lookup Table, o que faria o guard recusar swap
 * honesto — não se responde por leitura de código.
 *
 * Uma cotação + montagem de transação é só chamada de API: sem fundos, sem
 * assinatura, sem gás, sem nada on-chain. Então dá pra pedir à Jupiter a
 * transação de verdade, decodificar e rodar o guard em cima — a mesma jogada
 * que resolveu o auto-populate da allowlist de EVM.
 *
 * Roda no SERVIDOR de propósito: é ele que alcança a Jupiter.
 */
const PROBE_TAKER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"; // conta conhecida, só leitura
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const probes: Array<Record<string, unknown>> = [];

  // Dois pares: SOL→USDC (envolve wrap/unwrap de SOL, o caminho com MAIS
  // instruções de topo) e USDC→SOL (o inverso, que cria conta associada).
  // Se algum formato quebrar o guard, é num destes dois que aparece.
  const cases = [
    { label: "SOL→USDC", inputMint: JUPITER_SOL_MINT, outputMint: USDC_MINT, amount: "100000000" },
    { label: "USDC→SOL", inputMint: USDC_MINT, outputMint: JUPITER_SOL_MINT, amount: "10000000" },
  ];

  for (const c of cases) {
    try {
      const quote = await fetchJupiterQuote({
        inputMint: c.inputMint, outputMint: c.outputMint, amount: c.amount, slippageBps: 50,
      });
      const swap = await fetchJupiterSwap({ quoteResponse: quote, userPublicKey: PROBE_TAKER });
      const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
      const verdict = verifyJupiterTransaction(tx);
      const programs = extractProgramIds(tx);

      // A pergunta que motivou a sonda: quantas contas vêm de ALT? Se o guard
      // aprovou E existem ALTs, está provado que os program IDs de topo ficam
      // nas chaves estáticas — que era exatamente a incerteza.
      const msg = tx.message as unknown as {
        addressTableLookups?: unknown[]; staticAccountKeys?: PublicKey[];
      };
      probes.push({
        case: c.label,
        guardOk: verdict.ok,
        reason: verdict.reason ?? null,
        programs: programs ?? [],
        unknownPrograms: verdict.unknownPrograms,
        instructionCount: (tx.message as unknown as { compiledInstructions: unknown[] }).compiledInstructions.length,
        staticKeys: msg.staticAccountKeys?.length ?? 0,
        addressLookupTables: msg.addressTableLookups?.length ?? 0,
      });
    } catch (e) {
      probes.push({ case: c.label, error: e instanceof Error ? e.message.slice(0, 200) : "erro" });
    }
  }

  const ran = probes.filter((p) => !p.error);
  const allOk = ran.length > 0 && ran.every((p) => p.guardOk === true);
  const usedAlts = ran.some((p) => Number(p.addressLookupTables) > 0);

  return NextResponse.json({
    probes,
    verdict:
      ran.length === 0 ? "não foi possível falar com a Jupiter — tente de novo"
      : allOk && usedAlts ? "✅ GUARD VALIDADO — aprovou transações reais que USAM lookup tables. A dúvida do ALT está respondida: os program IDs de topo ficam nas chaves estáticas. Pode passar para enforce."
      : allOk ? "✅ guard aprovou as transações reais (nenhuma usou lookup table nesta amostra — repita mais tarde, com rota mais complexa, antes de apertar)"
      : "⚠ o guard RECUSOU uma transação legítima. NÃO ative o enforce. Veja `unknownPrograms`/`reason` abaixo — se houver programa novo, adicione à lista; se disser que não foi possível verificar, é o caso do ALT e o guard precisa de ajuste.",
    fetchedAt: new Date().toISOString(),
  });
}
