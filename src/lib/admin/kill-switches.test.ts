/**
 * AS TRAVAS DOS KILL-SWITCHES.
 *
 * ⚠️ O que estes testes protegem é a coisa que faltou por mais tempo: que os
 * interruptores sejam LIDOS. `disable_swap`, `disable_cex` e `maintenance_mode`
 * existiam no painel, gravavam no banco, entravam no log de auditoria — e
 * ninguém os consultava. Invariante nº 14 na forma mais cara: o operador vê a
 * chave virar e acredita que desligou.
 *
 * E protegem a segunda decisão, que é a que costuma virar defeito: a DIREÇÃO
 * DE FALHA é por rota, não uma regra só.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decidirCaminhoDeDinheiro, decidirCaminhoConfirmado, type EstadoKillSwitches,
} from "@/lib/admin/kill-switches";

/** Helper em escopo de MÓDULO — já escorreguei duas vezes prendendo em `describe`. */
function estado(p: Partial<EstadoKillSwitches> = {}): EstadoKillSwitches {
  return { disable_swap: false, disable_cex: false, maintenance_mode: false, lido: true, ...p };
}

describe("dinheiro que SAI — falha FECHADA", () => {
  it("interruptor ligado bloqueia, e diz qual foi", () => {
    const v = decidirCaminhoDeDinheiro(estado({ disable_cex: true }), ["disable_cex", "maintenance_mode"]);
    expect(v.bloqueado).toBe(true);
    expect(v.motivo).toBe("disable_cex");
  });

  it("maintenance_mode bloqueia mesmo com o específico desligado", () => {
    const v = decidirCaminhoDeDinheiro(estado({ maintenance_mode: true }), ["disable_cex", "maintenance_mode"]);
    expect(v.bloqueado).toBe(true);
    expect(v.motivo).toBe("maintenance_mode");
  });

  /**
   * ⚠️ A DECISÃO CENTRAL. Bloquear uma ordem durante uma queda de banco custa
   * um trade perdido; deixar passar durante um incidente pode custar fundos. E
   * as outras guardas desta rota (preço de referência, notional) já dependem de
   * dado externo — sem banco ela já está operando sem as travas dela.
   */
  it("leitura falhou BLOQUEIA, e é distinguível de um interruptor ligado", () => {
    const v = decidirCaminhoDeDinheiro(estado({ lido: false }), ["disable_cex"]);
    expect(v.bloqueado).toBe(true);
    expect(v.motivo).toBe("leitura_falhou");
  });

  it("tudo desligado e leitura ok: passa", () => {
    expect(decidirCaminhoDeDinheiro(estado(), ["disable_cex", "maintenance_mode"]).bloqueado).toBe(false);
  });

  /** Um interruptor fora da lista pedida não pode barrar por tabela. */
  it("só barra os interruptores que a rota declarou", () => {
    const v = decidirCaminhoDeDinheiro(estado({ disable_swap: true }), ["disable_cex"]);
    expect(v.bloqueado).toBe(false);
  });
});

describe("rota que o usuário ainda CONFIRMA — falha ABERTA", () => {
  it("interruptor ligado bloqueia igual", () => {
    const v = decidirCaminhoConfirmado(estado({ disable_swap: true }), ["disable_swap", "maintenance_mode"]);
    expect(v.bloqueado).toBe(true);
    expect(v.motivo).toBe("disable_swap");
  });

  /**
   * ⚠️ A DIREÇÃO OPOSTA, e de propósito. Derrubar o swap de TODO MUNDO por um
   * Postgres intermitente é o dano certo; o cenário em que fechar protegeria
   * alguém exige "o dono desligou" E "a leitura falhou exatamente agora".
   */
  it("leitura falhou DEIXA PASSAR", () => {
    const v = decidirCaminhoConfirmado(estado({ lido: false }), ["disable_swap"]);
    expect(v.bloqueado).toBe(false);
  });

  /** As duas direções TÊM que divergir — se convergirem, uma delas está errada. */
  it("as duas decisões divergem exatamente no caso da leitura falha", () => {
    const cego = estado({ lido: false });
    expect(decidirCaminhoDeDinheiro(cego, ["disable_swap"]).bloqueado).toBe(true);
    expect(decidirCaminhoConfirmado(cego, ["disable_swap"]).bloqueado).toBe(false);
    // E são idênticas quando a leitura funcionou — a divergência é SÓ ali.
    for (const ligado of [true, false]) {
      const e = estado({ disable_swap: ligado });
      expect(decidirCaminhoDeDinheiro(e, ["disable_swap"]).bloqueado)
        .toBe(decidirCaminhoConfirmado(e, ["disable_swap"]).bloqueado);
    }
  });
});

/** Ver `espelho.test.ts`: comentário lido como código também APROVA. */
function semComentarios(codigo: string): string {
  return codigo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("os interruptores são LIDOS por alguém", () => {
  /**
   * ⚠️ ESTA É A TRAVA QUE FALTAVA POR ANOS. Um interruptor no painel sem
   * consumidor não é controle — é comentário com sintaxe de código.
   */
  it("cada kill-switch da plataforma tem consumidor no caminho que ele promete", () => {
    const ordem = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
    const cota  = semComentarios(readFileSync("src/app/api/quote/route.ts", "utf8"));
    const armar = semComentarios(readFileSync("src/app/api/autopilot/session/route.ts", "utf8"));

    // disable_cex → ordem de corretora (manual E autopilot) e o armar.
    expect(ordem).toContain("disable_cex");
    expect(armar).toContain("disable_cex");
    // disable_swap → a cotação FIRME, que é o payload assinável.
    expect(cota).toContain("disable_swap");
    // maintenance_mode → os três.
    for (const src of [ordem, cota, armar]) expect(src).toContain("maintenance_mode");
  });

  /**
   * ⚠️ E cada um com a direção de falha certa. Trocar as duas seria o defeito
   * silencioso: continua "funcionando" até o dia do incidente.
   */
  it("cada rota declara a direção de falha que corresponde ao que está em jogo", () => {
    const ordem = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
    const armar = semComentarios(readFileSync("src/app/api/autopilot/session/route.ts", "utf8"));
    const cota  = semComentarios(readFileSync("src/app/api/quote/route.ts", "utf8"));
    expect(ordem).toContain('"dinheiro_sai"');
    expect(armar).toContain('"dinheiro_sai"');
    expect(cota).toContain('"usuario_confirma"');
    expect(cota).not.toContain('"dinheiro_sai"');
  });

  /**
   * ⚠️ A cotação de LISTA não pode ser barrada junto: é comparação de preço,
   * navegação — não movimento de dinheiro.
   */
  it("a trava do swap fica dentro do ramo da cotação FIRME", () => {
    const cota = semComentarios(readFileSync("src/app/api/quote/route.ts", "utf8"));
    const iRamo  = cota.indexOf('if (mode === "quote")');
    const iTrava = cota.indexOf("checarKillSwitches(");
    expect(iRamo).toBeGreaterThan(-1);
    expect(iTrava).toBeGreaterThan(iRamo);
  });
});
