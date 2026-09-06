/**
 * O TICK DO PAPEL ADIANTE — a costura entre a decisão pura e o banco.
 *
 * ⚠️ A ARITMÉTICA VIVE EM `papel.ts`, testada sem rede. Aqui só há leitura,
 * escrita e o laço — a mesma separação de `celeiro/store.ts` e `mercado/store.ts`.
 *
 * ⚠️⚠️ ELE É MELHOR-ESFORÇO E NUNCA DERRUBA O CHAMADOR. Ele roda pendurado no
 * cron do `/api/zion/backtest`, que faz muita coisa mais importante em 30
 * minutos: uma mesa de cliente com problema não pode levar junto o flywheel, o
 * oráculo e o papel da casa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierForWallet } from "@/lib/tier/check";
import { velasDoIntervalo } from "@/lib/mercado/store";
import { lerEstrategia } from "@/lib/bancada/vocabulario";
import {
  mesasLigadasParaOCron, posicoesAbertasParaOCron, abrirPosicao, fecharPosicao,
  type MesaDoCron,
} from "@/lib/bancada/store";
import {
  mesasQuePodemTickar, decidirAbertura, decidirFechamento, MESAS_POR_TICK, type Mesa,
} from "@/lib/bancada/papel";
import type { WalletChain } from "@/lib/supabase/types";
import type { Dono } from "@/lib/bancada/dono";

/** Quantas velas o tick lê por símbolo. Suficiente para o gatilho mais longo. */
const VELAS_POR_MESA = 420;

export interface ResumoDoTique {
  mesas: number;
  abertas: number;
  fechadas: number;
  /** Mesas ignoradas por o plano do dono não as cobrir mais (downgrade). */
  cortadasPorPlano: number;
  problemas: string[];
}

/**
 * Um tick de todas as mesas vivas.
 *
 * ⚠️ A CHAIN VEM DA SESSÃO ORIGINAL? Não — aqui não há sessão. `getTierForWallet`
 * precisa dela para saber se checa passe na Solana, e a linha da estratégia
 * guarda a `chain` de quando foi criada. Ela é lida do banco junto com a mesa.
 */
export async function tiqueDoPapelAdiante(
  db: SupabaseClient, agoraMs: number = Date.now(),
): Promise<ResumoDoTique> {
  const resumo: ResumoDoTique = { mesas: 0, abertas: 0, fechadas: 0, cortadasPorPlano: 0, problemas: [] };

  const ligadas = await mesasLigadasParaOCron(db);
  if (ligadas.length === 0) return resumo;

  const abertas = await posicoesAbertasParaOCron(db);
  const abertasPorEstrategia = new Map<string, typeof abertas[number]>();
  for (const p of abertas) abertasPorEstrategia.set(p.estrategiaId, p);

  // ── 1. Fechar o que já venceu ────────────────────────────────────
  for (const p of abertas) {
    const mesa = ligadas.find((m) => m.id === p.estrategiaId);
    if (!mesa) continue;
    const lida = lerEstrategia(mesa.params);
    if (!lida.ok) { resumo.problemas.push(`${mesa.id}: ${lida.porque}`); continue; }

    // ⚠️ `aberta_em` é quando a LINHA nasceu — é ele que datam a posição para o
    // fechamento; `vela_em` é de qual vela veio o sinal, e serve à guarda de
    // reabertura. Confundir os dois foi o remendo que a 0040 desfez.
    const abertaEmMs = Date.parse(p.abertaEm) || 0;
    const leitura = await velasDoIntervalo(
      db, p.simbolo, mesa.intervalo,
      // ⚠️ A janela começa na ABERTURA da posição: velas anteriores a ela não
      // podem fechá-la, e trazê-las só gastaria leitura.
      abertaEmMs > 0 ? abertaEmMs : agoraMs - VELAS_POR_MESA * 3_600_000,
      agoraMs, agoraMs,
    );
    const f = decidirFechamento(lida.valor,
      { entrada: p.entrada, tamanhoUsd: p.tamanhoUsd, abertaEmMs }, leitura.velas, agoraMs);
    if (!f) continue;

    const r = await fecharPosicao(p.dono, db, p.id, f.status, f.saida, f.resultadoPct);
    if (r.ok) { resumo.fechadas++; abertasPorEstrategia.delete(p.estrategiaId); }
    else resumo.problemas.push(`fechar ${p.id}: ${r.porque}`);
  }

  // ── 2. Agrupar por dono e aplicar o teto do plano ────────────────
  const porDono = new Map<Dono, MesaDoCron[]>();
  for (const m of ligadas) {
    const lista = porDono.get(m.dono) ?? [];
    lista.push(m);
    porDono.set(m.dono, lista);
  }

  let processadas = 0;
  for (const [dono, doDono] of porDono) {
    if (processadas >= MESAS_POR_TICK) break;

    /**
     * ⚠️⚠️ O TIER É RELIDO A CADA TICK. Quem cai de `trader` para `pro` para de
     * tickar sozinho — sem isso continuaria consumindo cron para sempre depois
     * de parar de pagar por isso, e nada quebraria para denunciar.
     */
    const chain: WalletChain = dono.startsWith("0x") ? "evm" : "solana";
    const { tier } = await getTierForWallet(dono, chain);

    const comoMesa: Mesa[] = doDono.flatMap((m) => {
      const lida = lerEstrategia(m.params);
      if (!lida.ok) { resumo.problemas.push(`${m.id}: ${lida.porque}`); return []; }
      const aberta = abertasPorEstrategia.get(m.id);
      return [{
        id: m.id, dono, params: lida.valor, simbolos: m.simbolos, intervalo: m.intervalo,
        ultimaAberturaMs: aberta?.velaEm ?? null,
        temPosicaoAberta: Boolean(aberta),
        criadaEm: m.criadaEm,
      }];
    });

    const { tickam, cortadas } = mesasQuePodemTickar(comoMesa, tier);
    resumo.cortadasPorPlano += cortadas.length;

    // ── 3. Abrir o que o sinal mandar ─────────────────────────────
    for (const mesa of tickam) {
      if (processadas >= MESAS_POR_TICK) break;
      processadas++;
      resumo.mesas++;

      for (const simbolo of mesa.simbolos) {
        const leitura = await velasDoIntervalo(
          db, simbolo, mesa.intervalo, agoraMs - VELAS_POR_MESA * 3_600_000, agoraMs, agoraMs,
        );
        const d = decidirAbertura(mesa, leitura.velas, agoraMs);
        if (!d.abre) continue;

        const r = await abrirPosicao(mesa.dono, db, {
          estrategiaId: mesa.id, simbolo,
          lado: mesa.params.direcao === "compra" ? "long" : "short",
          entrada: d.preco,
          // ⚠️ Tamanho fixo de papel: a bancada mede a IDEIA, não o
          // dimensionamento. Deixar o cliente escolher o tamanho aqui mudaria o
          // resultado sem mudar a estratégia.
          tamanhoUsd: 1000,
          alvoPct: mesa.params.alvoPct, stopPct: mesa.params.stopPct,
          // ⚠️ Cada coluna com o seu significado (0040): `expiraEm` é quando a
          // posição vence, `velaEm` é de qual vela veio o sinal.
          expiraEm: new Date(d.velaMs + mesa.params.horasLimite * 3_600_000).toISOString(),
          velaEm: d.velaMs,
        });
        if (r.ok) resumo.abertas++;
        else resumo.problemas.push(`abrir ${mesa.id}/${simbolo}: ${r.porque}`);
      }
    }
  }

  return resumo;
}
