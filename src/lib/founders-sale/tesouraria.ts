import { canonico, sha256Hex } from "./evidencia";
import { validarParametrosConversao, type ConfigVenda, type ParametrosConversao } from "./config";

/**
 * FRONTEIRA DA TESOURARIA (OD-NFT-10 modelo aprovado; OD-NFT-22 signatários/política pendentes).
 *
 * Nada aqui cria carteira, gera chave ou move fundo. Só VERIFICA, no futuro, que o destino do pagamento é a
 * multisig declarada: endereço, donos, limiar (2-de-3 planejado) e uma simulação de transação aprovada —
 * comparando o DECLARADO (configuração versionada, com fingerprint) com o OBSERVADO (lido da chain pelo operador
 * no ensaio em devnet / antes da venda). Com signatários pendentes, o resultado é `PENDING_OWNER` — nunca OK.
 */
export interface TesourariaObservada {
  endereco: string;
  donos: readonly string[];
  limiar: number;
  simulacaoAprovada: boolean;
}

export type ResultadoTesouraria =
  | { estado: "OK"; fingerprintEndereco: string }
  | { estado: "PENDING_OWNER" | "PENDING_LEGAL" | "PENDING_CHAIN" | "PENDING_EXTERNAL"; pendente: string[] }
  | { estado: "DIVERGENTE"; diferencas: string[] };

export const fingerprintEndereco = (endereco: string) => sha256Hex(`founders-tesouraria-v1\0${endereco}`);

export function verificarTesouraria(cfg: ConfigVenda, obs: TesourariaObservada | null): ResultadoTesouraria {
  const t = cfg.tesouraria;
  const pend: string[] = [];
  if (t.signatarios.estado !== "CONFIGURADO") pend.push(`signatarios (${t.signatarios.estado})`);
  if (t.endereco.estado !== "CONFIGURADO") pend.push(`endereco (${t.endereco.estado})`);
  const pc = t.politicaConversao.parametros;
  if (pc.estado !== "CONFIGURADO") pend.push(`politicaConversao.parametros (${pc.estado})`);
  if (pend.length) {
    // ordem de quem destrava primeiro: dono (identidades) → jurídico/contábil → chain (multisig criada)
    const estado = t.signatarios.estado !== "CONFIGURADO" ? "PENDING_OWNER" : pc.estado !== "CONFIGURADO" ? "PENDING_LEGAL" : "PENDING_CHAIN";
    return { estado, pendente: pend };
  }
  if (!obs) return { estado: "PENDING_EXTERNAL", pendente: ["observacao_on_chain"] };
  const dif: string[] = [];
  const endereco = t.endereco.estado === "CONFIGURADO" ? t.endereco.valor : "";
  const signatarios = t.signatarios.estado === "CONFIGURADO" ? t.signatarios.valor : [];
  if (t.modo !== "MULTISIG_REQUIRED") dif.push("modo");
  if (obs.endereco !== endereco) dif.push("endereco");
  if (obs.donos.length !== t.limiarPlanejado.n || [...obs.donos].sort().join() !== [...signatarios].sort().join()) dif.push("donos");
  if (obs.limiar !== t.limiarPlanejado.m) dif.push("limiar");
  if (!obs.simulacaoAprovada) dif.push("simulacao");
  return dif.length ? { estado: "DIVERGENTE", diferencas: dif } : { estado: "OK", fingerprintEndereco: fingerprintEndereco(endereco) };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * CONVERSÃO DA TESOURARIA — SIMULAÇÃO (OD-NFT-22, princípio APROVADO: as obrigações operacionais de 24 meses não
 * ficam expostas ao SOL depois do recebimento). Nenhuma ordem, nenhuma contraparte real, nenhum preço real.
 *
 * Os PARÂMETROS (frações SOL/stable/fiat, tamanho de tranche, tranches por dia, limite por contraparte) dependem de
 * análise de risco documentada + revisão contábil/jurídica: com eles pendentes o plano é RECUSADO (falha fechada).
 * Com parâmetros (de TESTE no ensaio), o plano:
 *   · nunca deixa SOL retido acima do que sobra depois de cobrir as obrigações (princípio do dono);
 *   · fatia em tranches ≤ teto, respeita tranches/dia e limite por contraparte;
 *   · gera trilha de auditoria encadeada (hash/anterior) de cada tranche planejada.
 */
export interface EntradaConversao {
  recebidoLamports: bigint;
  /** Referência BRL por SOL, em centavos — FALSA no ensaio. */
  brlCentavosPorSol: number;
  /** Obrigações operacionais (orçamento alocado) em centavos de BRL. */
  obrigacoesBrlCentavos: number;
}
export interface TrancheConversao { seq: number; dia: number; contraparte: string; destino: "STABLE" | "FIAT"; lamports: bigint; brlCentavos: number; anterior: string; hash: string }
export type PlanoConversao =
  | { ok: true; simulacao: true; tranches: TrancheConversao[]; solRetidoLamports: bigint; protegidoBrlCentavos: number; obrigacoesCobertas: boolean }
  | { ok: false; erro: "parametros_pendentes" | "parametros_invalidos" | "referencia_invalida" | "entrada_invalida" | "sol_retido_acima_do_permitido"; detalhe?: string[] };

const LAMPORTS = 1_000_000_000n;

export function planejarConversao(cfg: ConfigVenda, e: EntradaConversao): PlanoConversao {
  const pc = cfg.tesouraria.politicaConversao.parametros;
  if (pc.estado !== "CONFIGURADO") return { ok: false, erro: "parametros_pendentes", detalhe: [`${pc.estado} (${pc.ref})`] };
  return planejarComParametros(pc.valor, e);
}

export function planejarComParametros(p: ParametrosConversao, e: EntradaConversao): PlanoConversao {
  const inval = validarParametrosConversao(p);
  if (inval.length) return { ok: false, erro: "parametros_invalidos", detalhe: inval };
  if (!Number.isInteger(e.brlCentavosPorSol) || e.brlCentavosPorSol <= 0) return { ok: false, erro: "referencia_invalida" };
  if (e.recebidoLamports < 0n || !Number.isInteger(e.obrigacoesBrlCentavos) || e.obrigacoesBrlCentavos < 0) return { ok: false, erro: "entrada_invalida" };
  const valorTotal = (e.recebidoLamports * BigInt(e.brlCentavosPorSol)) / LAMPORTS; // centavos
  // princípio: SOL retido ≤ valor total − obrigações
  const retidoPermitidoCent = valorTotal > BigInt(e.obrigacoesBrlCentavos) ? valorTotal - BigInt(e.obrigacoesBrlCentavos) : 0n;
  const retidoCent = (valorTotal * BigInt(p.solRetidoBps)) / 10_000n;
  if (retidoCent > retidoPermitidoCent) return { ok: false, erro: "sol_retido_acima_do_permitido", detalhe: [`retido ${retidoCent} > permitido ${retidoPermitidoCent} (centavos)`] };
  const solRetido = (e.recebidoLamports * BigInt(p.solRetidoBps)) / 10_000n;
  const aConverter = e.recebidoLamports - solRetido;
  const fiatLamports = (aConverter * BigInt(p.fiatBps)) / BigInt(p.stableBps + p.fiatBps || 1);
  const destinos: Array<["STABLE" | "FIAT", bigint]> = [["FIAT", fiatLamports], ["STABLE", aConverter - fiatLamports]];
  const limiteContraparte = (aConverter * BigInt(p.limitePorContraparteBps)) / 10_000n;
  const usado = new Map<string, bigint>();
  const trancheMaxLamports = (BigInt(p.trancheMaxBrlCentavos) * LAMPORTS) / BigInt(e.brlCentavosPorSol);
  const tranches: TrancheConversao[] = [];
  let anterior = "GENESIS", seq = 0, ci = 0;
  for (const [destino, total] of destinos) {
    let resta = total;
    while (resta > 0n) {
      // próxima contraparte com folga
      let tentativas = 0;
      while ((usado.get(p.contrapartes[ci % p.contrapartes.length]) ?? 0n) >= limiteContraparte && tentativas < p.contrapartes.length) { ci++; tentativas++; }
      const cp = p.contrapartes[ci % p.contrapartes.length];
      const folga = limiteContraparte - (usado.get(cp) ?? 0n);
      if (folga <= 0n) break; // limites esgotados: o resto fica sem tranche (validarParametros garante cobertura)
      let lam = resta < trancheMaxLamports ? resta : trancheMaxLamports;
      if (lam > folga) lam = folga;
      if (lam <= 0n) break;
      const brl = Number((lam * BigInt(e.brlCentavosPorSol)) / LAMPORTS);
      const dia = Math.floor(seq / p.tranchesPorDiaMax);
      const dados = { seq, dia, contraparte: cp, destino, lamports: lam.toString(), brlCentavos: brl, simulacao: true };
      const hash = sha256Hex(`founders-conversao-v1\0${canonico({ dados, anterior })}`);
      tranches.push({ seq, dia, contraparte: cp, destino, lamports: lam, brlCentavos: brl, anterior, hash });
      anterior = hash; seq++; ci++;
      usado.set(cp, (usado.get(cp) ?? 0n) + lam);
      resta -= lam;
    }
  }
  const convertido = tranches.reduce((a, t) => a + t.lamports, 0n);
  const protegido = Number((convertido * BigInt(e.brlCentavosPorSol)) / LAMPORTS);
  return { ok: true, simulacao: true, tranches, solRetidoLamports: e.recebidoLamports - convertido, protegidoBrlCentavos: protegido, obrigacoesCobertas: protegido >= e.obrigacoesBrlCentavos };
}

/** Confere a trilha de um plano (encadeamento + recomputação dos hashes). */
export function conferirTrilhaConversao(ts: readonly TrancheConversao[]): boolean {
  let anterior = "GENESIS";
  for (const t of ts) {
    const dados = { seq: t.seq, dia: t.dia, contraparte: t.contraparte, destino: t.destino, lamports: t.lamports.toString(), brlCentavos: t.brlCentavos, simulacao: true };
    if (t.anterior !== anterior || t.hash !== sha256Hex(`founders-conversao-v1\0${canonico({ dados, anterior })}`)) return false;
    anterior = t.hash;
  }
  return true;
}
