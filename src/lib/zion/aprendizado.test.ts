import { describe, it, expect } from "vitest";
import {
  canalDe, estadoDaMesa, vereditoDoVolante, DIAS_ATE_CHAMAR_DE_TRAVADO,
  type EntradaDeMesa,
} from "@/lib/zion/aprendizado";

const DIA = 86_400_000;
const AGORA = Date.parse("2026-08-16T12:00:00Z");
const N = 10;

describe("aprendizado — o canal de cada mesa", () => {
  it("separa as TRÊS razões de não aprender, que na tela pareciam a mesma", () => {
    expect(canalDe("strat_mech")).toBe("controle");   // por decisão
    expect(canalDe("strat_record")).toBe("registro"); // por número, não prosa
    expect(canalDe("strat_day")).toBe("nenhum");      // não tem onde pousar
    expect(canalDe("arbiter2_3x")).toBe("nenhum");
  });

  it("reconhece quem aprende por lição, inclusive os fora do padrão de nome", () => {
    expect(canalDe("mistral_scan")).toBe("licao");
    expect(canalDe("oracle_kimi")).toBe("licao");
    expect(canalDe("radar")).toBe("licao");
    // ⚠️ O que faltava até 16/08: `strat_ai` não casa com nenhum padrão de
    // nome e por isso era tratado como mesa mecânica.
    expect(canalDe("strat_ai")).toBe("licao");
  });
});

describe("aprendizado — travado é afirmação forte", () => {
  const mesa = (over: Partial<EntradaDeMesa> = {}): EntradaDeMesa =>
    ({ source: "radar", ultimaLicaoMs: AGORA - 22 * DIA, naoRefletidos: 0, ...over });

  it("mesa quieta porque o mercado não deu trade NÃO está travada", () => {
    const e = estadoDaMesa(mesa({ naoRefletidos: 3 }), AGORA, N);
    expect(e.travado).toBe(false);
    expect(e.faltam).toBe(7);
    expect(e.porque).toContain("faltam 7");
  });

  it("cruzou o limiar mas a lição é de HOJE: espera, não defeito", () => {
    // O cron é de 30min — cruzar há dez minutos não é travamento.
    const e = estadoDaMesa(mesa({ naoRefletidos: 12, ultimaLicaoMs: AGORA - 3600_000 }), AGORA, N);
    expect(e.travado).toBe(false);
    expect(e.porque).toContain("a próxima varredura reflete");
  });

  it("cruzou o limiar E a lição é velha: travado", () => {
    const e = estadoDaMesa(mesa({ naoRefletidos: 12 }), AGORA, N);
    expect(e.travado).toBe(true);
    expect(e.diasParado).toBe(22);
    expect(e.porque).toContain("não disparou");
  });

  it("o piso de dias é fronteira real, não decoração", () => {
    const noPiso = AGORA - DIAS_ATE_CHAMAR_DE_TRAVADO * DIA;
    expect(estadoDaMesa(mesa({ naoRefletidos: 12, ultimaLicaoMs: noPiso }), AGORA, N).travado).toBe(true);
    // Um minuto antes do piso ainda é espera.
    expect(estadoDaMesa(mesa({ naoRefletidos: 12, ultimaLicaoMs: noPiso + 60_000 }), AGORA, N).travado).toBe(false);
  });

  it("nunca refletiu e já acumulou: travado, mesmo sem lição anterior", () => {
    const e = estadoDaMesa(mesa({ ultimaLicaoMs: null, naoRefletidos: 15 }), AGORA, N);
    expect(e.travado).toBe(true);
    expect(e.diasParado).toBeNull();
    expect(e.porque).toContain("NUNCA refletiu");
  });

  it("mesa sem canal nunca é travada, por mais decididos que acumule", () => {
    for (const s of ["strat_mech", "strat_day", "strat_record"]) {
      const e = estadoDaMesa({ source: s, ultimaLicaoMs: null, naoRefletidos: 500 }, AGORA, N);
      expect(e.travado).toBe(false);
      expect(e.faltam).toBeNull();
    }
  });
});

describe("aprendizado — o veredito do volante", () => {
  /**
   * ⚠️ O CASO REAL DE 16/08, com os números que estavam no banco. Se esta
   * medição existisse em 27/07, o dono teria visto no mesmo dia.
   */
  it("reconstrói os 20 dias de silêncio: nenhuma travada, e ainda assim alarme", () => {
    const retro = AGORA - 20 * DIA;
    const v = vereditoDoVolante([
      { source: "radar",        ultimaLicaoMs: retro, naoRefletidos: 5 },
      { source: "mistral_scan", ultimaLicaoMs: retro, naoRefletidos: 1 },
      { source: "kimi_scan",    ultimaLicaoMs: retro, naoRefletidos: 3 },
      { source: "grok_scan",    ultimaLicaoMs: retro, naoRefletidos: 1 },
    ], AGORA, N);

    // Nenhuma cruzou o limiar sozinha — cada uma tinha explicação inocente.
    expect(v.travadas).toBe(0);
    expect(v.comLicao).toBe(4);
    expect(v.diasDesdeAUltimaLicao).toBe(20);
    // ...e o veredito do CONJUNTO acusa mesmo assim. É esse o ponto.
    expect(v.veredito).toContain("20 dias");
    expect(v.veredito).toContain("⚠️");
  });

  it("volante vivo não dispara alarme", () => {
    const v = vereditoDoVolante([
      { source: "radar",     ultimaLicaoMs: AGORA - 2 * DIA, naoRefletidos: 4 },
      { source: "strat_ai",  ultimaLicaoMs: AGORA - 1 * DIA, naoRefletidos: 2 },
    ], AGORA, N);
    expect(v.travadas).toBe(0);
    expect(v.veredito).toContain("volante vivo");
    expect(v.veredito).not.toContain("⚠️");
  });

  it("uma travada domina o veredito e sobe no topo da lista", () => {
    const v = vereditoDoVolante([
      { source: "strat_ai", ultimaLicaoMs: AGORA - 1 * DIA, naoRefletidos: 0 },
      { source: "radar",    ultimaLicaoMs: AGORA - 9 * DIA, naoRefletidos: 30 },
    ], AGORA, N);
    expect(v.travadas).toBe(1);
    expect(v.veredito).toContain("VOLANTE TRAVADO");
    expect(v.mesas[0].source).toBe("radar");     // travada primeiro
    expect(v.mesas[0].nome).toContain("HEIMDALL"); // nome vem do registro de mesas
  });

  it("mesas sem canal não contam para o volante nem escondem o alarme", () => {
    const v = vereditoDoVolante([
      { source: "strat_mech", ultimaLicaoMs: null, naoRefletidos: 39 },
      { source: "strat_day",  ultimaLicaoMs: null, naoRefletidos: 16 },
      { source: "radar",      ultimaLicaoMs: AGORA - 9 * DIA, naoRefletidos: 30 },
    ], AGORA, N);
    expect(v.comLicao).toBe(1);
    expect(v.travadas).toBe(1);
    expect(v.mesas).toHaveLength(3);   // aparecem na tela, com o motivo delas
  });
});
