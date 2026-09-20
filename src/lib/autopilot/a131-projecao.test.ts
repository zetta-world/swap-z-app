/**
 * ⚠️⚠️⚠️ A131-C — A PROJEÇÃO É IDEMPOTENTE, OU NÃO É PROJEÇÃO.
 *
 * O cron dizia, por escrito, na linha da ordem aceita sem preenchimento:
 * *"posicao abre na reconciliacao"*. Não abria: `reconciliarPendentes` nunca
 * tocou em `autopilot_positions`. Uma limitada que preenchesse dez minutos
 * depois ficava fora do livro para sempre.
 *
 * Consertar isso criou o problema oposto: se a reconciliação passa a aplicar
 * fills na posição, reconciliar duas vezes soma duas vezes. Por isso existe o
 * marcador `autopilot_position_effects` (migration 0064) e o delta é sempre
 * `ledger − applied`, calculado DENTRO da transação que aplica.
 *
 * ⚠️ ESTES TESTES RODAM CONTRA O BANCO FALSO, que reproduz a RPC. O último
 * bloco confere que o SQL de verdade mantém cada guarda — para o falso não
 * virar uma segunda regra de negócio, que é o achado A131 outra vez.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";

const SQL_0064 = readFileSync(
  "supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");

let banco: ReturnType<typeof bancoFalso>;

const chamar = (nome: string, args: Record<string, unknown>) =>
  (banco.cliente as unknown as {
    rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  }).rpc(nome, args).then((r) => {
    if (r.error) throw new Error(String((r.error as { message?: string }).message));
    return r.data;
  });

const projetar = (intentId: string) =>
  projetarEfeitoDoIntent(intentId, { chamarRpc: chamar });

function intent(over: Record<string, unknown> = {}): string {
  const id = `i${banco.intents.length + 1}`;
  banco.intents.push({
    id, client_order_id: `c${id}`, wallet_address: "0xA131",
    origin: "autopilot_cron", autonomous: true, simulated: false,
    session_id: "S1", exchange_id: "binance", symbol: "BTC/USDT",
    side: "buy", order_type: "market", requested_qty: 1,
    state: "SUBMITTED", filled_qty: 0, filled_quote: 0, canceled_qty: 0,
    ...over,
  });
  return id;
}

const posicao = () => banco.posicoes.find((p) => p.base === "BTC");
const setFill = (id: string, qty: number, quote: number) => {
  const it = banco.intents.find((i) => i.id === id)!;
  it.filled_qty = qty; it.filled_quote = quote;
};

beforeEach(() => { banco = bancoFalso(); });

describe("P1/A131.7/A131.8 — COMPRA: só o delta, quantas vezes for", () => {
  it("⚠️⚠️ primeira projeção aplica; a segunda, sem mudança, aplica ZERO", async () => {
    const i1 = intent();
    setFill(i1, 0.01, 600);

    const a = await projetar(i1);
    expect(a.ok && a.aplicadoQty).toBeCloseTo(0.01, 12);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(posicao()!.cost_usd)).toBeCloseTo(600, 9);

    const b = await projetar(i1);
    expect(b.ok && b.motivo).toBe("sem_delta");
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(posicao()!.cost_usd)).toBeCloseTo(600, 9);
  });

  it("⚠️⚠️ preenchimento que CRESCE aplica só a diferença", async () => {
    const i1 = intent();
    setFill(i1, 0.01, 600);
    await projetar(i1);
    setFill(i1, 0.015, 900);

    const c = await projetar(i1);
    expect(c.ok && c.aplicadoQty).toBeCloseTo(0.005, 12);
    expect(c.ok && c.aplicadoQuote).toBeCloseTo(300, 9);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.015, 12);
    expect(Number(posicao()!.cost_usd)).toBeCloseTo(900, 9);
  });

  it("⚠️ P3 — FILLED depois do parcial completo aplica zero adicional", async () => {
    const i1 = intent();
    setFill(i1, 0.015, 900);
    await projetar(i1);
    banco.intents[0].state = "FILLED";
    const r = await projetar(i1);
    expect(r.ok && r.motivo).toBe("sem_delta");
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.015, 12);
  });

  it("⚠️ duas COMPRAS diferentes somam na mesma posição, com preço médio", async () => {
    const i1 = intent(); setFill(i1, 0.01, 600); await projetar(i1);
    const i2 = intent(); setFill(i2, 0.01, 620); await projetar(i2);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.02, 12);
    expect(Number(posicao()!.cost_usd)).toBeCloseTo(1_220, 9);
    expect(Number(posicao()!.entry_price)).toBeCloseTo(61_000, 6);
  });
});

describe("P2/P4 — VENDA: reduz uma vez, e fecha quando zera", () => {
  async function comPosicao(qty = 0.01, custo = 600) {
    const compra = intent();
    setFill(compra, qty, custo);
    await projetar(compra);
  }

  it("⚠️⚠️ venda parcial reduz e o custo sai em PROPORÇÃO", async () => {
    await comPosicao();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    const r = await projetar(venda);
    expect(r.ok && r.aplicadoQty).toBeCloseTo(0.004, 12);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.006, 12);
    // 600 × (0,006 / 0,01) = 360
    expect(Number(posicao()!.cost_usd)).toBeCloseTo(360, 9);
  });

  it("⚠️⚠️ reconciliar a MESMA venda de novo NÃO reduz outra vez", async () => {
    await comPosicao();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    await projetar(venda);
    const r = await projetar(venda);
    expect(r.ok && r.motivo).toBe("sem_delta");
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.006, 12);
  });

  it("⚠️⚠️ venda que CRESCE aplica só o adicional", async () => {
    await comPosicao();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    await projetar(venda);
    setFill(venda, 0.006, 380);
    const r = await projetar(venda);
    expect(r.ok && r.aplicadoQty).toBeCloseTo(0.002, 12);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.004, 12);
  });

  it("⚠️⚠️ P4 — venda TOTAL fecha a posição, e repetir não ressuscita nada", async () => {
    await comPosicao();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.01, 640);
    const r = await projetar(venda);
    expect(r.ok && r.fechou).toBe(true);
    expect(r.ok && r.custoRemovido).toBeCloseTo(600, 9);
    expect(posicao()).toBeUndefined();

    const dedeNovo = await projetar(venda);
    expect(dedeNovo.ok && dedeNovo.motivo).toBe("sem_delta");
    expect(posicao()).toBeUndefined();
  });

  it("⚠️⚠️ venda SEM posição falha FECHADO — e não inventa posição negativa", async () => {
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    const r = await projetar(venda);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_posicao");
    expect(banco.posicoes).toHaveLength(0);
  });

  it("⚠️ base_amount nunca fica negativo nem o custo", async () => {
    await comPosicao(0.01, 600);
    const venda = intent({ side: "sell" });
    setFill(venda, 0.01, 640);
    await projetar(venda);
    for (const p of banco.posicoes) {
      expect(Number(p.base_amount)).toBeGreaterThan(0);
      expect(Number(p.cost_usd)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("P5 — regressão cumulativa falha FECHADO", () => {
  it("⚠️⚠️ livro dizendo MENOS do que já foi aplicado NÃO aplica delta negativo", async () => {
    const i1 = intent();
    setFill(i1, 0.015, 900);
    await projetar(i1);
    // O livro "encolheu" — inconsistência, não correção.
    setFill(i1, 0.010, 600);
    const r = await projetar(i1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("regressao");
    // A posição NÃO foi corrompida para "acompanhar".
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.015, 12);
  });
});

describe("P6/P11 — concorrência e restart", () => {
  it("⚠️⚠️ duas projeções do MESMO intent aplicam UMA vez", async () => {
    const i1 = intent();
    setFill(i1, 0.01, 600);
    const [a, b] = await Promise.all([projetar(i1), projetar(i1)]);
    const aplicados = [a, b].filter((r) => r.ok && r.motivo === "aplicado").length;
    expect(aplicados).toBe(1);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ P11 — 'outro processo' não duplica: o marcador é do BANCO", async () => {
    /**
     * Um `Set` em memória morreria no restart — e recovery é exatamente o que
     * acontece DEPOIS do restart. Aqui a segunda projeção vem de um caller que
     * não tem memória nenhuma da primeira, e o marcador sozinho a segura.
     */
    const i1 = intent();
    setFill(i1, 0.01, 600);
    await projetar(i1);
    const outroProcesso = await projetarEfeitoDoIntent(i1, { chamarRpc: chamar });
    expect(outroProcesso.ok && outroProcesso.motivo).toBe("sem_delta");
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.01, 12);
    expect(banco.efeitos).toHaveLength(1);
    expect(Number(banco.efeitos[0].applied_qty)).toBeCloseTo(0.01, 12);
  });
});

describe("P7/P8/P9 — o que NÃO vira posse do bot", () => {
  it("⚠️⚠️ intent MANUAL não projeta", async () => {
    const i1 = intent({ origin: "manual", autonomous: false });
    setFill(i1, 0.01, 600);
    const r = await projetar(i1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("origem_nao_autonoma");
    expect(banco.posicoes).toHaveLength(0);
  });

  it("⚠️⚠️ intent SIMULADO não projeta", async () => {
    const i1 = intent({ simulated: true });
    setFill(i1, 0.01, 600);
    const r = await projetar(i1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("simulado");
    expect(banco.posicoes).toHaveLength(0);
  });

  it("⚠️⚠️ intent sem sessão não projeta", async () => {
    const i1 = intent({ session_id: null });
    setFill(i1, 0.01, 600);
    const r = await projetar(i1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("sem_sessao");
  });

  it("⚠️ DCA (origem própria) também fica de fora do livro do autopilot", async () => {
    const i1 = intent({ origin: "dca_cron" });
    setFill(i1, 0.01, 600);
    const r = await projetar(i1);
    expect(r.ok).toBe(false);
  });
});

describe("P10 — falha de banco na projeção não vira sucesso", () => {
  it("⚠️⚠️ RPC com erro devolve `ok: false`, e não 'nada a fazer'", async () => {
    const i1 = intent();
    setFill(i1, 0.01, 600);
    banco.falhas.rpc = "permission denied";
    const r = await projetarEfeitoDoIntent(i1, { chamarRpc: chamar });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("erro");
  });
});

describe("⚠️⚠️ SAÍDA ARMADA — achado da revisão adversarial", () => {
  /**
   * `settleArmedExits` é o ÚNICO lugar do produto que realiza P&L de uma saída
   * limitada: lê a ordem na corretora, chama `realizedFromSell` contra a
   * posição AINDA INTEIRA e alimenta `apply_session_pnl` (que puxa o stop de
   * perda diária).
   *
   * A primeira versão da projeção reduzia/apagava a posição antes disso —
   * então a liquidação não a encontrava mais e **o prejuízo do dia
   * simplesmente não era contado**. E num PARCIAL era pior: ela limpava
   * `status`/`exit_order_id` de uma ordem que continua trabalhando o
   * restante, e a passada seguinte armava uma SEGUNDA venda da mesma bolsa.
   */
  async function comPosicaoArmada() {
    const compra = intent();
    setFill(compra, 0.01, 600);
    await projetar(compra);
    const pos = posicao()!;
    pos.status = "exit_armed";
    pos.exit_order_id = "EXT-ARMADA";
    return pos;
  }

  it("⚠️⚠️ a projeção NÃO toca numa posição com saída armada", async () => {
    const pos = await comPosicaoArmada();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    const r = await projetar(venda);
    expect(r.ok && r.motivo).toBe("saida_em_liquidacao");
    expect(Number(pos.base_amount)).toBeCloseTo(0.01, 12);
    expect(Number(pos.cost_usd)).toBeCloseTo(600, 9);
  });

  it("⚠️⚠️ e NÃO desarma a saída — a ordem continua viva na corretora", async () => {
    const pos = await comPosicaoArmada();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    await projetar(venda);
    expect(pos.status).toBe("exit_armed");
    expect(pos.exit_order_id).toBe("EXT-ARMADA");
  });

  it("⚠️⚠️ o marcador NÃO avança — a liquidação ainda vai aplicar", async () => {
    // Avançar aqui faria a absorção seguinte achar que já estava aplicado, e a
    // redução real nunca entraria no livro.
    await comPosicaoArmada();
    const venda = intent({ side: "sell" });
    setFill(venda, 0.004, 250);
    await projetar(venda);
    const marcador = banco.efeitos.find((e) => e.intent_id === venda);
    expect(Number(marcador?.applied_qty ?? 0)).toBe(0);
  });

  it("⚠️⚠️ depois que a liquidação aplica e desarma, a projeção segue do ponto certo", async () => {
    /**
     * ⚠️ A ABSORÇÃO DEIXOU DE EXISTIR (A136/A139): a liquidação tem transação
     * própria, que move a posição E o marcador. A projeção seguinte enxerga o
     * `applied` que ela deixou e aplica só o que passar dele.
     */
    const pos = await comPosicaoArmada();
    const venda = intent({ side: "sell", external_order_id: "EXT-ARMADA" });
    pos.exit_intent_id = venda;
    setFill(venda, 0.004, 250);
    expect((await projetar(venda)).ok && true).toBe(true);   // saida_em_liquidacao

    const { liquidarSaidaArmada } = await import("@/lib/autopilot/projecao-de-posicao");
    const liq = await liquidarSaidaArmada(venda, 0.004, 250, { chamarRpc: chamar });
    expect(liq.ok && liq.aplicadoQty).toBeCloseTo(0.004, 12);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.006, 12);

    // E o que a corretora preencher A MAIS entra pela projeção, sem repetir.
    setFill(venda, 0.006, 380);
    const r = await projetar(venda);
    expect(r.ok && r.aplicadoQty).toBeCloseTo(0.002, 12);
    expect(Number(posicao()!.base_amount)).toBeCloseTo(0.004, 12);
  });

  it("⚠️⚠️ COMPRA sobre posição armada não desarma nada", async () => {
    /**
     * A versão anterior punha `status = 'open'` e deixava `exit_order_id`
     * apontando para uma ordem de venda viva: `settleArmedExits` filtra por
     * status, a ordem virava órfã e o P&L dela nunca seria realizado.
     */
    const pos = await comPosicaoArmada();
    const compra2 = intent();
    setFill(compra2, 0.005, 320);
    const r = await projetar(compra2);
    expect(r.ok && r.aplicadoQty).toBeCloseTo(0.005, 12);
    expect(Number(pos.base_amount)).toBeCloseTo(0.015, 12);
    expect(pos.status).toBe("exit_armed");
    expect(pos.exit_order_id).toBe("EXT-ARMADA");
  });

  it("⚠️ `BTC-USDT` e `BTC/USDT` são o MESMO ativo", () => {
    // Duas linhas para o mesmo ativo somariam na exposição e nenhuma seria
    // encontrada pela checagem de posse.
    expect(SQL_0064).toMatch(/split_part\(replace\(v_i\.symbol, '-', '\/'\), '\/', 1\)/);
  });
});

describe("⚠️ o SQL de verdade mantém as mesmas guardas", () => {
  const SQL = SQL_0064;

  it("⚠️⚠️ marcador por intent, com chave primária — um efeito, uma linha", () => {
    expect(SQL).toMatch(/create table if not exists public\.autopilot_position_effects/);
    expect(SQL).toMatch(/intent_id\s+uuid primary key/);
    expect(SQL).toMatch(/applied_qty\s+numeric\s+not null default 0 check \(applied_qty\s+>= 0\)/);
  });

  it("⚠️⚠️ tudo numa transação, com LOCK nas três linhas que importam", () => {
    expect(SQL).toMatch(/from public\.cex_execution_intents where id = p_intent_id for update/);
    expect(SQL).toMatch(/where intent_id = p_intent_id for update/);
    expect(SQL).toMatch(/where session_id = v_i\.session_id and base = v_base for update/);
  });

  it("⚠️⚠️ o delta é `ledger − applied`, nunca o valor cheio", () => {
    expect(SQL).toMatch(/v_delta_qty\s*:=\s*greatest\(v_i\.filled_qty\s*-\s*v_e\.applied_qty,\s*0\)/);
    expect(SQL).toMatch(/v_delta_quote\s*:=\s*greatest\(v_i\.filled_quote - v_e\.applied_quote, 0\)/);
  });

  it("⚠️⚠️ regressão mede o LIVRO contra o livro, não contra o absorvido", () => {
    /**
     * ⚠️ ACHADO MEU, ESCREVENDO O TESTE: a primeira versão comparava
     * `filled_qty < applied_qty`, e a absorção da liquidação adianta
     * `applied` de propósito — a chamada seguinte acusava REGRESSÃO onde só
     * havia uma venda que a liquidação aplicou antes de o livro ingerir. Por
     * isso o marcador tem duas marcas d'água: o que entrou na posição
     * (`applied`) e o que o livro dizia (`ledger`).
     */
    expect(SQL).toMatch(/if v_i\.filled_qty < v_e\.ledger_qty - v_eps then/);
    expect(SQL).toMatch(/ledger_qty\s+numeric\s+not null default 0/);
    expect(SQL).toMatch(/'motivo', 'regressao'/);
    expect(SQL).toMatch(/'motivo', 'sem_posicao'/);
  });

  it("⚠️⚠️ origem: manual e simulado não entram no livro do bot", () => {
    expect(SQL).toMatch(/if v_i\.simulated then/);
    expect(SQL).toMatch(/v_i\.origin not in \('autopilot_browser', 'autopilot_cron'\)/);
    expect(SQL).toMatch(/v_i\.session_id is null/);
  });

  it("⚠️⚠️ a RPC nasce FECHADA (A116) e a tabela também", () => {
    expect(SQL).toMatch(/security definer/);
    expect(SQL).toMatch(/set search_path = public, pg_temp/);
    expect(SQL).toMatch(/revoke all on function public\.autopilot_projetar_efeito_do_intent\(uuid\)\s*\n?\s*from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.autopilot_projetar_efeito_do_intent\(uuid\)\s*\n?\s*to service_role;/);
    expect(SQL).toMatch(/revoke all on table public\.autopilot_position_effects from public, anon, authenticated;/);
    expect(SQL).toMatch(/alter table public\.autopilot_position_effects enable row level security;/);
  });

  it("⚠️⚠️ NENHUM backfill: histórico não é inventado (§38)", () => {
    expect(SQL).toMatch(/NENHUM BACKFILL/);
    expect(SQL).not.toMatch(/insert into public\.autopilot_position_effects\s*\([^)]*\)\s*select/i);
  });

  it("⚠️⚠️ saída armada pertence à liquidação, e o parcial não desarma", () => {
    expect(SQL).toMatch(/if v_pos\.status = 'exit_armed' and v_pos\.exit_order_id is not null then/);
    expect(SQL).toMatch(/'motivo', 'saida_em_liquidacao'/);
    // O `update` do parcial não pode voltar a mexer em status/exit_order_id.
    const iParcial = SQL.indexOf("set base_amount   = v_restante");
    expect(iParcial).toBeGreaterThan(-1);
    const bloco = SQL.slice(iParcial, iParcial + 400);
    expect(bloco).not.toMatch(/exit_order_id = null/);
    expect(bloco).not.toMatch(/status\s+= 'open'/);
  });

  it("⚠️⚠️ e a varredura de pendências existe, porque FILLED é terminal", () => {
    expect(SQL).toMatch(/create or replace function public\.autopilot_projecoes_pendentes/);
    expect(SQL).toMatch(/i\.filled_qty > e\.applied_qty \+ 1e-12/);
    expect(SQL).toMatch(/revoke all on function public\.autopilot_projecoes_pendentes\(int\)/);
  });

  it("⚠️ e a 0063 não foi tocada para encaixar a 0064 (§45)", () => {
    const S63 = readFileSync("supabase/migrations/0063_cex_conexoes_versionadas.sql", "utf8");
    expect(S63).not.toMatch(/autopilot_position_effects/);
    expect(S63).not.toMatch(/autopilot_projetar_efeito_do_intent/);
  });
});
