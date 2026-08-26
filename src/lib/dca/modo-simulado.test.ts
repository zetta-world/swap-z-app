import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️⚠️ O QUE FAZ O MODO SIMULADO VALER COMO TESTE.
 *
 * Se o simulado fosse um caminho paralelo, ele provaria só que o caminho
 * paralelo funciona — e o dono ligaria o dinheiro real confiando num ensaio
 * que nunca ensaiou a peça certa.
 *
 * Estas travas exigem que ele seja o MESMO caminho com UMA diferença: a
 * chamada que coloca a ordem. Mesma decisão de janela, mesma reserva com a
 * trava unique, mesmos tetos, mesmo preço de mercado, mesmo registro.
 */

const CRON = readFileSync(join(process.cwd(), "src/app/api/dca/cron/route.ts"), "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
const CODIGO = semComentarios(CRON);

describe("o simulado percorre o MESMO caminho", () => {
  it("só existe UMA chamada a placeCexOrder no cron", () => {
    // Duas chamadas significariam um ramo paralelo — exatamente o que este
    // arquivo existe para impedir.
    const n = (CODIGO.match(/placeCexOrder\(/g) ?? []).length;
    expect(n, "mais de uma chamada = caminho paralelo").toBe(1);
  });

  it("a reserva do ciclo acontece ANTES do ramo de simulação", () => {
    // ⚠️ A trava contra comprar duas vezes tem de valer nos dois modos. Se a
    // reserva ficasse dentro do ramo real, um plano simulado poderia gravar
    // ciclos duplicados e o extrato mentiria sobre a própria simulação.
    expect(CODIGO.indexOf("reservarCiclo(")).toBeLessThan(CODIGO.indexOf("const order = simulado"));
  });

  it("os tetos são aplicados ANTES do ramo — simulado respeita orçamento", () => {
    expect(CODIGO.indexOf("tetoDoCiclo(")).toBeLessThan(CODIGO.indexOf("const order = simulado"));
  });

  it("a guarda de preço vale nos dois modos", () => {
    // Sem preço de referência não há como simular honestamente: o extrato
    // sairia com preço inventado.
    expect(CODIGO.indexOf("sem preco de referencia")).toBeLessThan(CODIGO.indexOf("const order = simulado"));
  });
});

describe("o simulado não pode se passar por real", () => {
  it("o id da ordem simulada é prefixado", () => {
    // Um id que pudesse ser confundido com o de uma ordem real transformaria
    // extrato simulado em evidência de compra que nunca houve.
    expect(CODIGO).toMatch(/id: `simulado:/);
  });

  it("o ciclo é carimbado como simulado ao fechar", () => {
    // Carimbo no CICLO, não deduzido do plano: um update no plano não pode
    // relabelar histórico.
    expect(CODIGO).toMatch(/custoUsd: custo, simulado/);
  });

  it("o ciclo que FALHOU também leva o carimbo", () => {
    expect(CODIGO).toMatch(/status: "falhou", motivo: msg, simulado/);
  });

  it('o resumo distingue "simulou" de "comprou"', () => {
    expect(CODIGO).toMatch(/simulado \? "simulou" : "comprou"/);
  });
});

describe("credencial: só o caminho que gasta exige chave", () => {
  const ROTA = semComentarios(
    readFileSync(join(process.cwd(), "src/app/api/dca/planos/route.ts"), "utf8"));

  it("⚠️ qualquer coisa que não seja exatamente 'real' cai em simulado", () => {
    // Campo ausente, typo ou cliente antigo NÃO podem acabar comprando.
    expect(ROTA).toMatch(/b\.modo === "real" \? "real" : "simulado"/);
  });

  it("a credencial só é exigida (e guardada) no modo real", () => {
    const i = ROTA.indexOf('if (modo === "real")');
    expect(i, "o ramo de credencial tem de ser condicional ao modo").toBeGreaterThan(0);
    expect(ROTA.indexOf("guardarConexao(")).toBeGreaterThan(i);
    expect(ROTA.indexOf("credenciais_ausentes")).toBeGreaterThan(i);
  });

  it("o painel não manda a chave quando o modo é simulado", () => {
    // ⚠️ A condição ficou MAIS estrita depois que o painel passou a aceitar
    // credencial opcional (25/08): `modo === "real" && credentials`. Não basta
    // pedir o modo real — a chave tem de existir. Esta trava acusou a mudança,
    // e estava certa em acusar: o padrão antigo não cobria mais o código.
    const PANEL = semComentarios(
      readFileSync(join(process.cwd(), "src/components/cex/DcaPanel.tsx"), "utf8"));
    expect(PANEL).toMatch(/\.\.\.\(modo === "real" && credentials \? \{ credentials:/);
  });

  it("o painel nasce em simulado", () => {
    const PANEL = readFileSync(join(process.cwd(), "src/components/cex/DcaPanel.tsx"), "utf8");
    expect(PANEL).toMatch(/useState<"simulado" \| "real">\("simulado"\)/);
  });

  it("⚠️ sem chave no cofre, o modo REAL fica indisponível", () => {
    /**
     * O conserto da contradição de 25/08: o modo simulado existe para testar
     * sem chave, mas a tela morava atrás do desbloqueio do cofre. Agora o
     * painel roda sem credencial — e o botão do real fica DESABILITADO com o
     * motivo, em vez de escondido. Escondê-lo faria o recurso parecer
     * inexistente.
     */
    const PANEL = semComentarios(
      readFileSync(join(process.cwd(), "src/components/cex/DcaPanel.tsx"), "utf8"));
    expect(PANEL).toMatch(/const temChave = Boolean\(credentials\?\.apiKey && credentials\?\.apiSecret\)/);
    expect(PANEL).toMatch(/const bloqueado = m === "real" && !temChave/);
    expect(PANEL).toMatch(/disabled=\{bloqueado\}/);
  });
});
