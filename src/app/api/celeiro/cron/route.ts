import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordEvent } from "@/lib/admin/track";
import { oControle, agentePor } from "@/lib/celeiro/agentes";
import { acumular, lerTaxaDeEmprestimo } from "@/lib/celeiro/aluguel";
import {
  lerSerieDeFunding, colher, portao, anualizar, PERIODOS_POR_DIA,
  CUSTO_DO_CICLO_PCT,
} from "@/lib/celeiro/funding-colheita";
import {
  registrarFluxo, ultimoLancamentoMs, genomaAtivo, lerRelogio, marcarRelogio,
} from "@/lib/celeiro/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O DESPERTADOR DO CELEIRO.
 *
 * ⚠️ SÓ OS DOIS AGENTES DE RENDA ACORDAM AQUI, e é decisão e não atraso. O
 * Aluguel de Ocioso é o CONTROLE — sem ele medindo, nenhum outro número tem
 * régua. A Colheita de Funding é a única fonte que sobreviveu a uma medição
 * honesta. Os três de estrutura e evento entram quando estes dois provarem que
 * o extrato fecha; ligar cinco de uma vez faria um erro de contabilidade
 * aparecer em cinco lugares e não se saber de onde veio.
 *
 * ⚠️ TUDO EM PAPEL. Funding, base e profundidade são dados PÚBLICOS — dá para
 * medir de verdade sem arriscar um centavo. A arena antiga queimou dois meses
 * num sinal pior que uma moeda porque a régua estava errada; aqui a régua vem
 * primeiro. Quando o extrato provar USDT positivo em amostra que aguente,
 * liga-se credencial.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/** O capital de papel de cada agente. Um número, num lugar só. */
const CAPITAL_PAPEL_USD = Number(process.env.CELEIRO_CAPITAL_PAPEL_USD ?? 1000);

/** Os símbolos que a Colheita examina. Poucos e líquidos, de propósito. */
const SIMBOLOS = (process.env.CELEIRO_SIMBOLOS ?? "BTC,ETH,SOL").split(",").map((s) => s.trim());

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, erro: "unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, erro: "sem banco" }, { status: 503 });

  const agora = Date.now();
  const relato: Record<string, unknown> = {};

  // ── ① O CONTROLE ────────────────────────────────────────────────────────
  const controle = oControle();
  const taxa = await lerTaxaDeEmprestimo();

  if (taxa === null) {
    /**
     * ⚠️ TAXA NÃO LIDA NÃO CREDITA NADA, e o silêncio fica registrado. Creditar
     * com a taxa de ontem inventaria juro de um período que ninguém observou —
     * e como este agente é a RÉGUA, o erro contaminaria o julgamento de todos os
     * outros de uma vez.
     */
    relato.aluguel = { creditou: 0, porque: "taxa não lida — não medido não credita" };
    await recordEvent("celeiro_tick", { meta: { agente: controle.id, semTaxa: true } });
  } else {
    /**
     * ⚠️ O RELÓGIO VEM DO `admin_kv`, NÃO DO EXTRATO. O crédito é sempre
     * `agora − último visto`, e o "último visto" precisa avançar mesmo nos ticks
     * que creditam zero. Se ele viesse do extrato, o primeiro tick (que não
     * credita nada, de propósito) não deixaria marca — e o controle ficaria
     * congelado em zero para sempre, fazendo TODO agente parecer vencedor.
     */
    const ultimo = await lerRelogio(db, controle.id);
    const a = acumular(CAPITAL_PAPEL_USD, taxa.taxaAnualPct, ultimo, agora);
    const escreveu = a.usdt > 0
      ? await registrarFluxo(db, {
          agente: controle.id, causa: "aluguel", usdt: a.usdt,
          ref: `aluguel:${agora}`,
          meta: { taxaAnualPct: taxa.taxaAnualPct, fonte: taxa.fonte, porque: a.porque,
                  cortadoPorTeto: a.cortadoPorTeto },
        })
      : false;

    // O relógio avança SEMPRE que a taxa foi lida — inclusive no tick zero.
    await marcarRelogio(db, controle.id, agora);

    relato.aluguel = {
      creditou: a.usdt, escreveu, taxaAnualPct: taxa.taxaAnualPct,
      cortadoPorTeto: a.cortadoPorTeto, porque: a.porque,
    };
  }

  // ── ② A COLHEITA DE FUNDING ─────────────────────────────────────────────
  const colheita = agentePor("colheita_funding")!;
  const genoma = await genomaAtivo(db, colheita.id, {
    janelaDias: 30,
    limiteDeSerie: 200,
    /** A folga exigida ACIMA do controle, em pontos percentuais ao ano. */
    margemSobreControlePp: 2,
  });

  const controleAnual = taxa?.taxaAnualPct ?? 0;
  const margem = Number(genoma?.params.margemSobreControlePp ?? 2);
  const janelaDias = Number(genoma?.params.janelaDias ?? 30);
  const exames: Array<Record<string, unknown>> = [];

  for (const simbolo of SIMBOLOS) {
    const serie = await lerSerieDeFunding(simbolo, Number(genoma?.params.limiteDeSerie ?? 200));
    if (serie === null) {
      exames.push({ simbolo, entra: false, porque: "série não lida — não medido não é aprovado" });
      continue;
    }
    const c = colher(serie);

    /**
     * ⚠️ O PORTÃO COMPARA COM O CONTROLE MAIS A MARGEM, nunca com zero. Funding
     * positivo não basta: render menos que o Aluguel de Ocioso significa montar
     * duas pernas e correr risco de liquidação para ganhar menos do que
     * emprestar o USDT parado.
     *
     * ⚠️ E QUANDO A TAXA DO CONTROLE NÃO FOI LIDA, `controleAnual` é 0 — o que
     * BAIXARIA a barra em vez de levantá-la. Por isso o exame é pulado: sem
     * régua não há aprovação, só ausência de comparação.
     */
    if (taxa === null) {
      exames.push({ simbolo, entra: false, porque: "sem a taxa do controle não há barra para comparar" });
      continue;
    }
    const p = portao(c, controleAnual + margem, janelaDias);
    exames.push({
      simbolo, entra: p.entra, porque: p.porque,
      anualPct: anualizar(c, janelaDias),
      periodos: c.periodos, fatiaNegativa: c.fatiaNegativa,
      equilibrioEmDias: c.equilibrioEmDias,
    });

    if (!p.entra) continue;

    /**
     * A posição de papel: entra uma vez e passa a colher. A entrada paga METADE
     * do ciclo — as outras duas pernas serão pagas na saída, e cobrá-las agora
     * faria o agente parecer pior do que é enquanto a posição vive.
     */
    const jaEntrou = await ultimoLancamentoMs(db, colheita.id, "taxa");
    if (jaEntrou === null) {
      await registrarFluxo(db, {
        agente: colheita.id, causa: "taxa",
        usdt: -(CAPITAL_PAPEL_USD * (CUSTO_DO_CICLO_PCT / 2) / 100),
        simbolo, ref: `entrada:${simbolo}:${agora}`, genomaVersao: genoma?.versao ?? null,
        meta: { pernas: 2, de: "spot compra + perp venda", porque: p.porque },
      });
      continue;   // sem funding ainda: a posição nasceu neste instante
    }

    const ultimoFunding = await ultimoLancamentoMs(db, colheita.id, "funding");
    const desde = ultimoFunding ?? jaEntrou;
    const periodosDecorridos = Math.floor((agora - desde) / (8 * 3_600_000));
    if (periodosDecorridos < 1) continue;

    /**
     * ⚠️ USA A TAXA MAIS RECENTE PUBLICADA, não a média da janela. A média
     * descreve o passado; quem paga o próximo período é a taxa vigente. Creditar
     * a média inventaria um funding que ninguém recebeu.
     */
    const recente = serie[serie.length - 1]?.taxaPct ?? 0;
    const usdt = CAPITAL_PAPEL_USD * (recente / 100) * periodosDecorridos;
    if (usdt !== 0) {
      await registrarFluxo(db, {
        agente: colheita.id, causa: "funding", usdt,
        simbolo, ref: `funding:${simbolo}:${agora}`, genomaVersao: genoma?.versao ?? null,
        meta: { periodos: periodosDecorridos, taxaPct: recente, porDia: PERIODOS_POR_DIA },
      });
    }
  }

  relato.colheita = { genomaVersao: genoma?.versao ?? null, controleAnualPct: controleAnual, margem, exames };

  await recordEvent("celeiro_tick", { meta: relato });
  return NextResponse.json({ ok: true, emMs: agora, ...relato });
}
