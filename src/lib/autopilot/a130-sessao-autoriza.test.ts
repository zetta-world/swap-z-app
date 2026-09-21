/**
 * ⚠️⚠️⚠️ A130 + A130-B — A SESSÃO É QUEM AUTORIZA, E O TETO É O DURÁVEL.
 *
 * Cenários §20–§27 do briefing do Round 8.
 *
 * O ataque que originou o achado:
 *
 *     S1 ativa, C1 current      → usuário clica PARAR → S1.is_active = false
 *     C1 continua active/current (certo: serve DCA e recovery histórico)
 *     chega request autopilot=true
 *     a rota lia a sessão SEM filtro, pegava S1.conexao_id, abria o cofre,
 *     e mandava ordem REAL.
 *
 * PARAR = ZERO NOVA EXECUÇÃO. Estes testes existem para que essa frase seja
 * verdade no servidor, não na tela.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  avaliarAutorizacaoDaSessaoParaExecucao, entradaAutorizadaNaSessao, tetoEfetivoDaOrdem,
  type EstadoParaExecucao,
} from "@/lib/autopilot/autorizacao-de-execucao";
import { avaliarDecisaoDeEstrategia } from "@/lib/autopilot/politica";
import { utcDayKey } from "@/lib/autopilot/sessions";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const AGORA = new Date("2026-09-19T12:00:00.000Z");
const HOJE = utcDayKey(AGORA);

const viva = (over: Partial<EstadoParaExecucao> = {}): EstadoParaExecucao => ({
  ativa: true,
  expiraEm: new Date(AGORA.getTime() + 3_600_000).toISOString(),
  congeladaAte: null,
  tradesHoje: 0,
  maxTradesPorDia: 5,
  maxTradeUsd: 100,
  conexaoId: "C1",
  emQuarentena: false,
  contabilidadeIncompleta: false,
  ...over,
});

describe("① A130.1 — sessão PARADA não cria ordem", () => {
  it("⚠️⚠️ is_active=false RECUSA, mesmo com conexão CURRENT", () => {
    // Este é o ataque inteiro: a conexão continuar ativa está CERTO — ela
    // serve DCA e recovery. Ela só não autoriza o piloto.
    const d = avaliarAutorizacaoDaSessaoParaExecucao(viva({ ativa: false }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_inativa");
  });

  it("⚠️ sessão inexistente também RECUSA — linha ausente não é permissão", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(null, AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_inexistente");
  });
});

describe("② A130.2 — sessão válida SEGUE o fluxo", () => {
  it("⚠️ o gêmeo positivo: ativa, no prazo, sem freeze, com vaga e conexão", () => {
    // Sem isto, uma função que recusasse sempre passaria em todo o resto.
    const d = avaliarAutorizacaoDaSessaoParaExecucao(viva(), AGORA);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.conexaoId).toBe("C1");
      expect(d.tetoDaSessaoUsd).toBe(100);
      expect(d.tradesRestantesHoje).toBe(5);
    }
  });
});

describe("③ A130.3 — sessão EXPIRADA não cria ordem", () => {
  it("⚠️⚠️ expires_at no passado RECUSA", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ expiraEm: new Date(AGORA.getTime() - 1).toISOString() }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_expirada");
  });

  it("⚠️⚠️ validade AUSENTE ou ILEGÍVEL também recusa — falha fechada", () => {
    // "Não sei até quando isto vale" nunca pode virar "vale para sempre".
    for (const ruim of [null, "", "ontem", "2026-13-45T99:99:99Z"]) {
      const d = avaliarAutorizacaoDaSessaoParaExecucao(
        viva({ expiraEm: ruim as string | null }), AGORA);
      expect(d.ok, String(ruim)).toBe(false);
      if (!d.ok) expect(d.motivo).toBe("sessao_expirada");
    }
  });

  it("⚠️ expirar exatamente agora já conta como expirada", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ expiraEm: AGORA.toISOString() }), AGORA);
    expect(d.ok).toBe(false);
  });
});

describe("④ A130.4 — sessão CONGELADA não cria ordem", () => {
  it("⚠️⚠️ congelada HOJE recusa", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ congeladaAte: HOJE }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_congelada");
  });

  it("⚠️ congelada em OUTRO dia não bloqueia — o freeze é do dia", () => {
    // Usar a semântica existente do projeto (§12): congelado sse
    // `frozen_until_day === hoje`. Um carimbo de ontem não prende hoje.
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ congeladaAte: "2026-09-18" }), AGORA);
    expect(d.ok).toBe(true);
  });
});

describe("⑤ A130-B.4 — teto diário server-side", () => {
  it("⚠️⚠️ 5 de 5 feitos: a sexta NÃO sai", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ tradesHoje: 5, maxTradesPorDia: 5 }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("limite_diario");
  });

  it("⚠️ 4 de 5: uma request legítima segue", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ tradesHoje: 4, maxTradesPorDia: 5 }), AGORA);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.tradesRestantesHoje).toBe(1);
  });

  it("⚠️ acima do teto (contador corrompido) também recusa", () => {
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ tradesHoje: 9, maxTradesPorDia: 5 }), AGORA);
    expect(d.ok).toBe(false);
  });
});

describe("⑥ §31 — sessão LEGADA sem conexão não cria ordem", () => {
  it("⚠️⚠️ conexao_id null RECUSA — não se infere conexão", () => {
    // Nem por carteira, nem pela CURRENT global: o intent tem de nascer
    // amarrado à MESMA versão do cofre que produziu o efeito externo (A127).
    const d = avaliarAutorizacaoDaSessaoParaExecucao(
      viva({ conexaoId: null }), AGORA);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("conexao_ausente");
  });
});

describe("⑦ A130-B.1/2/3 — o corpo NÃO amplia o teto", () => {
  it("⚠️⚠️ sessão 50, corpo 1000: vale 50", () => {
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 50, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: 1_000,
    })).toBe(50);
  });

  it("⚠️ sessão 100, corpo 50: vale 50 — o cliente PODE ser mais conservador", () => {
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 100, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: 50,
    })).toBe(50);
  });

  it("⚠️⚠️ o teto GLOBAL continua valendo por cima da sessão", () => {
    // Nem a configuração da sessão amplia o teto da plataforma (§26).
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 500_000, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: undefined,
    })).toBe(100_000);
  });

  it("⚠️ corpo inválido é IGNORADO, não vira teto", () => {
    // `0`, negativo, NaN, string, null: nenhum desses pode virar autoridade —
    // nem para ampliar, nem para zerar a ordem por acidente.
    for (const lixo of [0, -1, NaN, "1000", null, undefined, {}]) {
      expect(tetoEfetivoDaOrdem({
        tetoDaSessaoUsd: 100, tetoGlobalUsd: 100_000, pedidoPeloClienteUsd: lixo,
      }), String(lixo)).toBe(100);
    }
  });
});

describe("⑧ a ligação: a rota usa o helper, e ANTES do cofre", () => {
  const ROTA = semComentarios(
    readFileSync("src/app/api/cex/order/route.ts", "utf8"));

  it("⚠️⚠️ a rota chama a autorização da sessão", () => {
    expect(ROTA).toMatch(/avaliarAutorizacaoDaSessaoParaExecucao\(/);
    expect(ROTA).toMatch(/if \(!autorizacao\.ok\)/);
  });

  it("⚠️⚠️ e ela roda ANTES de decifrar a credencial do cofre (§20)", () => {
    // Recusar depois de abrir o cofre seria recusar tarde: numa sessão sem
    // autorização a credencial NEM DEVE ser desencriptada.
    const iAutoriza = ROTA.indexOf("avaliarAutorizacaoDaSessaoParaExecucao(");
    const iCofre = ROTA.indexOf("decifrarConexao(");
    expect(iAutoriza).toBeGreaterThan(-1);
    expect(iCofre).toBeGreaterThan(-1);
    expect(iAutoriza).toBeLessThan(iCofre);
  });

  it("⚠️⚠️ o teto do corpo NÃO é mais autoridade — A130-B", () => {
    // O código antigo era exatamente isto, e não pode voltar:
    //   const cap = typeof body.maxNotionalUsd === "number" && ... ? body.maxNotionalUsd : HARD...
    expect(ROTA).toMatch(/const cap = tetoEfetivoDaOrdem\(\{/);
    expect(ROTA).not.toMatch(/\?\s*body\.maxNotionalUsd\s*\n?\s*:\s*HARD_NOTIONAL_CEILING_USD/);
    expect(ROTA).toMatch(/tetoDaSessaoUsd: autorizacao\.tetoDaSessaoUsd/);
    expect(ROTA).toMatch(/tetoGlobalUsd: HARD_NOTIONAL_CEILING_USD/);
  });

  it("⚠️ a vaga do teto diário é RESERVADA na costura do executor", () => {
    // ⚠️ A132 (Round 9): a reserva e a devolução saíram do fechamento escrito
    // na rota e viraram `reservaDaVagaDiaria` — a MESMA que o cron usa.
    expect(ROTA).toMatch(/reservaDaVagaDiaria\(/);
    const VAGA = semComentarios(readFileSync("src/lib/autopilot/reserva-de-vaga.ts", "utf8"));
    // ⚠️ O CAS continua sendo o de sempre — só mudou de endereço. As duas
    // primitivas são o default injetável, e é isso que roda em produção.
    expect(VAGA).toMatch(/deps\.reservar \?\? reservarTradeDaSessao/);
    expect(VAGA).toMatch(/deps\.liberar\s+\?\? liberarTradeDaSessao/);
  });
});

describe("⑨ §34/§35 — navegador e cron usam a MESMA política", () => {
  const ROTA = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
  const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));

  it("⚠️⚠️ os DOIS canais chamam o helper — não há segunda cópia da regra", () => {
    /**
     * Antes do A130 o cron tinha a política escrita inline e o navegador não
     * tinha nenhuma. Escrever uma segunda cópia na rota teria consertado o
     * buraco e criado o defeito do A113 de novo, com outro nome.
     */
    expect(ROTA).toMatch(/avaliarAutorizacaoDaSessaoParaExecucao\(/);
    expect(CRON).toMatch(/avaliarAutorizacaoDaSessaoParaExecucao\(/);
  });

  it("⚠️⚠️ e o cron não voltou a ter os `if` soltos que o helper substituiu", () => {
    expect(CRON).not.toMatch(/if \(frozenUntil === today\) \{\s*alertIfNewlyFrozen/);
    expect(CRON).not.toMatch(/if \(tradesToday >= s\.max_trades_per_day\) \{/);
  });

  it("⚠️ as notas históricas do cron foram preservadas ao pé da letra", () => {
    // Elas são lidas por painel e por teste; trocá-las seria mudar o
    // observável por causa de uma refatoração.
    expect(CRON).toContain("frozen (daily loss-stop)");
    expect(CRON).toContain("daily trade cap reached");
  });
});

describe("⑩ §17 — a corrida do teto diário, e o que foi feito", () => {
  const SESSOES = readFileSync("src/lib/autopilot/sessions.ts", "utf8");

  it("⚠️⚠️ `bump_session_trades` NÃO confere teto — a corrida é real", () => {
    /**
     * A RPC 0010 é `update ... set trades_today = trades_today + n`. O
     * incremento é atômico; a CONFERÊNCIA não existe. Com 4/5, duas requests
     * simultâneas leem `4 < 5`, as duas passam, e o contador fecha em 6.
     *
     * Este teste FIXA o fato — para que ninguém conclua, lendo o nome da
     * função, que ela protege o teto.
     */
    const RPC = readFileSync("supabase/migrations/0010_bump_session_trades.sql", "utf8");
    expect(RPC).toMatch(/trades_today\s*=\s*trades_today\s*\+\s*p_n/);
    expect(RPC).not.toMatch(/max_trades_per_day/);
  });

  it("⚠️⚠️ por isso a reserva do navegador é COMPARE-AND-SWAP", () => {
    /**
     * Sem migration nova (§50): o `UPDATE` só casa se o contador continuar no
     * valor lido. Em READ COMMITTED, a segunda transação reavalia o WHERE
     * contra a versão já atualizada e grava ZERO linhas — e `.select("id")`
     * torna a diferença visível.
     */
    expect(SESSOES).toMatch(/export async function reservarTradeDaSessao/);
    expect(SESSOES).toMatch(/\.eq\("trades_today", atual\)/);
    expect(SESSOES).toMatch(/\.select\("id"\)/);
    // ⚠️ E o dia entra no WHERE: reservar contra um contador de ontem contaria
    // a vaga no balde errado.
    expect(SESSOES).toMatch(/\.eq\("last_reset_day", hojeUtc\)/);
  });

  it("⚠️ a devolução também é CAS, e só na recusa provada", () => {
    expect(SESSOES).toMatch(/export async function liberarTradeDaSessao/);
    expect(SESSOES).toMatch(/\.eq\("trades_today", valorReservado\)/);
  });

  it("⚠️⚠️ A LIMITAÇÃO DECLARADA NO ROUND 8 FOI FECHADA NO ROUND 9 (A132)", () => {
    /**
     * ⚠️ O texto anterior deste teste dizia, com todas as letras:
     *
     *     "Uma corrida cron↔navegador no mesmo instante continua possível: o
     *      cron incrementa sem conferir teto. Está RELATADA, não corrigida —
     *      fechá-la exigiria RPC nova, e o §50 manda PARAR antes disso."
     *
     * O Round 9 fechou sem RPC nova: o cron passou a usar a MESMA reserva por
     * compare-and-swap que o navegador já usava, na costura `ReservaDeRisco`
     * do executor — antes do envio, e `liberar` só na recusa provada.
     *
     * A trava agora é a convergência: os dois canais chamam a mesma primitiva,
     * e nenhum deles soma depois.
     */
    const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));
    const ROTA_ORDEM = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
    expect(CRON).toMatch(/reservaDaVagaDiaria\(/);
    expect(ROTA_ORDEM).toMatch(/reservaDaVagaDiaria\(/);
    expect(CRON).not.toMatch(/bumpSessionTrades/);
    expect(CRON).toMatch(/tryLockSession\(/);
    const FIRE = readFileSync("src/app/api/autopilot/session/record-fire/route.ts", "utf8");
    expect(semComentarios(FIRE)).not.toMatch(/bumpSessionTrades/);
  });
});

describe("⑪ a QUARENTENA por deriva — achado da revisão adversarial", () => {
  const ROTA = semComentarios(readFileSync("src/app/api/cex/order/route.ts", "utf8"));
  const CRON = semComentarios(readFileSync("src/app/api/autopilot/cron/route.ts", "utf8"));

  it("⚠️⚠️ sessão em quarentena: a ENTRADA é recusada", () => {
    const d = entradaAutorizadaNaSessao({ emQuarentena: true, contabilidadeIncompleta: false });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.motivo).toBe("sessao_em_quarentena");
  });

  it("⚠️ e sem quarentena a entrada passa — o gêmeo positivo", () => {
    expect(entradaAutorizadaNaSessao({ emQuarentena: false, contabilidadeIncompleta: false }).ok).toBe(true);
  });

  it("⚠️⚠️ a quarentena NÃO entra na autorização de sessão — saída não se prende", () => {
    /**
     * Se ela entrasse ali, a mesma decisão que barra a compra barraria a
     * VENDA — e um freio de segurança que tranca o cliente na posição cria o
     * perigo que existe para evitar. O cron diz isso com todas as letras:
     * "SAÍDAS/redução NUNCA são presas".
     */
    const d = avaliarAutorizacaoDaSessaoParaExecucao(viva({ emQuarentena: true }), AGORA);
    expect(d.ok).toBe(true);
  });

  it("⚠️⚠️ os DOIS canais obedecem — era só o cron", () => {
    /**
     * `quarentena_em` é gravada por `reconciliar-conta.ts` e era lida só pelo
     * cron. A `/api/cex/order` não sabia que a coluna existia: mesma sessão,
     * mesma deriva, o cron parado e o navegador comprando. Família do A113.
     */
    expect(ROTA).toMatch(/entradaAutorizadaNaSessao\(/);
    expect(CRON).toMatch(/entradaAutorizadaNaSessao\(/);
    // E o `if` solto que ele substituiu no cron não voltou.
    expect(CRON).not.toMatch(/if \(s\.quarentena_em\) \{/);
  });

  it("⚠️⚠️ e na rota o gate cerca a COMPRA, não a venda", () => {
    const i = ROTA.indexOf("entradaAutorizadaNaSessao(");
    expect(i).toBeGreaterThan(-1);
    // A condição imediatamente acima da chamada é o lado da ordem.
    /**
     * ⚠️ A rota ganhou DOIS gates de entrada (o portão único `avaliarRisco` e
     * a quarentena), os dois dentro do mesmo `if (side === "buy")`. Procurar
     * 200 caracteres atrás do segundo achava o primeiro. O que importa é a
     * propriedade: ambos moram no ramo da COMPRA.
     */
    const iBuy = ROTA.indexOf('if (side === "buy") {');
    expect(iBuy).toBeGreaterThan(-1);
    expect(i).toBeGreaterThan(iBuy);
    expect(ROTA.slice(iBuy, i)).not.toMatch(/side === "sell"/);
  });

  it("⚠️ a recusa vem ANTES do cofre (§20)", () => {
    const iQuarentena = ROTA.indexOf("entradaAutorizadaNaSessao(");
    const iCofre = ROTA.indexOf("decifrarConexao(");
    // ⚠️ AS DUAS PRESENÇAS PRIMEIRO. Sem isto, `-1 < iCofre` faria a ausência
    // do gate PASSAR neste teste — que é exatamente o defeito a trancar.
    expect(iQuarentena).toBeGreaterThan(-1);
    expect(iCofre).toBeGreaterThan(-1);
    expect(iQuarentena).toBeLessThan(iCofre);
  });

  it("⚠️ LIMITAÇÃO DECLARADA: o navegador herda o freio, não a perícia", () => {
    /**
     * O cron reconcilia a conta contra a corretora a cada passada e PODE
     * gravar a quarentena. A rota do navegador só LÊ o que já está gravado —
     * fazer a leitura de saldo no caminho quente da ordem seria outra decisão,
     * com outro custo. Entre gravar e o navegador obedecer há, no pior caso, a
     * janela de uma passada do cron.
     */
    const AUTZ = readFileSync("src/lib/autopilot/autorizacao-de-execucao.ts", "utf8");
    expect(AUTZ).toMatch(/nao e a reconciliacao|NÃO É A RECONCILIAÇÃO/i);
  });
});

describe("⑫ o teto durável ilegível é ZERO, não ausente", () => {
  it("⚠️⚠️ `max_trade_usd` NaN não pode deixar o teto global valendo sozinho", () => {
    // Fora do `Math.min`, o dado corrompido AMPLIARIA a autorização.
    expect(tetoEfetivoDaOrdem({ tetoDaSessaoUsd: Number.NaN, tetoGlobalUsd: 5_000 })).toBe(0);
  });

  it("⚠️ negativo e zero também recusam tudo", () => {
    expect(tetoEfetivoDaOrdem({ tetoDaSessaoUsd: -1, tetoGlobalUsd: 5_000 })).toBe(0);
    expect(tetoEfetivoDaOrdem({ tetoDaSessaoUsd: 0, tetoGlobalUsd: 5_000 })).toBe(0);
  });

  it("⚠️ e o caminho normal continua sendo o MENOR dos três", () => {
    expect(tetoEfetivoDaOrdem({
      tetoDaSessaoUsd: 100, tetoGlobalUsd: 5_000, pedidoPeloClienteUsd: 40,
    })).toBe(40);
  });
});

describe("⑬ o teto por trade ALCANÇA a venda — correção de uma limitação que eu declarei errada", () => {
  /**
   * ⚠️⚠️ EU PUBLIQUEI UMA LIMITAÇÃO MAIS LARGA QUE O CÓDIGO.
   *
   * A entrega anterior dizia "a VENDA não é limitada pelo teto por trade",
   * apoiada só num grep de `price-guard.ts`. Lá a isenção existe mesmo
   * (`side === "buy" && realNotionalUsd > maxTradeUsd`), mas ela é de UM guarda
   * — e não do caminho.
   *
   * `politica.ts` confere `ctx.notionalUsd > ctx.maxTradeUsd` para os DOIS
   * lados, e a rota do navegador chama a política logo depois do price-guard,
   * com o nocional REAL medido. Ou seja: a venda É limitada, por outro portão.
   *
   * O teste abaixo mede isso em vez de descrever — é funcional, não regex.
   */
  const ctx = (over: Record<string, unknown> = {}) => ({
    canal: "browser" as const, side: "sell" as const, symbol: "BTC/USDT", base: "BTC",
    regime: null, notionalUsd: 600, maxTradeUsd: 100,
    allowedSymbols: null, autonomous: true, certificado: null,
    venue: "binance", strategyHash: null, ...over,
  });

  it("⚠️⚠️ VENDA de US$ 600 com teto de sessão de US$ 100: RECUSADA", () => {
    const d = avaliarDecisaoDeEstrategia(ctx());
    expect(d.permite).toBe(false);
    if (!d.permite) expect(d.motivo).toBe("acima_do_teto_da_sessao");
  });

  it("⚠️ o gêmeo: a mesma venda dentro do teto PASSA", () => {
    // ⚠️ `regime: null` de propósito — a saída não depende de regime medido, e
    // isso isola a causa da recusa acima no TETO, não na tendência.
    const d = avaliarDecisaoDeEstrategia(ctx({ notionalUsd: 60 }));
    expect(d.permite).toBe(true);
  });

  it("⚠️ a isenção do price-guard continua existindo — ela é de um guarda, não do caminho", () => {
    const GUARDA = semComentarios(readFileSync("src/lib/autopilot/price-guard.ts", "utf8"));
    expect(GUARDA).toMatch(/side === "buy" && realNotionalUsd > maxTradeUsd/);
    // O teto GLOBAL vale para os dois lados, e isso não mudou.
    expect(GUARDA).toMatch(/realNotionalUsd > AUTOPILOT_HARD_CEILING_USD/);
  });
});
