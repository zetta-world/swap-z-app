/**
 * ⚠️⚠️ J1–J8 — A RECONCILIAÇÃO DE CONTA INDEPENDENTE DE INTENTS (A103).
 *
 * A reconciliação por intent só roda quando há ordem em dúvida. Um saque do
 * cliente ou uma venda manual no app da corretora não geram intent — e deixam
 * o bot decidindo sobre um inventário que já não existe. Estes testes exercem
 * `reconciliarConta` contra banco e venue falsos, e travam o hook no cron.
 *
 * CONTRATO DO ROUND 3 (A103 cirúrgico):
 *
 *   · a EXISTÊNCIA do inventário é medida pelo saldo TOTAL (free + used),
 *     nunca pelo free sozinho — um exit armado pela própria Z-SWAP move o
 *     saldo para `used` sem tirar um satoshi da conta (cenário A);
 *   · total suficiente mas `free + armada` abaixo do inventário →
 *     `bloqueio_nao_explicado` (cenário C): entradas presas, evento
 *     `account_external_activity`, SEM quarentena e SEM alegar "saldo não
 *     sustenta inventário";
 *   · total abaixo do inventário menos a tolerância → deriva, quarentena
 *     (cenários B/E);
 *   · depósito a mais nunca é deriva nem aumenta posição (cenário D);
 *   · falha de leitura → entradas presas, fail-closed (cenário F).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reconciliarConta, type PosicaoInterna } from "@/lib/cex/execucao/reconciliar-conta";
import type { AutopilotSessionRow, Database } from "@/lib/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CexBalance, CexCredentials } from "@/lib/cex/types";

const CREDS: CexCredentials = { apiKey: "k12345678", apiSecret: "s12345678" };

/** Banco mínimo: só o que `reconciliarConta` toca — updates em autopilot_sessions. */
function dbFalso() {
  const updates: Array<{ patch: Record<string, unknown>; id: string }> = [];
  let falharUpdate = false;
  const db = {
    from: (tabela: string) => {
      if (tabela !== "autopilot_sessions") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => {
            updates.push({ patch, id });
            return Promise.resolve({ error: falharUpdate ? { message: "db fora" } : null });
          },
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, updates,
           falhe: () => { falharUpdate = true; } };
}

function sessao(extra: Partial<AutopilotSessionRow> = {}): AutopilotSessionRow {
  return { id: "sess-1", exchange_id: "binance", wallet_address: "0xabc",
           saldo_baseline: null, quarentena_em: null, quarentena_motivo: null,
           ...extra } as AutopilotSessionRow;
}

/** 1 ETH a US$ 3.000: tolerância = max($5, 2%) = $60 → 0,02 ETH. */
const POS_ETH: PosicaoInterna = { base: "ETH", baseAmount: 1, precoRef: 3_000 };
const POS_ETH_ARMADA: PosicaoInterna = { ...POS_ETH, armada: true };

/**
 * Saldo da venue com `free`/`used` explícitos. `total` é free+used, como na
 * corretora; `totalNaN` simula venue que não manda o total (o fallback soma).
 */
const SALDO_ETH = (free: number, used = 0, totalNaN = false): CexBalance[] => [{
  asset: "ETH", free, used,
  total: totalNaN ? Number.NaN : free + used,
  usdValue: (free + used) * 3_000,
}];

describe("A103 — reconciliarConta (existência medida pelo TOTAL)", () => {
  it("J1 ⚠️⚠️ saldo TOTAL abaixo do inventário (além da tolerância) → DERIVA + quarentena gravada", async () => {
    const b = dbFalso();
    // O bot acha que tem 1 ETH; a corretora diz que há 0,5 NO TOTAL. Alguém mexeu.
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.5),
    }, sessao(), CREDS);
    if (r.resultado !== "deriva") throw new Error(`esperava deriva, veio ${r.resultado}`);
    expect(r.achados[0]).toContain("ACCOUNT_DRIFT");
    expect(r.achados[0]).toContain("ETH");
    expect(r.achados[0]).toContain("saldo total real");
    expect(r.quarentenaGravada).toBe(true);
    const q = b.updates.find((u) => u.patch.quarentena_em);
    expect(q, "a quarentena tem de ser gravada na sessão").toBeTruthy();
    expect(String(q!.patch.quarentena_motivo)).toContain("ACCOUNT_DRIFT");
  });

  it("J2 depósito a mais NUNCA é deriva — saldo acima do inventário passa", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(5),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("J3 dentro da tolerância (max $5, 2%) NÃO é deriva", async () => {
    const b = dbFalso();
    // 0,99 ETH no total vs 1,0 interno: diferença $30 < $60 de tolerância.
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.99),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
    // E 0,95 ETH (diferença $150 > $60) DERIVA — tolerância não cobre saque.
    const b2 = dbFalso();
    const r2 = await reconciliarConta({
      db: b2.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.95),
    }, sessao(), CREDS);
    expect(r2.resultado).toBe("deriva");
  });

  it("J4 ⚠️⚠️ falha ao ler o saldo NÃO conclui 'sem drift' — fail-closed, sem quarentena", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => undefined,
    }, sessao(), CREDS);
    if (r.resultado !== "leitura_falhou") throw new Error(`veio ${r.resultado}`);
    expect(r.etapa).toBe("saldos");
    // ⚠️ Nem quarentena (não há evidência) nem "sem drift" (não há leitura).
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("J5 falha ao ler as posições internas também é leitura_falhou", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => undefined, lerSaldos: async () => SALDO_ETH(1),
    }, sessao(), CREDS);
    if (r.resultado !== "leitura_falhou") throw new Error(`veio ${r.resultado}`);
    expect(r.etapa).toBe("posicoes");
  });

  it("J6 a PRIMEIRA reconciliação grava o baseline; a segunda não sobrescreve", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [], lerSaldos: async () => SALDO_ETH(2),
    }, sessao(), CREDS);
    if (r.resultado !== "sem_drift") throw new Error(`veio ${r.resultado}`);
    expect(r.baselineGravada).toBe(true);
    const base = b.updates.find((u) => u.patch.saldo_baseline);
    expect(base, "snapshot da primeira reconciliação (telemetria)").toBeTruthy();

    const b2 = dbFalso();
    const r2 = await reconciliarConta({
      db: b2.db, lerPosicoes: async () => [], lerSaldos: async () => SALDO_ETH(2),
    }, sessao({ saldo_baseline: { lido_em: "2025-01-01", saldos: [] } }), CREDS);
    if (r2.resultado !== "sem_drift") throw new Error(`veio ${r2.resultado}`);
    expect(r2.baselineGravada).toBe(false);
    expect(b2.updates.some((u) => u.patch.saldo_baseline)).toBe(false);
  });

  it("J8 sem posições abertas não há o que derivar — e nada é acusado", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [], lerSaldos: async () => [],
    }, sessao({ saldo_baseline: { ok: true } }), CREDS);
    expect(r.resultado).toBe("sem_drift");
    if (r.resultado === "sem_drift") expect(r.conferidos).toBe(0);
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("quarentena que não grava é dita como não gravada — nunca 'preso' de mentira", async () => {
    const b = dbFalso();
    b.falhe();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(0.1),
    }, sessao(), CREDS);
    if (r.resultado !== "deriva") throw new Error(`veio ${r.resultado}`);
    expect(r.quarentenaGravada).toBe(false);
  });
});

describe("A103 round 3 — cenários A–F do contrato novo", () => {
  it("A ⚠️⚠️⚠️ free .2 / used .8 / total 1 COM exit armado NÃO é drift — o saldo está numa ordem NOSSA", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH_ARMADA],
      lerSaldos: async () => SALDO_ETH(0.2, 0.8),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("A2 o fallback free+used vale quando a venue não manda `total`", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH_ARMADA],
      lerSaldos: async () => SALDO_ETH(0.2, 0.8, true),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
  });

  it("B total 0.5 com parte travada é deriva igual — o TOTAL é que mede a existência", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH_ARMADA],
      lerSaldos: async () => SALDO_ETH(0.3, 0.2),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("deriva");
    const q = b.updates.find((u) => u.patch.quarentena_em);
    expect(q, "deriva real continua gravando quarentena").toBeTruthy();
  });

  it("C ⚠️⚠️⚠️ total 1, used .8 SEM exit armado → bloqueio_nao_explicado, SEM quarentena, SEM 'nao sustenta'", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH],
      lerSaldos: async () => SALDO_ETH(0.2, 0.8),
    }, sessao(), CREDS);
    if (r.resultado !== "bloqueio_nao_explicado") {
      throw new Error(`esperava bloqueio_nao_explicado, veio ${r.resultado}`);
    }
    expect(r.achados[0]).toContain("ACCOUNT_EXTERNAL_ACTIVITY");
    // ⚠️ A mensagem NÃO pode alegar que o saldo não sustenta o inventário —
    // ele sustenta. O que não se explica é a TRAVA.
    expect(r.achados[0]).not.toMatch(/nao sustenta/i);
    expect(r.achados[0]).toMatch(/existe/);
    // ⚠️ SEM quarentena destrutiva: o inventário está lá, nada se apaga.
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("C2 trava DENTRO da tolerância não é bloqueio (0.99 livre, 0 armada)", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH],
      lerSaldos: async () => SALDO_ETH(0.99, 0.005),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
  });

  it("D depósito a mais (+2 ETH) não é deriva e NÃO aumenta a posição interna", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH], lerSaldos: async () => SALDO_ETH(3),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
    // A posição interna é do bot; este módulo JAMAIS escreve nela.
    expect(b.updates.every((u) => !("base_amount" in u.patch))).toBe(true);
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("E saque real com saldo parcialmente travado → deriva (total 0.3 < 1)", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH],
      lerSaldos: async () => SALDO_ETH(0.1, 0.2),
    }, sessao(), CREDS);
    if (r.resultado !== "deriva") throw new Error(`veio ${r.resultado}`);
    expect(r.achados[0]).toContain("ACCOUNT_DRIFT");
  });

  it("F falha de leitura → leitura_falhou (quem chama prende as entradas), sem acusar nada", async () => {
    const b = dbFalso();
    const r = await reconciliarConta({
      db: b.db, lerPosicoes: async () => [POS_ETH_ARMADA],
      lerSaldos: async () => { throw new Error("venue fora"); },
    }, sessao(), CREDS);
    expect(r.resultado).toBe("leitura_falhou");
    expect(b.updates.some((u) => u.patch.quarentena_em)).toBe(false);
  });

  it("duas posições no MESMO ativo dividem o mesmo saldo — agrega por base, não acusa em dobro", async () => {
    const b = dbFalso();
    // 0.6 + 0.4 = 1 ETH interno; total 1 cobre. Conferidas separadamente contra
    // o mesmo free, a segunda acusaria falta que não existe.
    const r = await reconciliarConta({
      db: b.db,
      lerPosicoes: async () => [
        { base: "ETH", baseAmount: 0.6, precoRef: 3_000 },
        { base: "ETH", baseAmount: 0.4, precoRef: 3_000, armada: true },
      ],
      lerSaldos: async () => SALDO_ETH(0.6, 0.4),
    }, sessao(), CREDS);
    expect(r.resultado).toBe("sem_drift");
  });
});

describe("J7 — o hook no cron do autopilot", () => {
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
  const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));

  it("⚠️⚠️ `reconciliarConta` roda por sessão, ANTES de abrir novas entradas", () => {
    const iRec = CRON.indexOf("reconciliarConta(");
    expect(iRec).toBeGreaterThan(-1);
    // Antes do scan e de qualquer disparo.
    expect(iRec).toBeLessThan(CRON.indexOf("runAutopilotCexScan("));
    expect(iRec).toBeLessThan(CRON.indexOf("executarOrdemCex("));
  });

  it("⚠️⚠️ sessão já em quarentena nem reconcilia — entradas presas direto", () => {
    /**
     * ⚠️ O `if (s.quarentena_em)` SAIU DAQUI — e não foi afrouxamento.
     *
     * A quarentena valia só no cron: a `/api/cex/order` do navegador seguia
     * comprando na mesma sessão derivada (achado da revisão adversarial do
     * A130). O veredito virou `entradaAutorizadaNaSessao`, chamado pelos DOIS
     * canais; o cron continua tomando a MESMA decisão, no mesmo lugar, e
     * continua pulando a reconciliação quando ela já está gravada.
     *
     * O que este teste fixa é o comportamento, não a sintaxe de antes: a
     * coluna decide o ramo, o ramo prende as ENTRADAS, e a reconciliação fica
     * no `else`.
     */
    /**
     * ⚠️ A LINHA É RELIDA ANTES DO PORTÃO (achado da verificação do patch da
     * taxa): `s` foi carregado no começo da passada e o settle escreveu nele.
     * A quarentena continua decidindo o ramo — agora sobre o valor RELIDO, e
     * com a leitura falha caindo para a cópia em memória.
     */
    expect(CRON).toMatch(/const fresco = await lerEstadoFinanceiroDaSessao\(s\.id\);/);
    expect(CRON).toMatch(
      /entradaAutorizadaNaSessao\(\{[\s\S]{0,260}?emQuarentena: Boolean\(fresco\.quarentenaEm\)[\s\S]{0,200}?\}\);\s*if \(!portaoDeEntrada\.ok\) \{\s*entradasLiberadas = false/);
    const iRamo = CRON.indexOf("const portaoDeEntrada = entradaAutorizadaNaSessao({");
    const iRec = CRON.indexOf("reconciliarConta(");
    expect(iRamo).toBeGreaterThan(-1);
    // A reconciliação vem DEPOIS, no `else` — sessão em quarentena não relê a conta.
    expect(iRamo).toBeLessThan(iRec);
    expect(CRON.slice(iRamo, iRec)).toMatch(/\} else \{/);
  });

  it("⚠️⚠️ deriva e leitura falha prendem as ENTRADAS, e a deriva vira evento account_drift", () => {
    expect(CRON).toMatch(/rc\.resultado === "deriva"/);
    expect(CRON).toMatch(/recordEvent\("account_drift"/);
    expect(CRON).toMatch(/rc\.resultado === "leitura_falhou"/);
  });

  it("⚠️⚠️⚠️ bloqueio_nao_explicado também VEDA entradas — evento e dedup PRÓPRIOS, sem quarentena", () => {
    const iBloq = CRON.indexOf('rc.resultado === "bloqueio_nao_explicado"');
    expect(iBloq, "o cron precisa tratar bloqueio_nao_explicado").toBeGreaterThan(-1);
    const iFalhou = CRON.indexOf('rc.resultado === "leitura_falhou"');
    const trecho = CRON.slice(iBloq, iFalhou);
    // Entradas presas, fail-closed...
    expect(trecho).toMatch(/entradasLiberadas = false/);
    // ...com evento DISTINTO do drift...
    expect(trecho).toMatch(/recordEvent\("account_external_activity"/);
    // ...dedup própria (não a do drift)...
    expect(trecho).toMatch(/dedupKey: `account_external_activity:/);
    expect(trecho).not.toMatch(/account_drift:/);
    // ...e SEM quarentena neste ramo — ela só existe no ramo da deriva.
    expect(trecho).not.toMatch(/quarentena_em:/);
    // Severity med: o inventário existe; não é o alarme máximo do drift.
    expect(trecho).toMatch(/severity: "med"/);
  });

  it("⚠️⚠️⚠️ o gate prende BUY e NUNCA prende SELL", () => {
    // O ramo de venda (`if (vendaDe)`) vem ANTES do gate e termina em
    // `continue` — saída nunca passa por `!entradasLiberadas`.
    const iVenda = CRON.indexOf("if (vendaDe) {");
    const iGate = CRON.indexOf("if (!entradasLiberadas) {");
    const iCompra = CRON.indexOf('symbol: intent.symbol, side: "buy"');
    expect(iVenda).toBeGreaterThan(-1);
    expect(iGate).toBeGreaterThan(iVenda);
    expect(iGate).toBeLessThan(iCompra);
  });
});

describe("A103 — guarda do módulo: a existência é medida pelo TOTAL", () => {
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
  const MOD = semComentarios(readFileSync("src/lib/cex/execucao/reconciliar-conta.ts", "utf8"));

  it("⚠️⚠️ a comparação de deriva usa o TOTAL real (com fallback free+used), nunca o free sozinho", () => {
    expect(MOD).toMatch(/totalRealDo/);
    expect(MOD).toMatch(/Number\(saldo\.free\) \+ Number\(saldo\.used\)/);
    // A deriva compara o total — não o livre.
    expect(MOD).toMatch(/if \(totalReal < g\.interno - g\.limiteQty\)/);
    // E o bloqueio é medido por free + armada — o free SOZINHO não acusa nada.
    expect(MOD).toMatch(/livreReal \+ g\.armada < g\.interno - g\.limiteQty/);
  });

  it("⚠️ a posição exit_armed (status + exit_order_id) é o que explica o `used`", () => {
    expect(MOD).toMatch(/p\.status === "exit_armed" && !!p\.exit_order_id/);
  });

  it("⚠️ o módulo não promete 'reconciliação completa' — prova é integridade do inventário", () => {
    const cru = readFileSync("src/lib/cex/execucao/reconciliar-conta.ts", "utf8");
    expect(cru).toMatch(/INTEGRIDADE DO INVENTÁRIO ATRIBUÍDO AO AUTOPILOT/i);
    expect(cru).not.toMatch(/reconciliação completa da conta[.:]? (feita|garantida|assegurada)/i);
    expect(cru).toMatch(/TELEMETRIA/);
  });
});
