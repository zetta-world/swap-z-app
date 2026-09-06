/**
 * ⚠️⚠️ CADA TESTE AQUI É UMA GUARDA DE DINHEIRO. O papel adiante é o único
 * custo da bancada que RECORRE: um erro num backtest custa uma rodada; um erro
 * aqui custa a cada 30 minutos, para sempre, por cliente.
 */
import { describe, it, expect } from "vitest";
import { mesasQuePodemTickar, decidirAbertura, decidirFechamento, alvoEStop, type Mesa } from "@/lib/bancada/papel";
import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";
import type { VelaComTempo } from "@/lib/mercado/velas";
import { donoDeLinhaDoBanco } from "@/lib/bancada/dono";

const H = 3_600_000;
const params: EstrategiaDoCliente = {
  entrada: { tipo: "media", n: 2 }, direcao: "compra",
  alvoPct: 2, stopPct: 2, horasLimite: 24, praca: "futuros_gate", papel: "maker",
};

function mesa(p: Partial<Mesa> = {}): Mesa {
  return {
    id: "m1", dono: donoDeLinhaDoBanco("0xA")!, params, simbolos: ["BTC"], intervalo: "1h",
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
