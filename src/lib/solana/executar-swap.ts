/**
 * ⚠️⚠️ O FLUXO DE UM SWAP SOLANA, DO PEDIDO DE ASSINATURA AO DESFECHO ON-CHAIN (W3, 21/10).
 *
 * Extraído do `ExecuteSwap` para ser testável ponta a ponta — inclusive o caso real do dono:
 * Phantom assina → envio dá 403 → a tentativa PRECISA estar no histórico, com a assinatura pública,
 * marcada "Falha no envio" (não transmitida) e sem volume/taxa.
 *
 * Ordem (cada passo grava a etapa ANTES do próximo):
 *   1. bloqueia se a carteira tem tentativa que ainda pode pousar (anti-duplicação)
 *   2. registra `solicitada` (antes de pedir assinatura)
 *   3. carteira assina (recusou → `cancelada`) → `assinada` + assinatura pública
 *   4. envia PELO SERVIDOR (único caminho — ver W3-B abaixo)
 *        nao_enviada → `envio_falhou` · incerta → `envio_incerto` · enviada → `pendente`
 *   5. acompanha o status on-chain: confirmada (err nulo) · falhou_na_rede · expirada · em aberto
 *
 * ⚠️⚠️ W3-B (2ª auditoria, 21/10): UM ÚNICO CAMINHO DE ENVIO. O caminho Jito mandava a transação do
 * NAVEGADOR direto ao block engine, sem passar pela validação do servidor (assinatura, programas,
 * VÍNCULO com a cotação/taxa). E ele estava LIGADO: `NEXT_PUBLIC_SOLANA_JITO` é "on" em Preview e
 * Production (o ramo "desligado" foi eliminado na compilação dos bundles servidos). Foi removido do
 * fluxo; religar exige paridade — o servidor validar e então submeter ao Jito — e um teste trava isso.
 *
 * NÃO-CUSTODIAL: só a carteira assina (`assinar`). Nada aqui toca chave; a transação assinada bruta
 * vai ao servidor para transmissão e NUNCA ao histórico.
 */
import type { VersionedTransaction } from "@solana/web3.js";
import { statusDaEtapa, type EtapaTx, type TxHistoryEntry } from "@/lib/store/txHistory";
import { assinaturaDe } from "@/lib/solana/assinatura";
import {
  acompanharAteDesfecho, etapaDoDesfecho, etapaDoEnvio, tentativaEmAberto, transmitirAssinada, type Envio,
} from "@/lib/solana/transmissao-cliente";

export type ResultadoSwapSolana =
  | "bloqueada" | "cancelada" | "envio_falhou" | "confirmada" | "falhou_na_rede" | "expirada" | "em_aberto";

export interface DepsSwapSolana {
  owner: string;
  tx: VersionedTransaction;
  validoAteBloco: number;
  /** Vínculo emitido pelo servidor na cotação firme (`result.swap.vinculo`). */
  vinculo?: string;
  /** Campos descritivos da linha do histórico (par, valores, rota…). */
  registro: Omit<TxHistoryEntry, "id" | "ts" | "status" | "etapa" | "wallet" | "validoAteBloco" | "txHash">;
  historico: {
    entries: () => TxHistoryEntry[];
    push: (e: Omit<TxHistoryEntry, "id" | "ts">) => string;
    update: (id: string, patch: Partial<TxHistoryEntry>) => void;
  };
  /** A CARTEIRA assina — única fonte de assinatura. */
  assinar: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  transmitir?: typeof transmitirAssinada;
  acompanhar?: (sig: string, lvbh: number) => ReturnType<typeof acompanharAteDesfecho>;
  ui: {
    fase: (f: "needs_tx_signature" | "tx_pending" | "tx_confirmed" | "tx_failed") => void;
    erro: (msg: string) => void;
    nota: (msg: string | null) => void;
    assinatura: (sig: string) => void;
  };
  texto: (k: "solPreviousOpen" | "solQuoteAlreadySent" | "solSendFailed" | "solSendUncertain" | "solExecutionFailed" | "solExpired" | "solStillChecking") => string;
}

export async function executarSwapSolana(d: DepsSwapSolana): Promise<{ historyId: string | null; resultado: ResultadoSwapSolana }> {
  const transmitir = d.transmitir ?? transmitirAssinada;
  const acompanhar = d.acompanhar ?? ((s: string, l: number) => acompanharAteDesfecho(s, l));

  // 1. Anti-duplicação.
  if (tentativaEmAberto(d.historico.entries(), d.owner)) {
    d.ui.erro(d.texto("solPreviousOpen"));
    d.ui.fase("tx_failed");
    return { historyId: null, resultado: "bloqueada" };
  }

  // 2. A tentativa existe ANTES da assinatura.
  const id = d.historico.push({
    ...d.registro, status: "pending", etapa: "solicitada", wallet: d.owner, validoAteBloco: d.validoAteBloco,
  });
  const marcar = (etapa: EtapaTx, extra: Partial<TxHistoryEntry> = {}) =>
    d.historico.update(id, { etapa, status: statusDaEtapa(etapa), ...extra });

  // 3. Só a carteira assina.
  d.ui.fase("needs_tx_signature");
  // Snapshot BEFORE invoking a wallet: adapters may mutate the input object in place.
  const mensagemOriginal = Buffer.from(d.tx.message.serialize()).toString("base64");
  let assinada: VersionedTransaction;
  try {
    assinada = await d.assinar(d.tx);
  } catch (e) {
    marcar("cancelada", { motivo: "assinatura_recusada" });
    throw e;   // quem chama mostra a mensagem de recusa de sempre
  }
  const sig = assinaturaDe(assinada);
  const b64 = Buffer.from(assinada.serialize()).toString("base64");
  marcar("assinada", { txHash: sig });
  d.ui.assinatura(sig);

  // 4. Envio: SÓ pelo servidor (valida assinatura, programas e o vínculo cotação↔taxa).
  const envio: Envio = await transmitir(b64, d.owner, sig, d.vinculo, mensagemOriginal);

  if (envio.estado === "nao_enviada") {
    marcar("envio_falhou", { motivo: envio.motivo.slice(0, 120) });
    // W3-C: o servidor recusou porque OUTRA transação desta carteira (talvez de outro aparelho) ainda pode pousar.
    // ⚠️ `cotacao_ja_enviada`: outra assinatura DESTA cotação está em aberto ou CONFIRMADA — o swap pode já ter
    // acontecido. Nunca dizer "nada saiu da carteira" aqui (o texto de `solSendFailed`).
    d.ui.erro(envio.motivo === "anterior_em_aberto" ? d.texto("solPreviousOpen")
      : envio.motivo === "cotacao_ja_enviada" ? d.texto("solQuoteAlreadySent")
      : `${d.texto("solSendFailed")} (${envio.motivo.slice(0, 80)})`);
    d.ui.fase("tx_failed");
    return { historyId: id, resultado: "envio_falhou" };
  }
  const etapaEnvio = etapaDoEnvio(envio);
  marcar(etapaEnvio, envio.estado === "incerta" ? { motivo: envio.motivo.slice(0, 120) } : {});
  if (envio.estado === "incerta") d.ui.nota(d.texto("solSendUncertain"));
  d.ui.fase("tx_pending");

  // 5. Desfecho on-chain.
  const desfecho = await acompanhar(sig, d.validoAteBloco);
  if (desfecho.estado === "falhou_na_rede") {
    marcar("falhou_na_rede", { motivo: desfecho.erro.slice(0, 120) });
    d.ui.erro(`${d.texto("solExecutionFailed")} ${desfecho.erro.slice(0, 120)}`);
    d.ui.fase("tx_failed");
    return { historyId: id, resultado: "falhou_na_rede" };
  }
  if (desfecho.estado === "expirada") {
    marcar("expirada", { motivo: envio.estado === "incerta" ? envio.motivo.slice(0, 120) : "nao_pousou" });
    d.ui.erro(d.texto("solExpired"));
    d.ui.fase("tx_failed");
    return { historyId: id, resultado: "expirada" };
  }
  if (desfecho.estado === "indefinido") {
    // NÃO é falha: fica em aberto (reconciliação resolve) e bloqueia nova assinatura desta carteira.
    marcar(etapaDoDesfecho(desfecho, etapaEnvio), { motivo: desfecho.motivo.slice(0, 120) });
    d.ui.erro(d.texto("solStillChecking"));
    d.ui.fase("tx_failed");
    return { historyId: id, resultado: "em_aberto" };
  }
  marcar("confirmada");
  d.ui.fase("tx_confirmed");
  return { historyId: id, resultado: "confirmada" };
}
