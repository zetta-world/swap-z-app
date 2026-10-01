/**
 * ⚠️⚠️ A112 — A CAPACIDADE `dca_real_liberado` NA CRIAÇÃO DO PLANO REAL.
 *
 * O cron já recusava plano real sem a capacidade (fail-closed, desde o Round 1).
 * Mas o cron é a ÚLTIMA porta: sem o check AQUI, a rota de criação verificava a
 * chave contra a corretora (chamada externa) e a GRAVAVA cifrada no cofre para
 * um plano que o cron recusaria para sempre — credencial do cliente acumulada
 * no servidor "para quando abrir", que é o que o cofre existe para não ter.
 *
 * O caminho é EXATAMENTE o do cron: `lerCapacidades` + `decidirCapacidade`,
 * sem fallback para a chave legada, e `undefined` (leitura falhou) é FECHADO.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decidirCapacidade } from "@/lib/dca/capacidade";

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
const ROTA = semComentarios(readFileSync("src/app/api/dca/planos/route.ts", "utf8"));

const iModoReal = ROTA.indexOf('if (modo === "real")');
const iCheck  = ROTA.indexOf('decidirCapacidade("real"');

describe("A112 — capability do real na CRIAÇÃO, fail-closed", () => {
  it("A112.1 ⚠️⚠️ o check existe DENTRO do ramo real, antes de qualquer efeito", () => {
    expect(iModoReal).toBeGreaterThan(-1);
    expect(iCheck).toBeGreaterThan(iModoReal);
    // Antes da verificação externa, do cofre e do insert.
    expect(iCheck).toBeLessThan(ROTA.indexOf("verificarChave("));
    expect(iCheck).toBeLessThan(ROTA.indexOf("guardarConexao({"));
    expect(iCheck).toBeLessThan(ROTA.indexOf("criarPlano({"));
  });

  it("A112.2 ⚠️⚠️ capacidade fechada → HTTP 403 `dca_real_fechado`", () => {
    expect(ROTA).toMatch(/if \(!capacidade\.permitido\)/);
    expect(ROTA).toMatch(/error: "dca_real_fechado"/);
    expect(ROTA).toMatch(/dca_real_fechado"[\s\S]{0,200}\{ status: 403/);
  });

  it("A112.3 a recusa deixa evento AGUARDADO, com a causa", () => {
    // Fechado não pode ser silencioso — e na Vercel o evento sem `await` morre
    // com a função.
    expect(ROTA).toMatch(/await recordEvent\("dca_real_fechado"/);
    expect(ROTA).toMatch(/causa: capacidade\.causa/);
  });

  it("A112.4 é o MESMO caminho do cron — `lerCapacidades` + `decidirCapacidade`, sem atalho", () => {
    expect(ROTA).toMatch(/lerCapacidades\(getSupabaseAdmin\(\)\)/);
    expect(ROTA).toMatch(/decidirCapacidade\("real", await lerCapacidades/);
    // ⚠️ Nada de ler a chave legada direto nesta rota: o real não tem fallback.
    expect(ROTA).not.toMatch(/dca_liberado[^_]/);
  });

  it("A112.5 o SIMULADO não passa pelo check — caminho inalterado", () => {
    // O check está dentro de `if (modo === "real")`, então um plano simulado
    // nunca o alcança. E a validação de credenciais continua depois dele.
    expect(iCheck).toBeGreaterThan(iModoReal);
    expect(ROTA.indexOf("credenciais_ausentes")).toBeGreaterThan(iCheck);
  });

  it("A112.6 leitura falha (`undefined`) também é recusa, com causa própria", () => {
    // Fail-closed na criação: banco ruim não é licença para guardar chave.
    const v = decidirCapacidade("real", { simulado: "true", real: undefined });
    expect(v.permitido).toBe(false);
    expect(v.causa).toBe("indisponivel");
    // E a causa sobe na resposta, para o cliente não receber um 403 mudo.
    expect(ROTA).toMatch(/causa: capacidade\.causa/);
  });
});
