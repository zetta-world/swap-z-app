import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️⚠️ A CLASSE DE DEFEITO QUE ESTA TRAVA IMPEDE DE VOLTAR.
 *
 * O cliente do Supabase NÃO LANÇA em erro de banco: ele RESOLVE com
 * `{ data: null, error }`. Uma escrita sem conferência é indistinguível de uma
 * escrita bem-sucedida — e no autopilot cada uma dessas falhas tem consequência
 * própria em DINHEIRO REAL:
 *
 *   · posição não gravada  → o bot nunca mais sai daquele trade (#340)
 *   · saída não marcada    → a passada seguinte vende a mesma bolsa DE NOVO
 *   · posição não reaberta → fica presa apontando para ordem morta
 *   · posição não removida → o teto de exposição conta capital que já saiu
 *   · P&L não contabilizado → o STOP DE PERDA DIÁRIA não vê a perda
 *
 * Já custou US$ 450 a 1.000 em catorze carteiras de papel (`engine.ts:492`).
 */

const STORE = readFileSync(join(process.cwd(), "src/lib/autopilot/positions-server.ts"), "utf8");
const CRON  = readFileSync(join(process.cwd(), "src/app/api/autopilot/cron/route.ts"), "utf8");
/**
 * ⚠️⚠️ ESTE ARQUIVO ENTROU EM 14/09, E A OMISSÃO DELE CUSTOU O ACHADO A11.
 *
 * A trava acima estava certa e completa — para `positions-server.ts`. Só que
 * `disarmSession`, que é o BOTÃO DE PARAR do autopilot, mora em `sessions.ts` e
 * nunca foi olhada: devolvia `Promise<void>`, a rota respondia `{ ok: true }`, e
 * uma escrita recusada deixava o robô negociando com dinheiro real enquanto a
 * tela dizia "desligado".
 *
 * É o padrão nº 8 desta casa outra vez: a peça certa, testada, e apontada para
 * o arquivo errado.
 */
const SESSOES = readFileSync(join(process.cwd(), "src/lib/autopilot/sessions.ts"), "utf8");
const ROTA_SESSAO = readFileSync(join(process.cwd(), "src/app/api/autopilot/session/route.ts"), "utf8");

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");

/** As funções que escrevem estado de posição ou de risco. */
const ESCRITORAS = [
  "markServerExitArmed", "reopenServerPosition",
  "closeServerPosition", "applySessionPnl",
  // ⚠️ FALTAVA, e a revisão adversarial do Round 9 achou: ela escreve estado
  // de posição (a redução da saída parcial) e nunca esteve na trava.
  "reduzirServerPosition",
];

describe("as escritoras devolvem SE gravaram", () => {
  it.each(ESCRITORAS)("%s não devolve void", (fn) => {
    // `Promise<void>` é a assinatura que torna a conferência impossível: quem
    // chama não tem o que checar, e o defeito fica invisível por construção.
    const m = new RegExp(`export async function ${fn}\\([^)]*\\)\\s*:\\s*Promise<([^>]+)>`, "s").exec(STORE);
    expect(m, `${fn} não encontrada — renomeada? atualize esta trava`).not.toBeNull();
    expect(m![1].trim(), `${fn} devolve void — ninguém consegue conferir`).not.toBe("void");
  });
});

describe("o cron CONFERE cada uma delas", () => {
  const codigo = semComentarios(CRON);

  it.each(ESCRITORAS)(
    "toda chamada a %s passa por exigirGravacao", (fn) => {
      /**
       * ⚠️ Conta CHAMADAS, não presença. Bastar que `exigirGravacao` apareça
       * uma vez no arquivo deixaria a segunda chamada da mesma função entrar
       * sem conferência — e foi exatamente assim que estas quatro passaram
       * despercebidas: cada uma tinha um caminho conferido e outro não.
       */
      const chamadas = [...codigo.matchAll(new RegExp(`await ${fn}\\(`, "g"))].length;
      const conferidas = [...codigo.matchAll(new RegExp(`exigirGravacao\\(\\s*await ${fn}\\(`, "g"))].length;
      expect(chamadas, `${fn} não é chamada no cron — atualize esta trava`).toBeGreaterThan(0);
      expect(conferidas, `${chamadas - conferidas} chamada(s) de ${fn} sem exigirGravacao`).toBe(chamadas);
    });

  it("o alerta carrega a CONSEQUÊNCIA, não só o nome da função", () => {
    // "closeServerPosition falhou" não diz a ninguém o que fazer. "o teto de
    // exposição conta capital que não está mais lá" diz.
    expect(codigo).toMatch(/o stop de perda diaria nao viu esta perda/);
    expect(codigo).toMatch(/vende duas vezes a mesma bolsa/);
    expect(codigo).toMatch(/nunca mais sai deste trade/);
    expect(codigo).toMatch(/teto de exposicao conta capital que nao esta mais la/);
  });
});

/**
 * ⚠️⚠️ O BOTÃO DE PARAR — achado A11 da auditoria externa (14/09).
 *
 * `disarmSession` devolvia `Promise<void>`. A rota fazia `await disarmSession(…)`
 * e, na linha seguinte, `{ ok: true }`. Como `supabase-js` RESOLVE com
 * `{ error }` e não lança, um UPDATE recusado era indistinguível de sucesso: a
 * tela dizia "ele para de operar imediatamente", `is_active` continuava `true`,
 * e o cron de 5 minutos seguia colocando ordem na corretora do cliente.
 *
 * ⚠️ E a leitura fechava a armadilha: `getSessionStatus` também engolia o erro
 * e devolvia `null`, que o painel lê como DESARMADO. Numa queda de banco a
 * escrita E a leitura falhavam juntas — a tela mostrava desligado enquanto a
 * linha continuava ativa, e o cron retomava minutos depois.
 */
describe("o botão de PARAR do autopilot não pode mentir", () => {
  it("⚠️⚠️ `disarmSession` não devolve void — conferir tem de ser possível", () => {
    const m = /export async function disarmSession\([\s\S]*?\)\s*:\s*Promise<([^>]+)>/.exec(SESSOES);
    expect(m, "disarmSession não encontrada — renomeada? atualize esta trava").not.toBeNull();
    expect(m![1].trim()).not.toBe("void");
    expect(m![1]).toContain("ok");
  });

  it("⚠️ ela lê o `error` e conta as linhas que casaram", () => {
    const corpo = SESSOES.slice(SESSOES.indexOf("export async function disarmSession"));
    const ate = corpo.slice(0, corpo.indexOf("\n}"));
    expect(ate).toMatch(/const \{ data, error \} = await db/);
    // Sem `.select()`, "gravou" e "não achou o que gravar" voltam idênticos.
    expect(ate).toMatch(/\.select\("id"\)/);
  });

  it("⚠️⚠️ a rota falha FECHADO — 500, não `ok: true`", () => {
    const codigo = semComentarios(ROTA_SESSAO);
    expect(codigo).toMatch(/const r = await disarmSession\(/);
    expect(codigo).toMatch(/if \(!r\.ok\)/);
    expect(codigo).toMatch(/status: 500/);
    // O `await disarmSession(...)` solto seguido de ok:true era o defeito.
    expect(codigo).not.toMatch(/await disarmSession\([^)]*\);\s*\n\s*return NextResponse\.json\(\{ ok: true \}\)/);
  });

  it("⚠️ e o evento carrega a CONSEQUÊNCIA, não só o nome do erro", () => {
    // "disarm_failed" não diz a ninguém o que fazer. "a sessão CONTINUA ativa e
    // o cron vai negociar de novo" diz — e manda revogar a chave na corretora.
    expect(ROTA_SESSAO).toMatch(/a sessão CONTINUA ativa e o cron vai negociar de novo/);
  });

  it("⚠️ falha de LEITURA não vira 'não há sessão' — o painel leria desarmado", () => {
    const corpo = SESSOES.slice(SESSOES.indexOf("export async function getSessionStatus"));
    const ate = corpo.slice(0, corpo.indexOf("\n}"));
    expect(ate).toMatch(/const \{ data, error \} = await db/);
    expect(ate).toMatch(/if \(error\) throw new Error/);
  });
});

/**
 * ⚠️⚠️ O KILL-SWITCH — achado A25 (14/09).
 *
 * Um interruptor que diz "ligado" sem ter gravado é PIOR que não ter
 * interruptor: o operador para de procurar o problema. E era pior que o 200
 * mentiroso — o `logAdminAction` gravava a virada mesmo na falha, então o
 * registro forense mentia junto com a tela.
 */
describe("o kill-switch não pode confirmar o que não gravou", () => {
  const KILL = readFileSync(join(process.cwd(), "src/app/admin/api/killswitch/route.ts"), "utf8");
  const codigo = semComentarios(KILL);

  it("⚠️⚠️ o upsert tem o erro lido, e a rota devolve 500", () => {
    expect(codigo).toMatch(/const \{ error: erroDaEscrita \} = await db\.from\("admin_kv"\)\.upsert/);
    expect(codigo).toMatch(/if \(erroDaEscrita\)/);
    expect(codigo).toMatch(/status: 500/);
  });

  it("⚠️⚠️ a AUDITORIA só é escrita depois da gravação confirmada", () => {
    // O registro forense é o que se consulta quando algo dá errado. Ele mentir
    // junto com a tela é o pior desfecho possível deste defeito.
    const iErro = codigo.indexOf("if (erroDaEscrita)");
    const iAudit = codigo.indexOf("logAdminAction(actor, `killswitch.");
    expect(iErro).toBeGreaterThan(0);
    expect(iAudit).toBeGreaterThan(iErro);
  });

  it("⚠️ e o motivo diz que o interruptor NÃO mudou", () => {
    expect(KILL).toMatch(/o interruptor NÃO foi alterado/);
  });
});

/**
 * ⚠⚠ A NONA `patchSession` — a que ficou para um PR próprio quando o A11
 * entrou, e que agora fecha.
 *
 * As nove chamadas no cron não são iguais. Oito são telemetria
 * (`last_scan_at`, `last_error`): recusa ali envelhece a tela e nada mais. A
 * nona é a VIRADA DO DIA, e ela decide dinheiro.
 *
 * O cron zera `tradesToday` NA MEMÓRIA e calcula
 * `remainingTrades = max_trades_per_day - tradesToday` a partir do valor local.
 * Gravação recusada → `last_reset_day` continua em ontem → a passada seguinte
 * vê "é outro dia" outra vez, zera de novo na memória — e o limite diário que
 * o usuário configurou vira limite POR PASSADA. A cada 5 minutos, até 288
 * cotas diárias num dia.
 */
describe("a virada do dia não pode falhar calada", () => {
  const codigo = semComentarios(CRON);

  it("⚠⚠ `patchSession` devolve SE gravou — `void` tornava a conferência impossível", () => {
    const m = /export async function patchSession\([\s\S]*?\)\s*:\s*Promise<([^>]+)>/.exec(SESSOES);
    expect(m, "patchSession não encontrada — renomeada? atualize esta trava").not.toBeNull();
    expect(m![1].trim()).not.toBe("void");
    expect(m![1]).toContain("ok");
  });

  it("⚠️ e `sem banco` também é falha — ausente não pode ler como gravado", () => {
    const corpo = SESSOES.slice(SESSOES.indexOf("export async function patchSession"));
    const ate = corpo.slice(0, corpo.indexOf("\n}"));
    expect(ate).toMatch(/if \(!db\) return \{ ok: false/);
    expect(ate).toMatch(/const \{ error \} = await db/);
  });

  it("⚠⚠ a virada do dia FALHA FECHADO — sem gravar, a sessão não negocia", () => {
    expect(codigo).toMatch(/const virou = await patchSession\(s\.id, \{ trades_today: 0/);
    expect(codigo).toMatch(/if \(!virou\.ok\)/);
    // O `return` é o que impede a passada de negociar com contador de mentira.
    const i = codigo.indexOf("if (!virou.ok)");
    expect(codigo.slice(i, i + 700)).toMatch(/return \{ origem: undefined, fired: 0/);
  });

  it("⚠️ o evento carrega a CONSEQUÊNCIA, não só o nome do erro", () => {
    expect(CRON).toMatch(/o limite diario viraria limite por passada/);
    expect(codigo).toMatch(/autopilot_virada_do_dia_nao_gravou/);
  });

  it("⚠⚠ e as de telemetria são nomeadas como tal — não esquecidas", () => {
    // Um `await patchSession(...)` solto é indistinguível de retorno esquecido.
    // O helper diz, no nome, que a recusa foi considerada e não interrompe.
    const soltas = [...codigo.matchAll(/await patchSession\(s\.id,/g)].length;
    expect(soltas, "só a virada do dia chama patchSession direto").toBe(1);
    /**
     * ⚠️ E O CARIMBO DE PLANO TEM HELPER PRÓPRIO (achado A111). Ele NÃO é
     * telemetria: é fato de autorização, e a falha dele tem consequência
     * diferente — a sessão revalida de novo e, persistindo, o prazo duro fecha
     * as entradas. Usar `telemetria()` aqui seria mentir sobre o que a escrita é.
     */
    expect(codigo).toMatch(/async function carimbarPlano\(/);
    expect(codigo).toMatch(/autopilot_carimbo_de_plano_nao_gravou/);
    /**
     * ⚠️ A CONTAGEM DEIXOU DE SER FIXA, e a razão importa.
     *
     * Ela dizia OITO. O A130 fundiu dois ramos de recusa — congelada e teto
     * diário — numa decisão só (o helper compartilhado com o navegador), e o
     * número virou sete. A trava quebrou por uma mudança que a MELHORA.
     *
     * O que ela protege nunca foi a contagem: é que NENHUMA escrita de
     * telemetria fique solta, sem o helper que diz, no nome, que a recusa foi
     * considerada. Essa parte continua exata, na asserção de `soltas` acima.
     */
    const porHelper = [...codigo.matchAll(/await telemetria\(s\.id,/g)].length;
    expect(porHelper, "a telemetria do cron passa pelo helper").toBeGreaterThanOrEqual(5);
  });

  it("⚠️ e a telemetria recusada fica REGISTRADA — last_scan_at parado é sintoma de watchdog", () => {
    expect(codigo).toMatch(/autopilot_telemetria_nao_gravou/);
  });
});

/**
 * ⚠️⚠️ O CANAL DO NAVEGADOR — achado A12 (15/09), e o que mudou no A130-B.
 *
 * A rota `record-fire` era o write-back do A1: o navegador disparava a ordem e
 * publicava o disparo aqui, para `bumpSessionTrades` somar ao `trades_today`.
 * O defeito A12 era que o retorno da função — `boolean`, mudado de propósito
 * para isso, com a cicatriz escrita no cabeçalho dela — era DESCARTADO dentro
 * de um `try/catch` que nunca pegou nada (ela RESOLVE com `false`, não lança).
 * Toda falha de banco devolvia `{ ok: true }` e o limite diário parava de
 * contar aquele canal em silêncio, pelo resto do dia.
 *
 * ⚠️⚠️ AGORA A ROTA NÃO CONTA MAIS — o A130-B tirou a contagem do cliente.
 * `/api/cex/order` RESERVA a vaga no momento em que age; manter o write-back
 * somaria a MESMA perna duas vezes (cada disparo do navegador consumia duas
 * vagas de um teto de 5/dia). Estes testes mudaram de invariante junto com o
 * código, e passam a FIXAR o novo: a rota não escreve, e o cliente não a chama.
 *
 * ⚠️ A ausência da chamada é a coisa que precisa de trava. Contar duas vezes
 * não quebra nenhum teste de caminho feliz — some no número, não no fluxo.
 */
describe("o disparo do navegador é contado por quem age, uma vez só", () => {
  const FIRE = readFileSync(join(process.cwd(), "src/app/api/autopilot/session/record-fire/route.ts"), "utf8");
  const codigo = semComentarios(FIRE);
  const PILOTO = semComentarios(
    readFileSync(join(process.cwd(), "src/components/zion/AutopilotPilot.tsx"), "utf8"));
  const ORDEM = semComentarios(
    readFileSync(join(process.cwd(), "src/app/api/cex/order/route.ts"), "utf8"));

  it("⚠️⚠️ a rota NÃO chama mais `bumpSessionTrades` — seria a segunda contagem", () => {
    expect(codigo).not.toMatch(/bumpSessionTrades/);
  });

  it("⚠️⚠️ e ela não devolve `ok: true` para uma contagem que não fez", () => {
    expect(codigo).not.toMatch(/ok: true/);
    expect(codigo).toMatch(/contagem_no_servidor/);
    expect(codigo).toMatch(/status: 409/);
  });

  it("⚠️⚠️ o cliente parou de publicar o próprio disparo", () => {
    expect(PILOTO).not.toMatch(/record-fire/);
  });

  it("⚠️⚠️ e quem conta é quem age: a rota da ordem RESERVA a vaga", () => {
    // ⚠️ A132: a reserva passou a ser a MESMA função que o cron chama.
    expect(ORDEM).toMatch(/reservaDaVagaDiaria\(/);
  });

  it("⚠️ a cicatriz do A12 continua escrita onde ela aconteceu", () => {
    // Sem isto, a próxima pessoa que "reativar o write-back" não tem como
    // saber por que ele saiu — nem que o `try/catch` de antes era teatro.
    expect(FIRE).toMatch(/duas vezes/);
    expect(FIRE).toMatch(/A12/);
  });

  it("⚠️⚠️ e o CRON não conta mais DEPOIS da ordem — A132", () => {
    /**
     * ⚠️ ESTE TESTE MUDOU DE INVARIANTE NO ROUND 9, e o que ele dizia antes
     * fica escrito aqui para a troca ser auditável em vez de silenciosa:
     *
     *     "o cron confere TODAS as chamadas dele, quantas forem" — e conferia,
     *     uma a uma, que nenhuma `bumpSessionTrades` ficasse sem `if (!await`.
     *
     * A conferência estava certa e era insuficiente. O que ela não podia
     * proteger é o que vinha ANTES: `bump_session_trades` é `trades_today + n`,
     * sem conferir teto, e a soma acontece DEPOIS que o dinheiro saiu. Com 4/5,
     * cron e navegador passavam juntos e o dia fechava em 6 (A132).
     *
     * Agora o cron RESERVA a vaga antes do envio, pela mesma primitiva do
     * navegador. A trava passa a ser a AUSÊNCIA: contar depois é o defeito.
     */
    const codigoDoCron = semComentarios(CRON);
    expect(codigoDoCron).not.toMatch(/bumpSessionTrades/);
    expect(codigoDoCron).not.toMatch(/bump_session_trades/);
    expect(codigoDoCron).toMatch(/reservaDaVagaDiaria\(/);
  });

  it("⚠️⚠️ a função de somar sem conferir teto deixou de existir", () => {
    // Mantê-la exportada seria manter uma arma carregada: um caminho que soma
    // sem teto, a uma linha de quem "só precisa contar um trade".
    const SESSOES = semComentarios(
      readFileSync(join(process.cwd(), "src/lib/autopilot/sessions.ts"), "utf8"));
    expect(SESSOES).not.toMatch(/export async function bumpSessionTrades/);
    expect(SESSOES).not.toMatch(/bump_session_trades/);
  });
});
