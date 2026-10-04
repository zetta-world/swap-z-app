import { createHash } from "node:crypto";
import { construir, prova, verificar, type Hash, type CodificarFolha } from "./merkle";
import { sha256Hex, canonico } from "./evidencia";
import { TIERS, type ConfigVenda, type TierVenda } from "./config";

/**
 * ALLOWLIST HÍBRIDA (OD-NFT-06, aprovada em princípio): inscrição → verificação → elegibilidade →
 * preferência de tier → alocação → snapshot → congelamento → árvore de Merkle → raiz → prova.
 *
 *   · trilho principal: Early Access verificado (e-mail confirmado + carteira assinada + país permitido);
 *   · trilho curado: lista pequena, cada entrada com MOTIVO (auditável);
 *   · Pilot só é vendido na fase de allowlist (nunca na pública); a alocação na allowlist é o teto da fase (1 por tier);
 *   · país: a política é JURÍDICA (OD-NFT-16). Sem política configurada, o resultado é `PENDING_LEGAL` —
 *     nunca "liberado" por omissão. Nenhum país está fixo no código;
 *   · nada de dado pessoal no snapshot: só endereço de carteira, tier e quantidade. E-mail entra como hash
 *     (gerado fora daqui) e não sai do domínio.
 *
 * Folha (determinística, versionada): sha256("founders-allowlist-leaf-v2\0" + carteira + "\0" + tier + "\0" + qtd).
 * ⚠️ O hash do programa de venda real em Solana precisa ser conferido no ensaio em devnet; a árvore aceita outro
 * hash/codificação sem mudar (são injetados em `merkle.ts`).
 */
export type EstadoElegibilidade = "UNKNOWN" | "CHECKING" | "ELIGIBLE" | "NOT_ELIGIBLE" | "PENDING_LEGAL" | "PENDING_OWNER_POLICY";
export type IntencaoNaoVinculante = "pretende_comprar" | "talvez" | "so_interesse";

export interface Inscricao {
  id: string;
  emailHash: string;
  emailVerificado: boolean;
  carteira: string | null;
  carteiraAssinada: boolean;
  /** País AUTODECLARADO (ISO alfa-2), como no Early Access. */
  pais: string;
  preferenciaTier: TierVenda | "indeciso" | null;
  intencao: IntencaoNaoVinculante | null;
  fonte: string;
  referral: string | null;
  em: number;
}

export interface EntradaCurada { carteira: string; tier: TierVenda; motivo: string }

export type MotivoRecusa = "email_nao_verificado" | "carteira_ausente" | "carteira_nao_assinada" | "carteira_invalida"
  | "pais_bloqueado" | "pais_nao_permitido" | "sem_preferencia";

export interface Avaliacao { inscricao: string; estado: EstadoElegibilidade; motivos: MotivoRecusa[] }

/** Normalizador Solana local: base58 de 32–44 caracteres. Não decodifica; o ensaio em devnet valida de verdade. */
export function normalizarSolana(endereco: string): string | null {
  const s = endereco.trim();
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) ? s : null;
}

export function avaliar(i: Inscricao, cfg: ConfigVenda): Avaliacao {
  const motivos: MotivoRecusa[] = [];
  if (!i.emailVerificado) motivos.push("email_nao_verificado");
  if (!i.carteira) motivos.push("carteira_ausente");
  else if (!normalizarSolana(i.carteira)) motivos.push("carteira_invalida");
  if (i.carteira && !i.carteiraAssinada) motivos.push("carteira_nao_assinada");
  if (!i.preferenciaTier || i.preferenciaTier === "indeciso") motivos.push("sem_preferencia");
  if (motivos.length) return { inscricao: i.id, estado: "NOT_ELIGIBLE", motivos };
  const { paisesPermitidos, paisesBloqueados } = cfg.juridico;
  if (paisesBloqueados.estado === "CONFIGURADO" && paisesBloqueados.valor.includes(i.pais)) return { inscricao: i.id, estado: "NOT_ELIGIBLE", motivos: ["pais_bloqueado"] };
  if (paisesPermitidos.estado === "CONFIGURADO") {
    return paisesPermitidos.valor.includes(i.pais)
      ? { inscricao: i.id, estado: "ELIGIBLE", motivos: [] }
      : { inscricao: i.id, estado: "NOT_ELIGIBLE", motivos: ["pais_nao_permitido"] };
  }
  return { inscricao: i.id, estado: "PENDING_LEGAL", motivos: [] };
}

export interface EntradaSnapshot { carteira: string; tier: TierVenda; quantidade: number; origem: "early_access" | "curada" }

/** Alocação: uma entrada por (carteira, tier); quantidade = teto da allowlist do tier. Curada vence duplicata. */
export function alocar(inscricoes: readonly Inscricao[], curadas: readonly EntradaCurada[], cfg: ConfigVenda): { entradas: EntradaSnapshot[]; pendentesJuridico: number; recusadas: number } {
  const porChave = new Map<string, EntradaSnapshot>();
  let pendentesJuridico = 0, recusadas = 0;
  for (const i of inscricoes) {
    const a = avaliar(i, cfg);
    if (a.estado === "PENDING_LEGAL") { pendentesJuridico++; continue; }
    if (a.estado !== "ELIGIBLE") { recusadas++; continue; }
    const carteira = normalizarSolana(i.carteira!)!;
    const tier = i.preferenciaTier as TierVenda;
    porChave.set(`${carteira}\0${tier}`, { carteira, tier, quantidade: cfg.tetos.allowlist[tier], origem: "early_access" });
  }
  for (const c of curadas) {
    const carteira = normalizarSolana(c.carteira);
    if (!carteira || !(TIERS as readonly string[]).includes(c.tier) || c.motivo.trim().length < 5) { recusadas++; continue; }
    porChave.set(`${carteira}\0${c.tier}`, { carteira, tier: c.tier, quantidade: cfg.tetos.allowlist[c.tier], origem: "curada" });
  }
  const entradas = [...porChave.values()].sort((a, b) => (a.carteira === b.carteira ? a.tier.localeCompare(b.tier) : a.carteira < b.carteira ? -1 : 1));
  return { entradas, pendentesJuridico, recusadas };
}

export const hashSha256: Hash = (d) => new Uint8Array(createHash("sha256").update(d).digest());
export const codificarEntrada = (e: Pick<EntradaSnapshot, "carteira" | "tier" | "quantidade">) => `founders-allowlist-leaf-v2\0${e.carteira}\0${e.tier}\0${e.quantidade}`;
export const folhaUtf8: CodificarFolha = (item) => new TextEncoder().encode(item);
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

export interface SnapshotAlocacao {
  versao: number;
  entradas: readonly EntradaSnapshot[];
  raiz: string;
  /** Identidade do snapshot: sha256 canônico de versão + entradas + raiz. */
  id: string;
  congelado: boolean;
  congeladoEm: number | null;
}

export function criarSnapshotAlocacao(versao: number, entradas: readonly EntradaSnapshot[]): SnapshotAlocacao {
  if (!Number.isInteger(versao) || versao < 1) throw new Error("versao_invalida");
  if (entradas.length === 0) throw new Error("snapshot_vazio");
  const arv = construir(entradas.map(codificarEntrada), hashSha256, folhaUtf8);
  const raiz = hex(arv.raiz);
  const id = sha256Hex("founders-snapshot-v2\0" + canonico({ versao, entradas: entradas.map((e) => ({ ...e })), raiz }));
  return { versao, entradas, raiz, id, congelado: false, congeladoEm: null };
}

/** Congela: devolve uma cópia profundamente imutável. O original não é alterado. */
export function congelar(s: SnapshotAlocacao, agora: number): SnapshotAlocacao {
  if (s.congelado) throw new Error("snapshot_ja_congelado");
  const entradas = Object.freeze(s.entradas.map((e) => Object.freeze({ ...e })));
  return Object.freeze({ ...s, entradas, congelado: true, congeladoEm: agora });
}

/** Recalcula raiz e id a partir das entradas: qualquer mutação aparece. */
export function snapshotIntegro(s: SnapshotAlocacao): boolean {
  try { const r = criarSnapshotAlocacao(s.versao, s.entradas); return r.raiz === s.raiz && r.id === s.id; }
  catch { return false; }
}

export interface ProvaAllowlist { snapshotId: string; versao: number; entrada: EntradaSnapshot; caminho: string[] }

export function provaPara(s: SnapshotAlocacao, carteira: string, tier: TierVenda): ProvaAllowlist | null {
  const idx = s.entradas.findIndex((e) => e.carteira === carteira && e.tier === tier);
  if (idx < 0) return null;
  const arv = construir(s.entradas.map(codificarEntrada), hashSha256, folhaUtf8);
  return { snapshotId: s.id, versao: s.versao, entrada: s.entradas[idx], caminho: prova(arv, idx).map(hex) };
}

/** Verificação contra o snapshot CONGELADO vigente: prova de outro snapshot, entrada alterada ou caminho falso = false. */
export function verificarProva(vigente: SnapshotAlocacao, p: ProvaAllowlist): boolean {
  if (!vigente.congelado || p.snapshotId !== vigente.id || p.versao !== vigente.versao) return false;
  const raiz = new Uint8Array(Buffer.from(vigente.raiz, "hex"));
  return verificar(raiz, codificarEntrada(p.entrada), p.caminho.map((h) => new Uint8Array(Buffer.from(h, "hex"))), hashSha256, folhaUtf8);
}
