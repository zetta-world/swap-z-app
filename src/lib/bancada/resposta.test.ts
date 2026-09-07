import { describe, it, expect } from "vitest";
import { medidaDoPost, medidaDoHistorico, acertoPct, type Medida } from "@/lib/bancada/resposta";
import { NAO_MEDIDO } from "@/lib/bancada/veredito";

/**
 * ⚠️⚠️ O QUE ESTE ARQUIVO TRAVA É UMA IGUALDADE, não um formato.
 *
 * A mesma rodada chega à tela por dois canais — o `POST /backtest` respondendo
 * na hora e o `GET /rodadas` relendo o banco. Se os dois desembrulharem
 * diferente, a rodada muda de cara ao recarregar a página, e muda em silêncio
 * porque nada compara os dois. Aqui eles são comparados.
 */

const POST = {
  ok: true,
  veredito: {
    veredito: "ganhou",
    equilibrioPct: 52.4,
    competidorPct: 1.8,
    naoMedidoChaves: ["derrapagem", "gas"],
    naoMedidoTexto: ["BTC 1h: só chegaram 66% da janela"],
  },
  resumo: { n: 40, acertos: 24, brutoPct: 9.1, taxaPct: -3.2, liquidoCompostoPct: 5.7 },
};

const HISTORICO = {
  veredito: "ganhou",
  n: 40, acertos: 24,
  brutoPct: 9.1, taxaPct: -3.2, liquidoPct: 5.7,
  equilibrioPct: 52.4, competidorPct: 1.8,
  naoMedidoChaves: ["derrapagem", "gas"],
  naoMedidoTexto: ["BTC 1h: só chegaram 66% da janela"],
};

describe("os dois canais descrevem a MESMA rodada", () => {
  it("POST e histórico produzem `Medida` idêntica", () => {
    expect(medidaDoPost(POST)).toEqual(medidaDoHistorico(HISTORICO));
  });

  /**
   * ⚠️ `liquidoCompostoPct`, NUNCA a soma aritmética. Somar `Σ` de retornos por
   * trade infla a estratégia quanto mais ela opera — e o competidor é retorno
   * de janela. É a nota que já mora em `veredito.ts`, e aqui ela vira asserção.
   */
  it("o líquido do POST é o COMPOSTO, não outro campo", () => {
    const m = medidaDoPost({ ...POST, resumo: { ...POST.resumo, liquidoCompostoPct: 5.7, liquidoPct: 99 } })!;
    expect(m.liquidoPct).toBe(5.7);
  });
});

describe("ausência continua ausência", () => {
  it("competidor nulo NÃO vira 0 — zero afirmaria que o mercado ficou parado", () => {
    const m = medidaDoHistorico({ ...HISTORICO, competidorPct: null })!;
    expect(m.competidorPct).toBeNull();
    const p = medidaDoPost({ ...POST, veredito: { ...POST.veredito, competidorPct: null } })!;
    expect(p.competidorPct).toBeNull();
  });

  it("equilíbrio nulo continua nulo nos dois canais", () => {
    expect(medidaDoHistorico({ ...HISTORICO, equilibrioPct: null })!.equilibrioPct).toBeNull();
    expect(medidaDoPost({ ...POST, veredito: { ...POST.veredito, equilibrioPct: null } })!.equilibrioPct).toBeNull();
  });

  /**
   * ⚠️ Uma rodada gravada antes da migration 0042 não tem competidor nem
   * chaves. Ela tem de voltar mostrando "—", não um zero inventado.
   */
  it("linha antiga (sem os campos de 0042) não ganha números por acidente", () => {
    const m = medidaDoHistorico({
      veredito: "perdeu", n: 4, acertos: 0, brutoPct: -1, taxaPct: -0.8, liquidoPct: -1.8,
      equilibrioPct: null,
    })!;
    expect(m.competidorPct).toBeNull();
    expect(m.naoMedidoChaves).toEqual([]);
  });

  it("resposta sem veredito ou sem resumo é `null`, não uma medida vazia", () => {
    expect(medidaDoPost({ ok: true })).toBeNull();
    expect(medidaDoPost({ ok: true, resumo: POST.resumo })).toBeNull();
    expect(medidaDoHistorico(null)).toBeNull();
  });
});

describe("as chaves do não-medido são fechadas", () => {
  it("chave desconhecida é DESCARTADA, não repassada", () => {
    // ⚠️ Ela sairia como `undefined` na tabela de tradução e viraria um
    // marcador vazio na tela — pior que ausente, porque parece medido.
    const m = medidaDoHistorico({ ...HISTORICO, naoMedidoChaves: ["derrapagem", "inventada", 7, null] })!;
    expect(m.naoMedidoChaves).toEqual(["derrapagem"]);
  });

  it("toda chave que o servidor produz é aceita aqui", () => {
    // ⚠️ O contrário do teste acima: se `NAO_MEDIDO` ganhar uma quinta chave e
    // este filtro não souber dela, a ressalva sumiria da tela em silêncio.
    const todas = Object.keys(NAO_MEDIDO);
    const m = medidaDoHistorico({ ...HISTORICO, naoMedidoChaves: todas })!;
    expect(m.naoMedidoChaves).toEqual(todas);
  });

  it("chave repetida não vira ressalva repetida", () => {
    const m = medidaDoHistorico({ ...HISTORICO, naoMedidoChaves: ["gas", "gas"] })!;
    expect(m.naoMedidoChaves).toEqual(["gas"]);
  });
});

describe("a taxa de acerto", () => {
  const base = medidaDoHistorico(HISTORICO)!;
  it("24 de 40 é 60%", () => {
    expect(acertoPct(base)).toBe(60);
  });
  /**
   * ⚠️ `n = 0` DEVOLVE `null`, não 0%. "Nenhuma operação" e "todas erradas" são
   * estados diferentes, e o segundo é bem pior.
   */
  it("sem operação não há taxa — e não é 0%", () => {
    const vazia: Medida = { ...base, n: 0, acertos: 0 };
    expect(acertoPct(vazia)).toBeNull();
  });
});
