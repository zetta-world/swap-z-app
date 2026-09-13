/**
 * ⚠️⚠️ CADA TESTE AQUI É UMA GUARDA DE DINHEIRO. O papel adiante é o único
 * custo da bancada que RECORRE: um erro num backtest custa uma rodada; um erro
 * aqui custa a cada 30 minutos, para sempre, por cliente.
 */
import { describe, it, expect } from "vitest";
import {
  mesasQuePodemTickar, decidirAbertura, decidirFechamento, alvoEStop,
  aVezDeQuem, TRABALHO_POR_TICK, AGENTES_POR_TICK, DONOS_POR_TICK, custoDoTrabalho, PESO_DO_AGENTE,
  type Mesa, type MesaPropria,
} from "@/lib/bancada/papel";
import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";
import type { VelaComTempo } from "@/lib/mercado/velas";
import { donoDeLinhaDoBanco } from "@/lib/bancada/dono";

const H = 3_600_000;
const params: EstrategiaDoCliente = {
  entrada: { tipo: "media", n: 2 }, direcao: "compra",
  alvoPct: 2, stopPct: 2, horasLimite: 24, praca: "futuros_gate", papel: "maker",
};

/**
 * ⚠️ `MesaPropria`, não `Mesa`: desde 0043 uma mesa pode ser uma INSTÂNCIA DE
 * AGENTE, e nessa o `params` é `null` porque o bracket é variável. Este helper
 * monta o caso do vocabulário do cliente — o único que `decidirAbertura` lê.
 */
function mesa(p: Partial<MesaPropria> = {}): MesaPropria {
  return {
    id: "m1", dono: donoDeLinhaDoBanco("0xA")!, params, mesa: null,
    simbolos: ["BTC"], intervalo: "1h",
    ultimaAberturaMs: null, temPosicaoAberta: false, criadaEm: "2026-01-01T00:00:00Z", ...p,
  };
}
/** Velas horárias terminando em `n-1`, com a média de 2 cruzando na última. */
function serieQueCruza(n: number): VelaComTempo[] {
  const v: VelaComTempo[] = [];
  for (let i = 0; i < n; i++) {
    const close = i === n - 1 ? 101 : 100;
    v.push({ t: i * H, close, high: close, low: close, volume: 1 });
  }
  return v;
}

describe("⚠️ o teto de mesas é reavaliado a cada tick — o caso do downgrade", () => {
  const tres = [mesa({ id: "a", criadaEm: "2026-01-01" }), mesa({ id: "b", criadaEm: "2026-01-02" }), mesa({ id: "c", criadaEm: "2026-01-03" })];

  it("trader roda 3, pilot roda as mesmas 3, pro roda NENHUMA", () => {
    expect(mesasQuePodemTickar(tres, "trader").tickam.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(mesasQuePodemTickar(tres, "pilot").tickam.map((m) => m.id)).toEqual(["a", "b", "c"]);
    // ⚠️ Se a checagem morasse só no ato de LIGAR, quem parasse de pagar
    // continuaria consumindo cron para sempre — e nada quebraria.
    const pro = mesasQuePodemTickar(tres, "pro");
    expect(pro.tickam).toHaveLength(0);
    expect(pro.cortadas).toHaveLength(3);
  });

  it("⚠️ o corte é DETERMINÍSTICO — as mais antigas sobrevivem", () => {
    // Cortar por ordem arbitrária faria a mesa do cliente parar e voltar sem
    // explicação a cada tick.
    const muitas = Array.from({ length: 6 }, (_, i) => mesa({ id: `m${i}`, criadaEm: `2026-01-0${i + 1}` }));
    const a = mesasQuePodemTickar([...muitas].reverse(), "trader").tickam.map((m) => m.id);
    const b = mesasQuePodemTickar(muitas, "trader").tickam.map((m) => m.id);
    expect(a).toEqual(b);
    expect(a).toEqual(["m0", "m1", "m2"]);
  });
});

describe("⚠️⚠️ uma vela, um sinal — a guarda contra o relógio", () => {
  const velas = serieQueCruza(5);            // últimas fechadas: t=0..4h
  const agora = 5 * H + 60_000;              // 5h e um minuto: a de 4h fechou

  it("abre no cruzamento da última vela FECHADA", () => {
    const d = decidirAbertura(mesa(), velas, agora);
    expect(d.abre).toBe(true);
    if (d.abre) { expect(d.velaMs).toBe(4 * H); expect(d.preco).toBe(101); }
  });

  it("⚠️ o MESMO sinal não abre duas vezes — o cron roda 2× por vela de 1h", () => {
    // Sem esta guarda, o tick das :00 e o das :30 leriam a mesma vela e
    // abririam duas posições do mesmo movimento.
    const jaAvaliada = mesa({ ultimaAberturaMs: 4 * H });
    const d = decidirAbertura(jaAvaliada, velas, agora);
    expect(d.abre).toBe(false);
    if (!d.abre) expect(d.porque).toBe("vela_ja_avaliada");
  });

  it("⚠️ a vela CORRENTE não decide", () => {
    // Às 4h30 a vela das 4h ainda está aberta: o sinal nela pode sumir antes de
    // ela fechar. A última fechada é a das 3h, e ali não há cruzamento.
    const d = decidirAbertura(mesa(), velas, 4 * H + 1_800_000);
    expect(d.abre).toBe(false);
    if (!d.abre) expect(d.porque).toBe("sem_sinal");
  });

  it("posição aberta bloqueia, e série vazia não inventa sinal", () => {
    expect(decidirAbertura(mesa({ temPosicaoAberta: true }), velas, agora)).toEqual({ abre: false, porque: "ja_tem_posicao" });
    expect(decidirAbertura(mesa(), [], agora)).toEqual({ abre: false, porque: "sem_velas" });
  });
});

describe("o fechamento reusa a convenção da casa, com o custo do CLIENTE", () => {
  const pos = { entrada: 100, tamanhoUsd: 1000, abertaEmMs: 0 };

  it("alvo e stop de compra ficam onde devem", () => {
    const { alvo, stop } = alvoEStop(params, 100);
    expect(alvo).toBeCloseTo(102, 6);
    expect(stop).toBeCloseTo(98, 6);
  });

  it("⚠️ stop-first quando a vela toca os dois", () => {
    const velas: VelaComTempo[] = [{ t: H, close: 100, high: 200, low: 1, volume: 1 }];
    expect(decidirFechamento(params, pos, velas, 2 * H)!.status).toBe("perdeu");
  });

  it("⚠️ expirada NO LUCRO continua `expirada` — não vira ganho", () => {
    // `computeExitPath` devolve `win: true` numa expirada positiva: certo para o
    // placar da casa, errado aqui. Contá-la como vitória infla a borda.
    const velas: VelaComTempo[] = [{ t: H, close: 101, high: 101, low: 101, volume: 1 }];
    const f = decidirFechamento(params, pos, velas, 25 * H)!;
    expect(f.status).toBe("expirada");
    expect(f.resultadoPct).toBeGreaterThan(0);
  });

  it("ainda aberta devolve `null`, não um fechamento inventado", () => {
    const velas: VelaComTempo[] = [{ t: H, close: 100.5, high: 100.5, low: 100.5, volume: 1 }];
    expect(decidirFechamento(params, pos, velas, 2 * H)).toBeNull();
  });

  it("⚠️ o custo descontado é o da praça do CLIENTE", () => {
    const velas: VelaComTempo[] = [{ t: H, close: 102, high: 102, low: 102, volume: 1 }];
    const maker = decidirFechamento(params, pos, velas, 2 * H)!;                                    // futuros maker: 0,03%
    const taker = decidirFechamento({ ...params, praca: "spot_gate", papel: "taker" }, pos, velas, 2 * H)!; // spot: 0,40%
    expect(maker.resultadoPct - taker.resultadoPct).toBeCloseTo(0.37, 6);
  });
});

/**
 * ⚠️⚠️ O TETO QUE MENTIA (07/09).
 *
 * `TRABALHO_POR_TICK` (então `MESAS_POR_TICK`) vinha com o comentário *"as que sobram pegam o tick
 * seguinte, e a ordem determinística garante que ninguém fique para trás para
 * sempre"*. Ele afirmava o oposto do que o código fazia: com uma ordem estável
 * e um `.slice(0, teto)`, as mesmas primeiras `teto` mesas ganham em TODO tick
 * e a de número `teto+1` **nunca roda**. Não é uma fila — é um corte.
 *
 * Apareceu ao somar as instâncias de agente (0043), que custam 3 leituras por
 * símbolo em vez de 1: foi ao dimensionar o orçamento do tick que a conta não
 * fechou e o comentário caiu.
 */
describe("a vez de quem — a janela ROLA, senão o teto é um corte", () => {
  const fila = ["a", "b", "c", "d", "e", "f", "g"];

  it("cabendo todo mundo, todo mundo roda — e na ordem", () => {
    expect(aVezDeQuem(fila, 10, 0)).toEqual(fila);
    expect(aVezDeQuem(fila, 7, 99)).toEqual(fila);
  });

  it("não cabendo, cada tick começa num ponto diferente", () => {
    expect(aVezDeQuem(fila, 3, 0)).toEqual(["a", "b", "c"]);
    expect(aVezDeQuem(fila, 3, 1)).toEqual(["d", "e", "f"]);
    // ⚠️ E dá a volta: `g` não fica para trás porque a lista acabou.
    expect(aVezDeQuem(fila, 3, 2)).toEqual(["g", "a", "b"]);
  });

  /**
   * ⚠️ A ASSERÇÃO QUE IMPORTA, e é sobre AUSÊNCIA DE FOME: em ticks
   * suficientes, TODA mesa da fila rodou pelo menos uma vez. É exatamente o que
   * o `.slice` fixo não cumpria.
   */
  it("em poucos ticks, ninguém fica de fora", () => {
    const vistos = new Set<string>();
    for (let t = 0; t < 3; t++) for (const x of aVezDeQuem(fila, 3, t)) vistos.add(x);
    expect([...vistos].sort()).toEqual(fila);
  });

  it("o corte fixo NÃO cumpriria isso — a prova de que o teste não é vazio", () => {
    // Sem rotação, `g` nunca apareceria por mais ticks que passassem.
    const vistos = new Set<string>();
    for (let t = 0; t < 50; t++) for (const x of fila.slice(0, 3)) vistos.add(x);
    expect(vistos.has("g")).toBe(false);
  });

  it("fila vazia e teto zero não explodem nem inventam mesa", () => {
    expect(aVezDeQuem([], 5, 3)).toEqual([]);
    expect(aVezDeQuem(fila, 0, 3)).toEqual([]);
  });

  /**
   * ⚠️ `%` em JS devolve NEGATIVO para entrada negativa, e um relógio errado
   * (ou um teste com data anterior a 1970) viraria um índice negativo — que em
   * JS não estoura, devolve `undefined`, e a mesa "rodaria" com `undefined` no
   * lugar dos dados.
   */
  it("tick negativo não vira índice negativo", () => {
    const r = aVezDeQuem(fila, 3, -1);
    expect(r).toHaveLength(3);
    expect(r.every((x) => fila.includes(x))).toBe(true);
  });

  it("o orçamento do agente é MENOR que o geral — ele custa 3 leituras por símbolo", () => {
    // ⚠️ Valores fixados, não derivados um do outro: um teste que escreve
    // `AGENTES_POR_TICK < TRABALHO_POR_TICK` passa com os dois em 1.
    //
    // ⚠️ 120, NÃO 40, e a mudança é de UNIDADE: o teto passou a contar leituras
    // em vez de mesas (13/09). Quarenta mesas de ~3 símbolos eram ~120
    // leituras; manter 40 com a unidade nova cortaria a capacidade do tique em
    // três vezes sem ninguém ter pedido.
    expect(TRABALHO_POR_TICK).toBe(120);
    expect(AGENTES_POR_TICK).toBe(8);
  });
});

/**
 * ⚠️⚠️ O TETO QUE CORTA SEMPRE OS MESMOS — a auditoria de 13/09.
 *
 * `aVezDeQuem` estava certo, testado, e aplicado PELA METADE: rolava dentro de
 * um dono e não entre donos. Como o teto por plano é de 3 a 10 mesas, a rotação
 * interna virava no-op, e quem passava do teto global era sempre o mesmo
 * cliente — o mais novo. É o padrão que esta casa já pagou seis vezes: a peça
 * certa, testada, e desligada do caminho que decide.
 */
describe("o teto do tique conta LEITURAS e gira entre donos", () => {
  it("⚠️ a instância de agente custa 3× a própria, por símbolo", () => {
    // Não é cautela genérica: são 3 leituras (1h, 4h, 1d) contra 1.
    expect(custoDoTrabalho({ simbolos: ["BTC", "ETH"], mesa: null })).toBe(2);
    expect(custoDoTrabalho({ simbolos: ["BTC", "ETH"], mesa: "strat_mech" })).toBe(2 * PESO_DO_AGENTE);
    expect(PESO_DO_AGENTE).toBe(3);
  });

  it("⚠️ mesa sem símbolo NÃO é grátis — custo zero a tornaria infinita no teto", () => {
    expect(custoDoTrabalho({ simbolos: [], mesa: null })).toBe(1);
    expect(custoDoTrabalho({ simbolos: [], mesa: "strat_dex" })).toBe(PESO_DO_AGENTE);
  });

  it("⚠️⚠️ uma mesa gorda não custa o mesmo que uma magra — era esse o defeito", () => {
    const magra = custoDoTrabalho({ simbolos: ["BTC"], mesa: null });
    const gorda = custoDoTrabalho({ simbolos: Array(10).fill("X"), mesa: null });
    expect(gorda).toBeGreaterThan(magra);
    // Com o teto contando MESAS, as duas custavam 1 — e a gorda comia o tique.
    expect(gorda / magra).toBe(10);
  });

  it("⚠️⚠️ a janela gira entre DONOS, não só dentro de um", () => {
    const donos = ["a", "b", "c", "d", "e"];
    const t0 = aVezDeQuem(donos, 2, 0);
    const t1 = aVezDeQuem(donos, 2, 1);
    const t2 = aVezDeQuem(donos, 2, 2);
    expect(t0).not.toEqual(t1);
    // Em ceil(n/teto) ticks todo mundo passou: é isso que faz ser fila e não corte.
    const vistos = new Set([...t0, ...t1, ...t2]);
    expect(vistos.size).toBe(donos.length);
  });

  it("⚠️ o teto de donos é menor que a plataforma, senão ele não é teto", () => {
    expect(DONOS_POR_TICK).toBeGreaterThan(0);
    expect(Number.isFinite(DONOS_POR_TICK)).toBe(true);
  });

  it("⚠️ o orçamento por dono divide o global — um cliente não come o tique", () => {
    // É a conta que o tique faz: ceil(TRABALHO_POR_TICK / donosDaVez.length).
    const porDono = (n: number) => Math.max(1, Math.ceil(TRABALHO_POR_TICK / n));
    expect(porDono(1)).toBe(TRABALHO_POR_TICK);        // sozinho, leva tudo
    expect(porDono(12)).toBeLessThan(TRABALHO_POR_TICK); // com fila, divide
    expect(porDono(1000)).toBe(1);                      // e nunca chega a zero
  });
});
