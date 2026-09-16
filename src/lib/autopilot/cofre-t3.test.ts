import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️⚠️⚠️ T3 DO COFRE, CONCLUÍDO — achado A115 (Round 2).
 *
 * Este arquivo já travou o T2 (escrita/leitura duplas com fallback) e depois
 * o meio da virada (fallback fechado para sessão COM elo). Agora trava o
 * FIM: a segunda cópia do segredo NÃO EXISTE — nem na escrita, nem na
 * leitura, nem na tabela (migration 0056, produção medida com 0 sessões).
 *
 * As propriedades:
 *
 *   T3.1  sessão nova grava a credencial APENAS via cofre (`guardarConexao`);
 *         o upsert da sessão não carrega segredo — só o elo `conexao_id`.
 *   T3.2  cofre falhou → `armSession` FALHA e NENHUMA sessão é armada.
 *   T3.3  elo + conexão ativa → credencial vem do cofre.
 *   T3.4  conexão revogada → BLOQUEIA.
 *   T3.5  cofre não respondeu → BLOQUEIA.
 *   T3.6  elo apontando para linha que sumiu → BLOQUEIA.
 *   T3.7  sessão sem `conexao_id` → ERRO EXPLÍCITO, zero credencial.
 *   guard grep: nenhuma referência viva a `creds_cipher`/`decryptSessionCreds`
 *         fora do próprio cofre (`conexoes.ts`, coluna de `cex_conexoes`).
 */

const lerConexaoPorId = vi.fn();
const decifrarConexao = vi.fn();
const guardarConexao  = vi.fn();
const decryptJson     = vi.fn();
const recordEvent     = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("@/lib/cex/conexoes", () => ({
  lerConexaoPorId: (...a: unknown[]) => lerConexaoPorId(...a),
  decifrarConexao: (...a: unknown[]) => decifrarConexao(...a),
  guardarConexao:  (...a: unknown[]) => guardarConexao(...a),
}));
vi.mock("@/lib/crypto/secretbox", () => ({
  encryptJson: vi.fn(),
  decryptJson: (...a: unknown[]) => decryptJson(...a),
}));
vi.mock("@/lib/admin/track", () => ({ recordEvent: (a: unknown, b: unknown) => recordEvent(a, b) }));

/** Banco falso mínimo para `armSession`: captura o payload do upsert. */
function bancoDaSessao() {
  const upserts: Array<{ payload: Record<string, unknown>; opts: unknown }> = [];
  const db = {
    from: (_t: string) => ({
      upsert: (payload: Record<string, unknown>, opts: unknown) => {
        upserts.push({ payload, opts });
        return {
          select: () => ({ single: async () => ({ data: { id: "s1" }, error: null }) }),
        };
      },
    }),
  };
  return { db, upserts };
}
let dbAtual: ReturnType<typeof bancoDaSessao> | null = null;
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => dbAtual?.db ?? null }));

const INPUT = {
  walletAddress: "0xDONO", exchangeId: "binance", riskMode: "moderado" as const,
  marketType: "spot" as const, maxTradeUsd: 50, dailyLossStopUsd: 20,
  maxTradesPerDay: 5, allowedSymbols: ["BTC/USDT"], lang: "pt",
  credentials: { apiKey: "CHAVE-SECRETA-K", apiSecret: "SEGREDO-S" },
  ttlHours: 24, keyPermission: "so_negocia" as const, keyPermissionDetail: "ok",
};

const linha = (conexaoId: string | null) => ({ id: "s1", conexao_id: conexaoId } as never);

describe("armSession — a escrita (T3.1, T3.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbAtual = bancoDaSessao();
  });

  it("T3.1 ⚠️⚠️ sessão nova NÃO grava segunda cópia: segredo só via cofre, sessão guarda o elo", async () => {
    const { armSession } = await import("@/lib/autopilot/sessions");
    guardarConexao.mockResolvedValue({ ok: true, id: "cx-1" });
    const id = await armSession(INPUT);
    expect(id).toBe("s1");
    // A credencial foi entregue ao COFRE, uma vez:
    expect(guardarConexao).toHaveBeenCalledTimes(1);
    expect(guardarConexao).toHaveBeenCalledWith(expect.objectContaining({
      walletAddress: "0xDONO", exchangeId: "binance",
      credentials: { apiKey: "CHAVE-SECRETA-K", apiSecret: "SEGREDO-S" },
    }));
    // E o upsert da sessão NÃO carrega segredo nenhum — só o elo:
    const { payload } = dbAtual!.upserts[0];
    expect(payload.conexao_id).toBe("cx-1");
    expect(payload).not.toHaveProperty("creds_cipher");
    for (const v of Object.values(payload)) {
      expect(JSON.stringify(v)).not.toContain("K");   // a apiKey não vaza para a sessão
    }
  });

  it("T3.2 ⚠️⚠️⚠️ cofre falhou → armSession FALHA e NENHUMA sessão é armada", async () => {
    /**
     * O fim do "degrada e arma com segredo local": não existe mais local. Uma
     * sessão sem elo no cofre é uma sessão cuja revogação não revoga nada —
     * ela não pode nascer.
     */
    const { armSession } = await import("@/lib/autopilot/sessions");
    guardarConexao.mockResolvedValue({ ok: false, erro: "banco fora" });
    await expect(armSession(INPUT)).rejects.toThrow(/cofre nao gravou/);
    expect(dbAtual!.upserts).toHaveLength(0);        // zero sessão armada
    expect(recordEvent).toHaveBeenCalledWith("cofre_nao_gravou", expect.anything());
  });
});

describe("credenciaisDaSessao — a leitura (T3.3 a T3.7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbAtual = null;
    decifrarConexao.mockReturnValue({ apiKey: "K-COFRE", apiSecret: "S" });
  });

  it("T3.3 com elo e conexão ativa: lê do COFRE", async () => {
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue({ id: "c1", is_active: true });
    const r = await credenciaisDaSessao(linha("c1"));
    expect(r.origem).toBe("cofre");
    expect(r.creds.apiKey).toBe("K-COFRE");
  });

  it("T3.4 ⚠️⚠️ conexão REVOGADA lança — revogar tem de revogar de verdade", async () => {
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue({ id: "c1", is_active: false });
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/revogada/);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("T3.5 ⚠️⚠️ cofre NÃO RESPONDEU: BLOQUEIA", async () => {
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue(undefined);
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/nao deu para ler/);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("T3.6 ⚠️⚠️ elo apontando para linha que SUMIU: BLOQUEIA", async () => {
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue(null);
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/inexistente/);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("T3.7 ⚠️⚠️⚠️ sessão SEM conexao_id: ERRO EXPLÍCITO, zero credencial, sem fallback", async () => {
    /**
     * O caso que o T2 resolvia em silêncio (lendo `creds_cipher`). Com a
     * coluna removida, qualquer `conexao_id` nulo é contradição — e
     * contradição é erro alto, nunca segredo vindo de outro lugar.
     */
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    await expect(credenciaisDaSessao(linha(null))).rejects.toThrow(/sem elo com o cofre/);
    expect(lerConexaoPorId).not.toHaveBeenCalled();
    expect(decryptJson).not.toHaveBeenCalled();
    expect(decifrarConexao).not.toHaveBeenCalled();
  });
});

describe("guarda estrutural — o caminho legado não volta pelo fundo", () => {
  /**
   * ⚠️ COMENTÁRIOS NÃO SÃO REFERÊNCIA VIVA. As cicatrizes (cabeçalhos que
   * contam por que `creds_cipher` morreu) ficam; o que a guarda caça é
   * CÓDIGO. Por isso o scan roda sobre a fonte sem comentários — o mesmo
   * critério de `capacidade.test.ts`.
   */
  const semComentarios = (c: string) =>
    c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const SESSOES = semComentarios(readFileSync("src/lib/autopilot/sessions.ts", "utf8"));

  it("⚠️⚠️ sessions.ts não conhece mais `creds_cipher` nem `decryptSessionCreds`", () => {
    expect(SESSOES).not.toMatch(/creds_cipher/);
    expect(SESSOES).not.toMatch(/decryptSessionCreds/);
    expect(SESSOES).not.toMatch(/decryptJson/);
  });

  it("⚠️⚠️ grep guard: `creds_cipher` só vive no cofre (`cex_conexoes`) e nas migrations históricas", () => {
    /**
     * A coluna de `cex_conexoes` (0031) É o cofre — ela fica. A de
     * `autopilot_sessions` (0004, removida na 0056) não pode ter referência
     * viva em src/. Permitido: conexoes.ts (a tabela do cofre) e testes que
     * documentam a remoção (este arquivo).
     */
    const permitidos = new Set([
      "src/lib/cex/conexoes.ts",
      "src/lib/autopilot/cofre-t3.test.ts",
      // A guarda-irmã do A115 em `capacidade.test.ts` cita o identificador
      // morto nas próprias asserções — não é referência viva.
      "src/lib/dca/capacidade.test.ts",
    ]);
    const vivos: string[] = [];
    const andar = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { andar(p); continue; }
        if (!/\.(ts|tsx)$/.test(f) || permitidos.has(p)) continue;
        if (/creds_cipher|decryptSessionCreds/.test(
          semComentarios(readFileSync(p, "utf8")))) vivos.push(p);
      }
    };
    andar("src");
    expect(vivos, "referência viva a creds_cipher fora do cofre").toEqual([]);
  });

  it("⚠️ a migration 0056 remove a coluna de verdade", () => {
    const sql = readFileSync("supabase/migrations/0056_cofre_t3_final.sql", "utf8");
    expect(sql).toMatch(
      /alter\s+table\s+public\.autopilot_sessions\s+drop\s+column\s+creds_cipher/i);
  });
});
