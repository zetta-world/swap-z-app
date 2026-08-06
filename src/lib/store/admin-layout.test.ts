/**
 * O RECONCILIADOR DE LAYOUT — onde nasce um painel novo.
 *
 * ⚠️ POR QUE ISTO VIROU TESTE (06/08).
 *
 * O dono perguntou "onde está o botão de medir rendimento líquido?". Metade da
 * resposta era que eu não tinha feito o deploy. A outra metade estava aqui: o
 * reconciliador fazia `order.push(m.id)`, então painel novo nascia no RODAPÉ do
 * admin de todo mundo que já tinha layout salvo — ou seja, de todo mundo —
 * independentemente do `defaultOrder` declarado.
 *
 * O RENDIMENTO nasceu com `defaultOrder: 8.5` de propósito, para cair ao lado do
 * FUNDING (8). Cairia no fim de tudo.
 *
 * Mesma família do `adm-btn` sem CSS e dos dois botões com rótulo idêntico: o
 * recurso existe, funciona, e não é encontrável. E ele vivia num `merge` dentro
 * do `persist`, código que só roda no navegador de alguém — que é exatamente
 * como um defeito desses sobrevive meses sem ninguém ver.
 */

import { describe, it, expect } from "vitest";
import { reconciliar } from "@/lib/store/admin-layout";
import { MODULE_REGISTRY, MODULE_BY_ID, type ModuleId } from "@/lib/admin/modules";

/** Um layout salvo "antigo": tudo menos os módulos passados como novos. */
function salvoSem(...novos: ModuleId[]): ModuleId[] {
  return [...MODULE_REGISTRY]
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((m) => m.id)
    .filter((id) => !novos.includes(id));
}

describe("um módulo novo entra onde foi declarado", () => {
  it("o RENDIMENTO cai logo depois do FUNDING, não no fim", () => {
    const salva = salvoSem("rendimento");
    const { order } = reconciliar(salva, salva);
    const iFunding = order.indexOf("funding");
    const iRend = order.indexOf("rendimento");

    expect(iFunding, "o funding sumiu do registro?").toBeGreaterThan(-1);
    expect(iRend).toBe(iFunding + 1);
    // E o teste que a versão antiga passaria: NÃO é o último.
    expect(iRend).toBeLessThan(order.length - 1);
  });

  it("todo módulo do registro acaba na ordem, sem duplicar", () => {
    const salva = salvoSem("rendimento");
    const { order } = reconciliar(salva, salva);
    expect(new Set(order).size).toBe(order.length);
    for (const m of MODULE_REGISTRY) expect(order, m.id).toContain(m.id);
  });

  /**
   * Ordenar a lista inteira por `defaultOrder` consertaria a posição e jogaria
   * fora o arranjo de quem arrastou os painéis. O novo entra; o resto não se
   * mexe.
   */
  it("a reordenação MANUAL do dono sobrevive à chegada do novo", () => {
    const salva = salvoSem("rendimento");
    // O dono puxou o LOGS para o topo, contra o `defaultOrder` dele.
    const manual = ["logs-security" as ModuleId, ...salva.filter((x) => x !== "logs-security")];
    const { order } = reconciliar(manual, manual);
    expect(order[0]).toBe("logs-security");
    // E a ordem relativa dos antigos continua a que ele deixou.
    const antigos = order.filter((x) => x !== "rendimento");
    expect(antigos).toEqual(manual);
  });

  it("dois módulos novos se encadeiam na ordem certa, não invertidos", () => {
    const salva = salvoSem("funding", "rendimento");
    const { order } = reconciliar(salva, salva);
    expect(order.indexOf("funding")).toBeLessThan(order.indexOf("rendimento"));
  });

  it("sem vizinho anterior, o novo vai para o começo — nunca some", () => {
    // `command` tem o menor defaultOrder de todos (-2).
    const salva = salvoSem("command");
    const { order } = reconciliar(salva, salva);
    expect(order.indexOf("command")).toBe(0);
  });
});

describe("o que estava ligado e o que estava desligado", () => {
  it("o módulo novo nasce LIGADO quando é `defaultEnabled`", () => {
    const salva = salvoSem("rendimento");
    const { enabled } = reconciliar(salva, salva);
    expect(MODULE_BY_ID["rendimento"]?.defaultEnabled).toBe(true);
    expect(enabled.has("rendimento")).toBe(true);
  });

  /**
   * Painel que o dono desligou de propósito NÃO pode voltar sozinho num deploy.
   * Reconciliador que religa tudo é o mesmo problema do layout que se
   * reordena: a máquina desfazendo uma decisão humana em silêncio.
   */
  it("o que o dono DESLIGOU continua desligado depois de um deploy", () => {
    const salva = salvoSem("rendimento");
    const habilitados = salva.filter((x) => x !== "funding");
    const { enabled } = reconciliar(salva, habilitados);
    expect(enabled.has("funding")).toBe(false);
    expect(enabled.has("rendimento")).toBe(true);
  });

  it("layout salvo vazio recebe o registro inteiro", () => {
    const { order, enabled } = reconciliar([], []);
    expect(order).toHaveLength(MODULE_REGISTRY.length);
    expect(enabled.size).toBe(MODULE_REGISTRY.filter((m) => m.defaultEnabled).length);
  });
});

/**
 * ⚠️ A ÂNCORA É DA MESMA ABA, e a primeira versão desta correção errava nisso.
 *
 * Eu comparava `defaultOrder` no registro inteiro. Só que ele NÃO é global — se
 * repete entre categorias (há um `8` em `lab` e outro em `controls`). O
 * RENDIMENTO (lab, 8.5) ancorava depois de um módulo de CONTROLES: eu
 * consertava a posição e trocava a aba, que é o mesmo defeito de
 * encontrabilidade com outra roupa.
 *
 * ⚠️ E o teste que pegou isso eu tinha escrito para outra coisa. A primeira
 * versão desta seção afirmava que dois módulos não podem dividir o mesmo
 * `defaultOrder` — e o registro tem seis pares assim, inclusive cinco painéis
 * empatados em `lab ordem 5`. A premissa estava errada: empate NÃO dá ordem
 * arbitrária, porque `MODULE_REGISTRY` é um array literal e o desempate sai da
 * posição dele, que é estável entre deploys. O que precisa ser garantido é
 * DETERMINISMO, não unicidade — e é isso que está afirmado abaixo.
 */
describe("empate não vira posição sorteada", () => {
  it("a mesma entrada dá a mesma saída, sempre", () => {
    const salva = salvoSem("rendimento", "funding");
    const a = reconciliar(salva, salva);
    const b = reconciliar(salva, salva);
    expect(a.order).toEqual(b.order);
    expect([...a.enabled].sort()).toEqual([...b.enabled].sort());
  });

  it("o RENDIMENTO ancora em irmão de LAB, nunca num de CONTROLES", () => {
    const salva = salvoSem("rendimento");
    const { order } = reconciliar(salva, salva);
    const anterior = MODULE_BY_ID[order[order.indexOf("rendimento") - 1]];
    expect(anterior?.category, `ancorou em ${anterior?.id}`).toBe("lab");
  });

  /**
   * Empate dentro da aba é tolerável, mas o painel NOVO precisa de posição
   * própria — senão ele nasce no meio de um bolo de cinco e some de novo.
   */
  it("o defaultOrder do RENDIMENTO é único dentro de LAB", () => {
    const meu = MODULE_BY_ID["rendimento"]!;
    const iguais = MODULE_REGISTRY.filter(
      (m) => m.category === meu.category && m.defaultOrder === meu.defaultOrder,
    );
    expect(iguais.map((m) => m.id)).toEqual(["rendimento"]);
  });
});
