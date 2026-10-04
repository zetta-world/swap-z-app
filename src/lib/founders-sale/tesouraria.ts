import { sha256Hex } from "./evidencia";
import type { ConfigVenda } from "./config";

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
  | { estado: "PENDING_OWNER" | "PENDING_EXTERNAL"; pendente: string[] }
  | { estado: "DIVERGENTE"; diferencas: string[] };

export const fingerprintEndereco = (endereco: string) => sha256Hex(`founders-tesouraria-v1\0${endereco}`);

export function verificarTesouraria(cfg: ConfigVenda, obs: TesourariaObservada | null): ResultadoTesouraria {
  const t = cfg.tesouraria;
  const pend: string[] = [];
  if (t.signatarios.estado !== "CONFIGURADO") pend.push(`signatarios (${t.signatarios.estado})`);
  if (t.endereco.estado !== "CONFIGURADO") pend.push(`endereco (${t.endereco.estado})`);
  if (t.politicaConversao.estado !== "CONFIGURADO") pend.push(`politicaConversao (${t.politicaConversao.estado})`);
  if (pend.length) return { estado: t.signatarios.estado !== "CONFIGURADO" ? "PENDING_OWNER" : "PENDING_EXTERNAL", pendente: pend };
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
