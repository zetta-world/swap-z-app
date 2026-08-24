import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ⚠️ A LEITURA DUPLA DO T2 (docs/PLANO-DCA-AUTOMATICO.md §2).
 *
 * Esta é a janela mais perigosa da virada: o autopilot lê de DOIS lugares e
 * qualquer engano manda dinheiro real com a credencial errada — ou com uma que
 * o dono já revogou.
 *
 * Os três casos abaixo são o que autoriza (ou barra) o T3.
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

  it("elo apontando para linha que sumiu: cai na sessão", async () => {
    const { credenciaisDaSessao } = await import("@/lib/autopilot/sessions");
    lerConexaoPorId.mockResolvedValue(null);
    const r = await credenciaisDaSessao(linha("c1"));
    expect(r.origem).toBe("sessao");
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
