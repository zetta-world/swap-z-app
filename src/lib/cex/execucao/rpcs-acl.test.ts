/**
 * ⚠️⚠️ GUARDA DE ACL DAS RPCs SECURITY DEFINER — achado A116 (Round 2).
 *
 * A varredura de produção (16/09) achou CINCO funções `security definer` que
 * mexem em dinheiro expostas a PUBLIC/anon/authenticated: com o anon key
 * público do PostgREST, qualquer um chamava `cex_transicionar` ou
 * `cex_ingest_trades` direto, por fora de toda a autorização das rotas.
 *
 * Esta guarda existe para o caso NÃO depender de alguém lembrar: ela VARRE
 * TODAS as migrations atrás de `security definer`, extrai o nome de cada
 * função, e exige que cada uma esteja no catálogo abaixo COM o REVOKE
 * correspondente numa migration posterior (ou na mesma). Quem criar uma
 * SECURITY DEFINER nova sem ACL quebra o build — que é exatamente o ponto.
 *
 * Estilo: mesmo de `estados.test.ts` — a trava LÊ o SQL de verdade, e o
 * primeiro teste existe para impedir que um parser que não casa nada aprove
 * o vazio.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const DIR = "supabase/migrations";

/**
 * ⚠️ O CATÁLOGO É A LISTA, não um padrão. Cada SECURITY DEFINER do banco tem
 * de estar aqui, apontando a migration que a tranca. `bancada_marcar_adiado`
 * já nasceu certa (0045); as outras cinco foram fechadas na 0055 (A116).
 */
const CATALOGO: Record<string, string> = {
  bancada_marcar_adiado:     "0045_bancada_marcar_adiado.sql",
  celeiro_reverter_genoma:   "0055_rpcs_financeiras_acl.sql",
  cex_recalcular_intent:     "0055_rpcs_financeiras_acl.sql",
  // A118 (round 3): as duas ingestões foram redefinidas na 0059, que repete
  // o REVOKE/GRANT — a regra ACL file ≥ def file passa a apontar para ela.
  cex_ingest_trades:         "0059_fee_cumulativa_e_cobertura.sql",
  cex_ingest_order_snapshot: "0059_fee_cumulativa_e_cobertura.sql",
  cex_transicionar:          "0055_rpcs_financeiras_acl.sql",
  // A110 (round 2): RPC nova já nasce com REVOKE/GRANT na própria migration.
  cex_autorizar_e_submeter:  "0057_executor_autoriza_submissao.sql",
};

const ARQUIVOS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const SQLS = new Map(ARQUIVOS.map((f) => [f, readFileSync(`${DIR}/${f}`, "utf8")]));

/** Nomes das funções criadas com `security definer`, varrendo TODAS as migrations. */
function securityDefiners(): string[] {
  const nomes = new Set<string>();
  for (const sql of SQLS.values()) {
    // Recorta o corpo de CADA função (até o `$$;` que a fecha) e só então
    // pergunta se é definer — um regex "até security definer" atravessaria a
    // fronteira e marcaria a função errada (medido: `cex_transicao_permitida`
    // é `language sql immutable` e aparecia como definer).
    for (const m of sql.matchAll(
      /create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/gi)) {
      const fim = sql.indexOf("$$;", m.index);
      const corpo = sql.slice(m.index, fim === -1 ? undefined : fim);
      if (/security\s+definer/i.test(corpo)) nomes.add(m[1]);
    }
  }
  return [...nomes].sort();
}

describe("A116 — nenhuma SECURITY DEFINER sem ACL explícita", () => {
  const definers = securityDefiners();

  it("⚠️ a varredura achou funções de verdade — parser vazio aprovaria tudo", () => {
    // As seis conhecidas têm de aparecer; se o regex parar de casar, ESTE
    // teste falha primeiro, antes de qualquer um que confiaria nele.
    expect(definers.length).toBeGreaterThanOrEqual(6);
    for (const nome of Object.keys(CATALOGO)) {
      expect(definers, `${nome} sumiu da varredura`).toContain(nome);
    }
  });

  it("⚠️⚠️ TODA security definer está no catálogo — função nova sem ACL quebra aqui", () => {
    for (const nome of definers) {
      expect(CATALOGO[nome], `SECURITY DEFINER sem ACL catalogada: ${nome}`).toBeDefined();
    }
  });

  it("⚠️⚠️ cada função catalogada tem REVOKE de public/anon/authenticated na migration apontada", () => {
    for (const [nome, arquivo] of Object.entries(CATALOGO)) {
      const sql = SQLS.get(arquivo) ?? "";
      expect(sql, `${arquivo} não existe`).not.toBe("");
      const re = new RegExp(
        `revoke\\s+(all|execute)[\\s\\S]{0,60}?on function public\\.${nome}\\([\\s\\S]*?\\)\\s*from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`, "i");
      expect(sql, `${nome}: revoke ausente/incompleto em ${arquivo}`).toMatch(re);
    }
  });

  it("⚠️ e o caminho legítimo fica de pé: GRANT ao service_role para as cinco da 0055", () => {
    const sql = SQLS.get("0055_rpcs_financeiras_acl.sql") ?? "";
    for (const nome of ["cex_recalcular_intent", "cex_ingest_trades",
                        "cex_ingest_order_snapshot", "cex_transicionar",
                        "celeiro_reverter_genoma"]) {
      const re = new RegExp(
        `grant\\s+execute\\s+on function public\\.${nome}\\([\\s\\S]*?\\)\\s*to\\s+service_role`, "i");
      expect(sql, `${nome}: grant ao service_role ausente`).toMatch(re);
    }
  });

  it("o revoke vem DEPOIS (ou junto) da definição — nunca antes", () => {
    for (const [nome, arquivoAcl] of Object.entries(CATALOGO)) {
      const definida = ARQUIVOS.find((f) =>
        new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${nome}\\b`, "i")
          .test(SQLS.get(f) ?? ""));
      expect(definida, `${nome} não foi achada em migration nenhuma`).toBeDefined();
      expect(arquivoAcl >= definida!,
        `${nome}: ACL em ${arquivoAcl} precede a definição em ${definida}`).toBe(true);
    }
  });
});

/**
 * Comportamento, via banco-falso: a ACL em si mora no Postgres e a medição
 * real é do orquestrador (Supabase MCP). Aqui se trava o que a APLICAÇÃO faz
 * com cada resposta: recusa 42501 do PostgREST (anon/authenticated) NUNCA
 * pode ser lida como sucesso, e o caminho do service_role segue funcionando.
 */
describe("A116 — comportamento da aplicação diante da ACL", () => {
  it("⚠️⚠️ anon/authenticated → permission denied → NADA muda de estado", async () => {
    const { bancoFalso } = await import("@/lib/cex/execucao/banco-falso");
    const { transicionar } = await import("@/lib/cex/execucao/intents");
    const b = bancoFalso();
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-acl", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      requested_qty: 1, client_order_id: "c-acl", origin: "dca_cron", order_type: "market",
    });
    // O que o PostgREST devolve quando a ACL barra (SQLSTATE 42501):
    b.falhas.transicao = "permission denied for function cex_transicionar";
    const r = await transicionar(b.cliente, "i-acl", "AUTHORIZED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toMatch(/permission denied/i);
    // E o intent NÃO saiu do lugar: falhou fechado, não "fingiu que foi".
    expect(b.intents[0].state).toBe("CREATED");
  });

  it("⚠️ ingestão barrada pela ACL também falha fechado", async () => {
    const { bancoFalso } = await import("@/lib/cex/execucao/banco-falso");
    const { ingerirTrades, ingerirSnapshotDaOrdem } = await import("@/lib/cex/execucao/intents");
    const b = bancoFalso();
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-acl2", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      requested_qty: 1, client_order_id: "c-acl2", origin: "dca_cron", order_type: "market",
    });
    b.falhas.ingestao = "permission denied for function cex_ingest_trades";
    const r1 = await ingerirTrades(b.cliente, "i-acl2", "o1",
      [{ tradeId: "t1", qty: 1, price: 100, quote: 100 }]);
    expect(r1.ok).toBe(false);
    const r2 = await ingerirSnapshotDaOrdem(b.cliente, "i-acl2", "o1",
      { cumulativeQty: 1, avgPrice: 100, cumulativeQuote: 100 });
    expect(r2.ok).toBe(false);
    expect(b.fills).toHaveLength(0);
  });

  it("service_role → o caminho legítimo segue funcionando", async () => {
    // O banco-falso sem falha injetada é o service_role: ACL satisfeita.
    const { bancoFalso } = await import("@/lib/cex/execucao/banco-falso");
    const { transicionar } = await import("@/lib/cex/execucao/intents");
    const b = bancoFalso();
    await b.cliente.from("cex_execution_intents").insert({
      id: "i-acl3", exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
      requested_qty: 1, client_order_id: "c-acl3", origin: "dca_cron", order_type: "market",
    });
    const r = await transicionar(b.cliente, "i-acl3", "AUTHORIZED");
    expect(r.ok).toBe(true);
    expect(b.intents[0].state).toBe("AUTHORIZED");
  });
});
