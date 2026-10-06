import { describe, expect, it } from "vitest";
import { CONFIG_APROVADA, validarConfig, type TierVenda } from "./config";
import { EstoqueDaVenda } from "./estoque";
import { configDeEnsaio, T0 } from "./cenario-local";

const H = 3_600_000;
const D = 24 * H;
const novoEstoque = () => new EstoqueDaVenda(CONFIG_APROVADA, () => T0, 60_000);

async function reservar(
  estoque: EstoqueDaVenda,
  tier: TierVenda,
  carteira: string,
  fase: "allowlist" | "publica",
  unidades: number,
  chave: string,
) {
  return estoque.reservar({ tier, carteira, fase, unidades, chave, vendaAberta: true, elegivel: true, concedido: fase === "allowlist" ? 1 : undefined });
}

describe("Founders sale — regras finais do evento", () => {
  it("configura 48h, 1/1/1 na allowlist, teto cumulativo 2/2/1 e 14 dias no evento inteiro", () => {
    expect(CONFIG_APROVADA.tetos).toEqual({
      allowlist: { PRO: 1, TRADER: 1, PILOT: 1 },
      publica: { PRO: 2, TRADER: 2, PILOT: 1 },
    });
    expect(CONFIG_APROVADA.duracaoAllowlistMs).toBe(48 * H);
    expect(CONFIG_APROVADA.duracaoMaximaVendaMs).toBe(14 * D);
    expect("pilotSomenteAllowlist" in CONFIG_APROVADA).toBe(false);

    const cfg = configDeEnsaio();
    expect(cfg.horarios.publicaAbre! - cfg.horarios.allowlistAbre!).toBe(48 * H);
    expect(cfg.horarios.vendaFecha! - cfg.horarios.allowlistAbre!).toBeLessThanOrEqual(14 * D);
    expect(validarConfig({ ...cfg, horarios: { ...cfg.horarios, vendaFecha: cfg.horarios.allowlistAbre! + 14 * D + 1 } })).toContain("janela_total_excede_a_aprovada");
  });

  it.each(["PRO", "TRADER", "PILOT"] as const)("allowlist %s permite 1 e recusa a segunda unidade", async (tier) => {
    const estoque = novoEstoque();
    const carteira = `wallet-${tier}`;
    const primeira = await reservar(estoque, tier, carteira, "allowlist", 1, `${tier}-1`);
    expect(primeira.ok).toBe(true);
    if (!primeira.ok) return;
    expect(await estoque.confirmar(tier, primeira.reserva.id)).toEqual({ ok: true });
    expect(await reservar(estoque, tier, carteira, "allowlist", 1, `${tier}-2`)).toEqual({ ok: false, erro: "teto_da_carteira" });
    expect(await reservar(novoEstoque(), tier, `${carteira}-bulk`, "allowlist", 2, `${tier}-bulk`)).toEqual({ ok: false, erro: "teto_da_carteira" });
  });

  it("compras da allowlist contam na pública: +1 Pro, +1 Trader e +0 Pilot", async () => {
    for (const tier of ["PRO", "TRADER", "PILOT"] as const) {
      const estoque = novoEstoque();
      const carteira = `cumulativa-${tier}`;
      const al = await reservar(estoque, tier, carteira, "allowlist", 1, `${tier}-al`);
      expect(al.ok).toBe(true);
      if (!al.ok) continue;
      expect(await estoque.confirmar(tier, al.reserva.id)).toEqual({ ok: true });
      const publica = await reservar(estoque, tier, carteira, "publica", 1, `${tier}-pub`);
      if (tier === "PILOT") {
        expect(publica).toEqual({ ok: false, erro: "teto_da_carteira" });
      } else {
        expect(publica.ok).toBe(true);
        if (!publica.ok) continue;
        expect(await estoque.confirmar(tier, publica.reserva.id)).toEqual({ ok: true });
        expect(await reservar(estoque, tier, carteira, "publica", 1, `${tier}-pub-2`)).toEqual({ ok: false, erro: "teto_da_carteira" });
      }
    }
  });

  it("wallet só da pública pode atingir 2 Pro, 2 Trader e 1 Pilot", async () => {
    for (const [tier, total] of [["PRO", 2], ["TRADER", 2], ["PILOT", 1]] as const) {
      const estoque = novoEstoque();
      const r = await reservar(estoque, tier, `public-only-${tier}`, "publica", total, `${tier}-public-only`);
      expect(r.ok, tier).toBe(true);
      expect(await reservar(estoque, tier, `public-only-${tier}`, "publica", 1, `${tier}-public-over`)).toEqual({ ok: false, erro: "teto_da_carteira" });
    }
  });

  it("Pilot não vendido na allowlist continua disponível na public sale", async () => {
    const estoque = novoEstoque();
    const antes = estoque.resumo().porTier.PILOT;
    expect(antes).toMatchObject({ paid_supply: 100, minted: 0, available: 100 });
    const r = await reservar(estoque, "PILOT", "pilot-public-wallet", "publica", 1, "pilot-public");
    expect(r.ok).toBe(true);
    expect(estoque.resumo().porTier.PILOT.available).toBe(99);
  });
});
