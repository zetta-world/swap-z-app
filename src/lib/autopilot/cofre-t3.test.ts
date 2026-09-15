import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ⚠️⚠️ O T3 DO COFRE — achado A115. Este arquivo se chamava `cofre-t2` e
 * travava o comportamento da TRANSIÇÃO; agora trava o de CHEGADA.
 *
 * O que ele afirmava antes:
 *
 *     it("elo apontando para linha que sumiu: cai na sessão")
 *
 * Era verdade do T2 e é exatamente o defeito que o A115 nomeia. `lerConexaoPorId`
 * devolvia `null` para "não existe", para "o banco recusou a leitura" e para
 * "não há banco" — e os três caíam no segredo LEGADO de `autopilot_sessions`.
 * A propriedade que o cofre existe para dar — *uma cópia do segredo, um lugar
 * para revogar* — deixava de valer justamente quando o banco estava ruim.
 *
 * ⚠️ AGORA, COM `conexao_id`, NÃO EXISTE OUTRO CAMINHO. Revogada, inexistente,
 * ilegível: as três BLOQUEIAM. O ramo legado sobrevive só para sessão SEM elo
 * — as armadas antes do cofre existir — e ele é explícito e medido.
 *
 * ⚠️ A MUDANÇA É DELIBERADA, e por isso o teste foi REESCRITO em vez de
 * afrouxado: o caso "cai na sessão" virou "bloqueia", com o mesmo cuidado de
 * antes em não deixar o autopilot morrer na virada.
 */

const lerConexaoPorId = vi.fn();
const decifrarConexao = vi.fn();
const decryptJson     = vi.fn();

vi.mock("@/lib/cex/conexoes", () => ({
  lerConexaoPorId: (...a: unknown[]) => lerConexaoPorId(...a),
  decifrarConexao: (...a: unknown[]) => decifrarConexao(...a),
  guardarConexao:  vi.fn(),
}));
vi.mock("@/lib/crypto/secretbox", () => ({
  encryptJson: vi.fn(),
  decryptJson: (...a: unknown[]) => decryptJson(...a),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => null }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn(async () => undefined) }));

const linha = (conexaoId: string | null) => ({
  id: "s1", conexao_id: conexaoId, creds_cipher: "cipher-da-sessao",
} as never);

describe("credenciaisDaSessao — de onde a chave vem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decryptJson.mockReturnValue({ apiKey: "K-SESSAO", apiSecret: "S", passphrase: null });
    decifrarConexao.mockReturnValue({ apiKey: "K-COFRE", apiSecret: "S" });
  });

  it("com elo e conexão ativa: lê do COFRE", async () => {
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue({ id: "c1", is_active: true, creds_cipher: "x" });
    const r = await credenciaisDaSessao(linha("c1"));
    expect(r.origem).toBe("cofre");
    expect(r.creds.apiKey).toBe("K-COFRE");
  });

  it("sem elo: CAI na sessão, e diz que caiu", async () => {
    // ⚠️ É a queda que mantém o autopilot vivo durante a virada. Sem ela, toda
    // sessão criada antes do T1 pararia de operar no deploy.
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    const r = await credenciaisDaSessao(linha(null));
    expect(r.origem).toBe("sessao");
    expect(r.creds.apiKey).toBe("K-SESSAO");
    expect(lerConexaoPorId).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ elo apontando para linha que SUMIU: BLOQUEIA (era: caía na sessão)", async () => {
    // Vínculo quebrado não é licença para procurar o segredo em outro lugar.
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue(null);
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/inexistente/);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ leitura do cofre que NÃO RESPONDEU: BLOQUEIA", async () => {
    /**
     * O caso mais perigoso dos três, e o que estava aberto: uma queda de banco
     * fazia a sessão operar com a cópia antiga do segredo — inclusive uma que o
     * dono já tivesse revogado, porque a revogação mora no cofre.
     */
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue(undefined);
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/nao deu para ler/);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("⚠️ cofre ILEGÍVEL (adulteração / chave de cifra ausente): BLOQUEIA", async () => {
    // `decifrarConexao` lança de propósito. Capturar aqui para tentar o segredo
    // antigo seria reabrir o fallback pela porta do erro.
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue({ id: "c1", is_active: true, creds_cipher: "x" });
    decifrarConexao.mockImplementation(() => { throw new Error("secretbox: adulterado"); });
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/adulterado/);
    expect(decryptJson).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ conexão REVOGADA lança — NÃO cai para a cópia antiga", async () => {
    /**
     * O caso que importa mais. Se revogar no cofre e a leitura caísse no
     * `creds_cipher`, revogar não revogaria NADA — e o ponto inteiro do cofre é
     * ter um lugar só para desligar. Falha fechado.
     */
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue({ id: "c1", is_active: false, creds_cipher: "x" });
    await expect(credenciaisDaSessao(linha("c1"))).rejects.toThrow(/revogada/);
    expect(decryptJson).not.toHaveBeenCalled();
  });
});
