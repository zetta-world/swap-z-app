/**
 * AS TRAVAS DA VERIFICAÇÃO DE CHAVE.
 *
 * ⚠️ POR QUE ISTO EXISTE (09/08, auditoria da Fase 7).
 *
 * O autopilot guarda a credencial do cliente CIFRADA NO SERVIDOR para negociar
 * com o navegador fechado — divulgado na tela de armar, com bloco próprio. A
 * divulgação está certa; eu conferi antes de reclamar dela.
 *
 * O que não estava: o controle que torna esse risco aceitável — a chave ser
 * "só negociar, não sacar" — nunca foi verificado. `CexSettings.tsx` gravava
 * `readOnly: true` FIXO, o tipo dizia "marked by the USER" (o usuário não marca
 * nada), o nome dizia `readOnly` e o significado era "trade-only", e o campo
 * **nunca era lido**. Quatro problemas numa linha.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  lerPermissao, decidirArmar, suportaVerificacao, type PermissaoChave,
} from "@/lib/cex/permissoes";

/**
 * ⚠️ Definido em escopo de MÓDULO, não dentro de um `describe` — já escorreguei
 * nisso duas vezes (Fase 5.1 e Fase 6). Helper preso num bloco não serve aos
 * outros e vira cópia.
 *
 * E a ressalva de sempre (ver `espelho.test.ts`): teste que lê comentário como
 * código também APROVA por comentário. Por isso tira os comentários primeiro.
 */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

describe("ler a permissão — o default é o PESSIMISTA", () => {
  /**
   * ⚠️ INVARIANTE Nº 6: "não medimos" ≠ "medimos zero". Um formato de resposta
   * que mude do outro lado não pode virar "chave segura" em silêncio.
   */
  it("campo ausente é NÃO VERIFICÁVEL, nunca 'só negocia'", () => {
    expect(lerPermissao("binance", {}).veredito).toBe("nao_verificavel");
    expect(lerPermissao("binance", { outroCampo: 1 }).veredito).toBe("nao_verificavel");
    expect(lerPermissao("binance", null).veredito).toBe("nao_verificavel");
  });

  it("distingue campo AUSENTE de campo FALSE", () => {
    expect(lerPermissao("binance", {}).veredito).toBe("nao_verificavel");
    expect(lerPermissao("binance", { enableWithdrawals: false }).veredito).toBe("so_negocia");
  });

  it("formato que não sei ler NÃO vira aprovação", () => {
    expect(lerPermissao("binance", { enableWithdrawals: { algo: 1 } }).veredito)
      .toBe("nao_verificavel");
  });

  it("binance: true = pode sacar, false = só negocia", () => {
    expect(lerPermissao("binance", { enableWithdrawals: true }).veredito).toBe("pode_sacar");
    expect(lerPermissao("binance", { enableWithdrawals: false }).veredito).toBe("so_negocia");
  });

  it("bybit: lista de permissões vazia = não saca", () => {
    expect(lerPermissao("bybit", { permissions: { Withdraw: [] } }).veredito).toBe("so_negocia");
    expect(lerPermissao("bybit", { permissions: { Withdraw: ["Withdraw"] } }).veredito)
      .toBe("pode_sacar");
  });

  it("okx e kucoin: a permissão vem como texto", () => {
    expect(lerPermissao("okx", { perm: "read_only,trade" }).veredito).toBe("so_negocia");
    expect(lerPermissao("okx", { perm: "read_only,trade,withdraw" }).veredito).toBe("pode_sacar");
    expect(lerPermissao("kucoin", { permission: "General,Trade" }).veredito).toBe("so_negocia");
    expect(lerPermissao("kucoin", { permission: "General,Trade,Withdraw" }).veredito)
      .toBe("pode_sacar");
  });

  /**
   * ⚠️ Assumir que "sem endpoint = sem saque" seria INVENTAR segurança —
   * exatamente o que este módulo existe para impedir. Seis das dez corretoras
   * caem aqui, e todas saem marcadas.
   */
  it("corretora sem endpoint sai como NÃO VERIFICÁVEL, com o motivo", () => {
    for (const id of ["kraken", "coinbase", "bitfinex", "mexc", "gateio", "htx"] as const) {
      expect(suportaVerificacao(id), id).toBe(false);
      const p = lerPermissao(id, { enableWithdrawals: false });
      expect(p.veredito, id).toBe("nao_verificavel");
      expect(p.suportado).toBe(false);
      expect(p.detalhe).toContain("não expõe");
    }
  });
});

describe("a decisão de armar", () => {
  const p = (v: PermissaoChave["veredito"], detalhe = "x"): PermissaoChave =>
    ({ veredito: v, detalhe, suportado: true });

  /**
   * Guardar credencial no servidor para operar sozinha só é aceitável com a
   * chave PROVADA incapaz de sacar.
   */
  it("chave que pode sacar BLOQUEIA, e diz por quê em termos de dinheiro", () => {
    const d = decidirArmar(p("pode_sacar"));
    expect(d.permitido).toBe(false);
    expect(d.motivo).toContain("PODE SACAR");
    expect(d.motivo).toContain("ao alcance de quem invadir o servidor");
    // E diz o que fazer, não só o que recusou.
    expect(d.motivo).toContain("sem permissão de saque");
  });

  it("chave provada trade-only libera, sem aviso", () => {
    const d = decidirArmar(p("so_negocia"));
    expect(d.permitido).toBe(true);
    expect(d.aviso).toBeNull();
  });

  /**
   * ⚠️ NÃO VERIFICÁVEL não bloqueia — bloquear inviabilizaria seis das dez
   * corretoras — mas TEM que chegar ao usuário. O silêncio aqui seria o mesmo
   * `readOnly: true` fixo, com outra roupa.
   */
  it("não verificável LIBERA com aviso explícito, nunca em silêncio", () => {
    const d = decidirArmar(p("nao_verificavel", "kraken não expõe permissão"));
    expect(d.permitido).toBe(true);
    expect(d.aviso).not.toBeNull();
    expect(d.aviso).toContain("NÃO CONSEGUIMOS VERIFICAR");
    // O motivo da corretora viaja junto — aviso sem causa não é acionável.
    expect(d.aviso).toContain("kraken não expõe permissão");
    // E manda o usuário conferir, em vez de deixar a dúvida no ar.
    expect(d.aviso).toContain("painel da corretora");
  });

  /** As três saídas são distintas — nenhuma colapsa na outra. */
  it("as três saídas se distinguem", () => {
    const saidas = (["so_negocia", "pode_sacar", "nao_verificavel"] as const)
      .map((v) => decidirArmar(p(v)));
    expect(saidas.map((s) => s.permitido)).toEqual([true, false, true]);
    expect(saidas.map((s) => s.aviso === null)).toEqual([true, true, false]);
  });
});

/**
 * ⚠️ A ORDEM É O CONTROLE.
 *
 * Verificar DEPOIS de gravar não é um controle, é uma notificação: a credencial
 * já estaria cifrada no banco quando o aviso aparecesse. Esta trava lê a rota e
 * exige a verificação ANTES do `armSession`.
 */
describe("a rota de armar verifica ANTES de guardar", () => {
  const rota = semComentarios(
    readFileSync("src/app/api/autopilot/session/route.ts", "utf8"),
  );

  it("chama verificarChave antes de armSession", () => {
    const iVerifica = rota.indexOf("await verificarChave(");
    const iArma     = rota.indexOf("await armSession({");
    expect(iVerifica, "verificarChave não foi chamada na rota").toBeGreaterThan(-1);
    expect(iArma, "armSession não foi chamada na rota").toBeGreaterThan(-1);
    expect(iVerifica).toBeLessThan(iArma);
  });

  it("a recusa devolve erro e não segue para o armSession", () => {
    expect(rota).toContain("if (!decisao.permitido)");
    expect(rota).toContain("key_can_withdraw");
    const iRecusa = rota.indexOf("if (!decisao.permitido)");
    expect(iRecusa).toBeLessThan(rota.indexOf("await armSession({"));
  });

  it("o veredito é gravado na sessão, não só devolvido na resposta", () => {
    expect(rota).toContain("keyPermission:       permissao.veredito");
    const sessoes = semComentarios(readFileSync("src/lib/autopilot/sessions.ts", "utf8"));
    expect(sessoes).toContain("key_permission:        input.keyPermission");
  });

  /**
   * ⚠️ O campo `readOnly` era o controle-de-mentira: fixo em `true`, escrito
   * pelo cliente, lido por ninguém. Se voltar, esta trava reprova.
   */
  it("o cliente não voltou a declarar a permissão da própria chave", () => {
    const tipos = semComentarios(readFileSync("src/lib/cex/types.ts", "utf8"));
    expect(tipos).not.toContain("readOnly");
    const settings = semComentarios(
      readFileSync("src/components/settings/CexSettings.tsx", "utf8"),
    );
    expect(settings).not.toContain("readOnly");
  });
});
