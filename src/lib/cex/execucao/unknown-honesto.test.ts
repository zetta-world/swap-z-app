/**
 * ⚠️⚠️ PONTO 9 — O UNKNOWN MANUAL/BROWSER HONESTO.
 *
 * O 202 de `/api/cex/order` dizia *"a reconciliacao vai confirmar em ate
 * alguns minutos"* para TODOS. Para a ordem MANUAL isso era mentira de duas
 * camadas: a rota descarta a credencial ao fim (ninguém consegue olhar a venue
 * por aquele intent), e o recuperador global contava tentativas até a
 * QUARENTENA contra intents que ele nunca teve como reconciliar — alarme de
 * segurança disparado por desenho, não por evidência.
 *
 * Agora:
 *   · piloto do navegador → o intent carrega `sessionId`, e o recuperador
 *     resolve a credencial PELA SESSÃO (cofre), sem duplicar segredo;
 *   · manual → UMA reconciliação imediata e segura enquanto a credencial está
 *     na mão (leitura por clientOrderId, NUNCA reenvio); se não concluir, o
 *     202 diz a verdade: reconciliar exige nova autenticação;
 *   · intents manuais sem sessão/conexão são PULADOS pelo recuperador — ficam
 *     UNKNOWN aguardando reconciliação interativa, nunca quarentena automática.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { reconciliarPendentes } from "@/lib/cex/execucao/reconciliador";
import { intentPorId } from "@/lib/cex/execucao/intents";
import type { CexCredentials } from "@/lib/cex/types";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
const ROTA = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));

const CREDS: CexCredentials = { apiKey: "k12345678", apiSecret: "s12345678" };

async function plantar(
  banco: ReturnType<typeof bancoFalso>, extra: Record<string, unknown>,
): Promise<string> {
  const { data } = await banco.cliente.from("cex_execution_intents").insert({
    client_order_id: "zswap_p9", origin: "manual", autonomous: false,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 0.01, simulated: false,
    state: "UNKNOWN", created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    ...extra,
  }).select("*").limit(1);
  return String((data as Array<{ id: string }>)[0].id);
}

describe("browser-autopilot: o intent carrega a sessão", () => {
  it("⚠️⚠️ a rota passa `sessionId` no contexto quando há sessão de piloto", () => {
    expect(ROTA).toMatch(/sessionId: sessaoDoPilotoId/);
    expect(ROTA).toMatch(/sessaoDoPilotoId = sessaoDoPiloto\?\.id \?\? null/);
  });

  it("⚠️ o recuperador global é elegível por session_id OU conexao_id", () => {
    expect(CRON).toMatch(/elegivel: \(intent\) => Boolean\(intent\.session_id \|\| intent\.conexao_id\)/);
  });

  it("com sessão, o recuperador encontra credencial — o intent reconcilia", async () => {
    const banco = bancoFalso();
    const id = await plantar(banco, { session_id: "sess-1", conexao_id: null });
    const r = await reconciliarPendentes({
      db: banco.cliente,
      elegivel: (i) => Boolean(i.session_id || i.conexao_id),
      credenciais: async () => CREDS,
      ler: async () => ({ tipo: "ausente_em_todos", consultados: ["fetchOrder"] }),
    });
    // Foi OLHADO de verdade — não pulado.
    expect(r.resultados).toHaveLength(1);
    const depois = await intentPorId(banco.cliente, id);
    expect(depois?.state).toBe("CANCELED");
  });
});

describe("manual: reconciliação imediata segura e resposta honesta", () => {
  it("⚠️⚠️ o ramo incerto faz UMA reconciliação por LEITURA antes de responder", () => {
    const iIncerto = ROTA.indexOf('if (r.desfecho === "incerto")');
    const iRecusado = ROTA.indexOf('if (r.desfecho === "recusado")');
    const trecho = ROTA.slice(iIncerto, iRecusado);
    expect(trecho).toMatch(/reconciliarIntent\(/);
    expect(trecho).toMatch(/intentPorId\(dbRec, r\.intentId\)/);
  });

  it("⚠️⚠️⚠️ NUNCA reenvio: o ramo incerto não contém nenhuma chamada de envio", () => {
    const iIncerto = ROTA.indexOf('if (r.desfecho === "incerto")');
    const iRecusado = ROTA.indexOf('if (r.desfecho === "recusado")');
    const trecho = ROTA.slice(iIncerto, iRecusado);
    expect(trecho).not.toMatch(/executarOrdemCex\(/);
    expect(trecho).not.toMatch(/placeCexOrder\(/);
    expect(trecho).not.toMatch(/createOrder\(/);
  });

  it("⚠️⚠️ se a reconciliação confirma, a rota responde o ESTADO REAL", () => {
    expect(ROTA).toMatch(/final\.state === "FILLED"/);
    expect(ROTA).toMatch(/ordem_nao_executada_na_venue/);
  });

  it("⚠️⚠️⚠️ o 202 manual é HONESTO: exige reautenticar, sem promessa falsa", () => {
    expect(ROTA).toMatch(/exige nova autenticacao/);
    expect(ROTA).toMatch(/\/api\/cex\/order\/status/);
    // A promessa antiga ("vai confirmar em ate alguns minutos") só pode existir
    // para o piloto COM sessão — nunca no texto do manual.
    const iManual = ROTA.indexOf("exige nova autenticacao");
    const trecho = ROTA.slice(iManual - 400, iManual + 400);
    expect(trecho).not.toMatch(/vai confirmar em ate alguns minutos/);
  });
});

describe("manual sem credencial persistida: nem reenvio, nem quarentena automática", () => {
  it("⚠️⚠️ o recuperador PULA intents sem sessão/conexão — UNKNOWN fica esperando o usuário", async () => {
    const banco = bancoFalso();
    const id = await plantar(banco, { session_id: null, conexao_id: null });
    const r = await reconciliarPendentes({
      db: banco.cliente,
      elegivel: (i) => Boolean(i.session_id || i.conexao_id),
      credenciais: async () => CREDS, // até COM credencial disponível: não é dele
      ler: async () => ({ tipo: "ausente_em_todos", consultados: ["fetchOrder"] }),
    });
    expect(r.resultados).toHaveLength(0);
    const depois = await intentPorId(banco.cliente, id);
    // ⚠️ Segue UNKNOWN, e SEM tentativa contada — nunca quarentena automática.
    expect(depois?.state).toBe("UNKNOWN");
    expect(Number(depois?.reconcile_attempts)).toBe(0);
  });

  it("⚠️ sem o predicado, nada muda para quem já tinha o comportamento — regressão zero", async () => {
    // O DCA e caminhos antigos que chamam sem `elegivel` seguem vendo todos.
    const banco = bancoFalso();
    await plantar(banco, { session_id: null, conexao_id: null });
    const r = await reconciliarPendentes({
      db: banco.cliente,
      credenciais: async () => null,
    });
    expect(r.resultados).toHaveLength(1);
    expect(r.resultados[0].desfecho).toBe("segue_em_duvida");
  });
});
