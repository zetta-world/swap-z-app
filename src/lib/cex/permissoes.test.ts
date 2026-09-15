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
import { join } from "node:path";
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

  /**
   * ⚠️⚠️ ESTES TESTES CODIFICAVAM O DEFEITO (achado A16).
   *
   * Eles alimentavam `{ permissions: {…} }` e `{ perm: "…" }` no TOPO da
   * resposta — formatos que corretora nenhuma envia. Três das quatro envelopam
   * o corpo, então o código lia `undefined` e devolvia `nao_verificavel` para
   * TODA chave, inclusive as que sacam.
   *
   * Teste e código concordavam, e os dois discordavam da realidade. Quebrar a
   * trava nos dois sentidos nunca acharia isto — só comparar com o formato de
   * verdade acha.
   *
   * Os formatos abaixo têm EVIDÊNCIA na fonte do ccxt vendido, não na memória:
   * `bybit.js:1432`, `okx.js:1620`, e as 71 leituras de `data` em `kucoin.js`.
   */
  it("⚠️⚠️ bybit: o corpo vem dentro de `result`", () => {
    const semSaque = { retCode: 0, result: { permissions: { Spot: ["SpotTrade"], Wallet: [] } } };
    const comSaque = { retCode: 0, result: { permissions: { Spot: ["SpotTrade"], Wallet: ["Withdrawal"] } } };
    expect(lerPermissao("bybit", semSaque).veredito).toBe("so_negocia");
    expect(lerPermissao("bybit", comSaque).veredito).toBe("pode_sacar");
  });

  it("⚠️⚠️ bybit: o saque é procurado em TODOS os grupos, não só em `Withdraw`", () => {
    // O ccxt documenta grupos como `Wallet`, `Exchange`, `NFT` e cita os nomes
    // "Account Transfer", "Subaccount Transfer", "Withdrawal" (bybit.js:9772).
    // Procurar só `permissions.Withdraw` erra quando a Bybit guarda o saque em
    // outro grupo — e errar aqui é deixar passar chave que saca.
    const emOutroGrupo = { retCode: 0, result: { permissions: { Exchange: ["Withdrawal"] } } };
    expect(lerPermissao("bybit", emOutroGrupo).veredito).toBe("pode_sacar");
  });

  it("⚠️ bybit: o formato ANTIGO (topo) agora lê como não verificável", () => {
    // É o que a versão anterior aceitava — e que a corretora nunca manda.
    expect(lerPermissao("bybit", { permissions: { Withdraw: ["Withdraw"] } }).veredito)
      .toBe("nao_verificavel");
  });

  it("⚠️⚠️ okx: o corpo vem dentro de `data[0]`", () => {
    const semSaque = { code: "0", data: [{ perm: "read_only,trade" }] };
    const comSaque = { code: "0", data: [{ perm: "read_only,withdraw,trade" }] };
    expect(lerPermissao("okx", semSaque).veredito).toBe("so_negocia");
    expect(lerPermissao("okx", comSaque).veredito).toBe("pode_sacar");
    expect(lerPermissao("okx", { perm: "read_only,withdraw" }).veredito).toBe("nao_verificavel");
  });

  it("⚠️⚠️ kucoin: o corpo vem dentro de `data`", () => {
    const semSaque = { code: "200000", data: { permission: "General,Trade" } };
    const comSaque = { code: "200000", data: { permission: "General,Trade,Withdraw" } };
    expect(lerPermissao("kucoin", semSaque).veredito).toBe("so_negocia");
    expect(lerPermissao("kucoin", comSaque).veredito).toBe("pode_sacar");
    expect(lerPermissao("kucoin", { permission: "General,Withdraw" }).veredito).toBe("nao_verificavel");
  });

  it("⚠️ envelope presente mas corpo ausente não vira 'não saca'", () => {
    expect(lerPermissao("bybit", { retCode: 0 }).veredito).toBe("nao_verificavel");
    expect(lerPermissao("okx", { code: "0", data: [] }).veredito).toBe("nao_verificavel");
    expect(lerPermissao("kucoin", { code: "200000" }).veredito).toBe("nao_verificavel");
  });

  it("⚠️ binance NÃO foi mexida — não achei evidência do formato dela no ccxt", () => {
    // `sapi/v1/account/apiRestrictions` devolve o objeto direto. Não mexo no
    // que não verifiquei.
    expect(lerPermissao("binance", { enableWithdrawals: true }).veredito).toBe("pode_sacar");
    expect(lerPermissao("binance", { enableWithdrawals: false }).veredito).toBe("so_negocia");
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

/**
 * ⚠️⚠️ O DESEMBRULHO É UM SÓ — achado do revisor no #439, sobre a MINHA
 * correção.
 *
 * `verificarChave` tinha um pré-desembrulho `bruta.data?.[0] ?? bruta`, com o
 * comentário "OKX e Bybit embrulham em `data: [...]`". O comentário estava
 * errado sobre a Bybit (ela usa `result`), então só a OKX era desembrulhada —
 * e ela FUNCIONAVA por causa disso.
 *
 * Eu não tinha lido essa linha. Conclui "3 das 4 quebradas" olhando só
 * `lerPermissao`: eram DUAS (bybit e kucoin), e o meu envelope passou a
 * desembrulhar a OKX duas vezes, quebrando o que estava certo.
 */
describe("⑥ a resposta chega CRUA em `lerPermissao`", () => {
  const SRC = readFileSync(join(process.cwd(), "src/lib/cex/permissoes.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("⚠️⚠️ `verificarChave` não pré-desembrulha nada", () => {
    expect(SRC).toMatch(/return lerPermissao\(id, bruta\)/);
    expect(SRC, "o pré-desembrulho voltou").not.toMatch(/\.data\?\.\[0\] \?\? bruta/);
  });

  it("⚠️⚠️ e existe UM único lugar que conhece envelope", () => {
    // Dois desembrulhos em lugares diferentes é a porta dos fundos de sempre:
    // cada um certo sozinho, e errados juntos.
    expect([...SRC.matchAll(/env\.data/g)].length, "só o de `lerPermissao`").toBeGreaterThan(0);
    expect([...SRC.matchAll(/bruta\.data/g)]).toHaveLength(0);
  });
});
