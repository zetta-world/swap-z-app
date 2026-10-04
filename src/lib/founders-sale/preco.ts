import { sha256Hex, canonico } from "./evidencia";
import { TIERS, type ConfigVenda, type TierVenda } from "./config";

/**
 * MOTOR DE PREÇO — âncora em USD, pagamento em SOL, SNAPSHOT-E-CONGELA por fase (OD-NFT-02, 04/10/2026).
 *
 *   · a referência SOL/USD vem de um `ProvedorReferencia` ABSTRATO. A fonte real NÃO está decidida
 *     (`fonteReferencia` = PENDING_OWNER) e NENHUM oráculo de produção existe aqui — só o provedor fixo local;
 *   · antes de cada fase: `congelarFase` fotografa UMA referência e deriva o preço em lamports de cada tier;
 *     o resultado é imutável (deep-freeze) e tem fingerprint. Recongelar a mesma fase é recusado;
 *   · durante a fase o comprador vê sempre o mesmo número: mudanças da referência depois do congelamento
 *     NÃO alteram o preço;
 *   · arredondamento PARA CIMA em lamports (1 SOL = 10^9): o pagamento nunca fica abaixo da âncora em USD;
 *   · aritmética inteira (BigInt): USD em centavos, referência em micro-USD — sem erro de ponto flutuante;
 *   · referência ausente, inválida (≤ 0, NaN, infinita) ou velha → não congela (falha fechada).
 */
export const LAMPORTS_POR_SOL = 1_000_000_000n;

export interface Referencia { solUsd: number; em: number; fonte: string }
export interface ProvedorReferencia { readonly nome: string; obter(): Promise<Referencia> }

/** Provedor determinístico LOCAL (teste/ensaio). Não é oráculo; o nome deixa isso explícito. */
export class ProvedorReferenciaFixo implements ProvedorReferencia {
  readonly nome = "fixo-local-sem-oraculo";
  private falhar = false;
  constructor(private solUsd: number, private readonly relogio: () => number) {}
  definir(solUsd: number) { this.solUsd = solUsd; }
  derrubar(sim: boolean) { this.falhar = sim; }
  async obter(): Promise<Referencia> {
    if (this.falhar) throw new Error("provedor_indisponivel");
    return { solUsd: this.solUsd, em: this.relogio(), fonte: this.nome };
  }
}

export type FasePreco = "allowlist" | "publica";

export interface PrecoCongelado {
  fase: FasePreco;
  tiers: Readonly<Record<TierVenda, { usdCentavos: number; lamports: string }>>;
  referencia: Readonly<{ solUsdMicro: string; em: number; fonte: string }>;
  statusPreco: ConfigVenda["statusPreco"];
  congeladoEm: number;
  fingerprint: string;
}

export type ErroPreco =
  | "tier_invalido" | "referencia_ausente" | "referencia_invalida" | "referencia_velha"
  | "fase_ja_congelada" | "fase_nao_congelada" | "preco_adulterado" | "provedor_indisponivel";

/** lamports = ceil(centavos × 10^4 × 10^9 / microUsd). */
export function lamportsPara(usdCentavos: bigint, solUsdMicro: bigint): bigint {
  if (solUsdMicro <= 0n) throw new Error("referencia_invalida");
  const num = usdCentavos * 10_000n * LAMPORTS_POR_SOL;
  return (num + solUsdMicro - 1n) / solUsdMicro;
}

export const formatarSol = (lamports: string | bigint): string => {
  const l = BigInt(lamports);
  const int = l / LAMPORTS_POR_SOL, frac = (l % LAMPORTS_POR_SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${int}.${frac}` : `${int}`;
};

function profundoCongelado<T>(o: T): T {
  if (o && typeof o === "object") { for (const v of Object.values(o)) profundoCongelado(v); Object.freeze(o); }
  return o;
}

export function cotar(cfg: ConfigVenda, fase: FasePreco, ref: Referencia | null, agora: number, maxIdadeMs: number):
  { ok: true; preco: PrecoCongelado } | { ok: false; erro: ErroPreco } {
  if (!ref) return { ok: false, erro: "referencia_ausente" };
  if (typeof ref.solUsd !== "number" || !Number.isFinite(ref.solUsd) || ref.solUsd <= 0) return { ok: false, erro: "referencia_invalida" };
  if (!Number.isFinite(ref.em) || ref.em > agora || agora - ref.em > maxIdadeMs) return { ok: false, erro: "referencia_velha" };
  const micro = BigInt(Math.round(ref.solUsd * 1_000_000));
  if (micro <= 0n) return { ok: false, erro: "referencia_invalida" };
  const tiers = {} as Record<TierVenda, { usdCentavos: number; lamports: string }>;
  for (const t of TIERS) {
    const usdCentavos = Math.round(cfg.precoUsd[t] * 100);
    tiers[t] = { usdCentavos, lamports: lamportsPara(BigInt(usdCentavos), micro).toString() };
  }
  const base = { fase, tiers, referencia: { solUsdMicro: micro.toString(), em: ref.em, fonte: ref.fonte }, statusPreco: cfg.statusPreco, congeladoEm: agora };
  const fingerprint = sha256Hex("founders-preco-v1\0" + canonico(base));
  return { ok: true, preco: profundoCongelado({ ...base, fingerprint }) };
}

/** Guarda os preços congelados por fase. Um congelamento por fase; nada muda depois. */
export class PrecosDaVenda {
  private congelados = new Map<FasePreco, PrecoCongelado>();
  constructor(private readonly cfg: ConfigVenda, private readonly provedor: ProvedorReferencia,
              private readonly agora: () => number, private readonly maxIdadeMs = 5 * 60_000) {}

  async congelarFase(fase: FasePreco): Promise<{ ok: true; preco: PrecoCongelado } | { ok: false; erro: ErroPreco }> {
    if (this.congelados.has(fase)) return { ok: false, erro: "fase_ja_congelada" };
    let ref: Referencia | null;
    try { ref = await this.provedor.obter(); }
    catch { return { ok: false, erro: "provedor_indisponivel" }; }
    const r = cotar(this.cfg, fase, ref, this.agora(), this.maxIdadeMs);
    if (r.ok) this.congelados.set(fase, r.preco);
    return r;
  }

  precoDaFase(fase: FasePreco): PrecoCongelado | null { return this.congelados.get(fase) ?? null; }

  /** Confere o valor que chegou do cliente contra o congelado. Qualquer diferença = adulteração. */
  conferir(fase: FasePreco, tier: string, lamportsInformados: string, fingerprintInformado: string):
    { ok: true; lamports: string } | { ok: false; erro: ErroPreco } {
    const p = this.congelados.get(fase);
    if (!p) return { ok: false, erro: "fase_nao_congelada" };
    if (!(TIERS as readonly string[]).includes(tier)) return { ok: false, erro: "tier_invalido" };
    const esperado = p.tiers[tier as TierVenda].lamports;
    if (lamportsInformados !== esperado || fingerprintInformado !== p.fingerprint) return { ok: false, erro: "preco_adulterado" };
    return { ok: true, lamports: esperado };
  }
}
