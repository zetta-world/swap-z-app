/**
 * CE-08 — REGRESSÃO DE QUALIDADE DO ZION CONTRA O MODELO DE VERDADE.
 *
 * ⚠️ USA CREDENCIAL REAL E GASTA TOKENS: só roda com autorização explícita do
 * dono, por variável — `ZION_QUALIDADE_AO_VIVO=1` e a chave do provedor no
 * ambiente. Sem as duas, é PULADO (este round não está autorizado a chamá-lo).
 *
 * Roda os dez casos de `regressao-qualidade.ts` no modo `ask`, em português, e
 * imprime a taxa de aprovação por modelo. Regra de aceite de qualquer troca de
 * modelo/roteamento por custo: a aprovação do candidato ≥ a do modelo atual.
 *
 *   ZION_QUALIDADE_AO_VIVO=1 KIMI_API_KEY=… [ZION_QUALIDADE_MODELOS=kimi-k2.6,outro] \
 *     npx vitest run --config bench/vitest.integration.config.ts bench/integracao/zion-qualidade
 */
import { describe, it, expect } from "vitest";
import { casosDeQualidade, avaliarResposta } from "@/lib/zion/regressao-qualidade";
import { ZION_FOUNDATION } from "@/lib/zion/foundation";
import { getModeInstructions } from "@/lib/zion/mode-prompts";
import { openaiCompatChat, openaiCompatConfigFromEnv } from "@/lib/ai/provider";

const AUTORIZADO = process.env.ZION_QUALIDADE_AO_VIVO === "1";
const cfg = openaiCompatConfigFromEnv();

describe.skipIf(!AUTORIZADO || !cfg)("ZION ao vivo — regressão de qualidade (CE-08)", () => {
  it("taxa de aprovação por modelo", { timeout: 600_000 }, async () => {
    const modelos = (process.env.ZION_QUALIDADE_MODELOS ?? cfg!.model).split(",").map((s) => s.trim());
    const sistema = [ZION_FOUNDATION, getModeInstructions("ask"), "IDIOMA DE SAÍDA OBRIGATÓRIO: Português do Brasil."].join("\n\n");
    const placar: Record<string, number> = {};
    for (const model of modelos) {
      let ok = 0;
      for (const caso of casosDeQualidade()) {
        const r = await openaiCompatChat({ model, system: sistema, user: caso.pergunta, maxTokens: 800 }, cfg!);
        const a = avaliarResposta(caso, r.text);
        if (a.aprovado) ok++;
        console.log(`[${model}] ${caso.id}: ${a.aprovado ? "PASS" : `FAIL faltando=${a.faltando.join("|")} proibidos=${a.proibidosEncontrados.join("|")}`}`);
      }
      placar[model] = ok / casosDeQualidade().length;
    }
    console.log(`PLACAR ${JSON.stringify(placar)}`);
    expect(Object.keys(placar).length).toBe(modelos.length);
  });
});
