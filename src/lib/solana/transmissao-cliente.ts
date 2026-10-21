/**
 * Cliente da transmissão Solana (W3): o navegador NÃO fala com RPC — envia a transação JÁ ASSINADA
 * pela carteira ao servidor (`/api/solana/transmitir`) e acompanha por `/api/solana/status`.
 *
 * ⚠️ Regras que este arquivo existe para não deixar quebrar:
 *   · "Não respondeu" ≠ "não enviou": falha de rede ao falar com o NOSSO servidor é `incerta`.
 *   · Nova tentativa só depois de saber que a anterior NÃO pode mais pousar (`podeTentarDeNovo`).
 *   · Confirmada só com `err` nulo; pousar com erro é `falhou_na_rede`.
 */
import { ETAPAS_EM_ABERTO, type EtapaTx, type TxHistoryEntry } from "@/lib/store/txHistory";

export type Envio =
  | { estado: "enviada"; assinatura: string }
  | { estado: "nao_enviada"; assinatura: string; motivo: string }
  | { estado: "incerta"; assinatura: string; motivo: string };

export type Desfecho =
  | { estado: "confirmada" }
  | { estado: "falhou_na_rede"; erro: string }
  | { estado: "expirada" }
  | { estado: "indefinido"; motivo: string };   // ainda pendente/desconhecido quando o acompanhamento acabou

/** Envia a transação assinada. `assinatura` é a derivada localmente (a mesma que a rede usará). */
export async function transmitirAssinada(txBase64: string, owner: string, assinatura: string, vinculo?: string, mensagemOriginal?: string): Promise<Envio> {
  let res: Response;
  try {
    res = await fetch("/api/solana/transmitir", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx: txBase64, owner, vinculo, mensagemOriginal }), cache: "no-store",
    });
  } catch {
    // Não sabemos se o servidor chegou a transmitir.
    return { estado: "incerta", assinatura, motivo: "conexao_com_servidor" };
  }
  let j: { ok?: boolean; fase?: string; estado?: string; assinatura?: string; motivo?: string; erro?: string } = {};
  try { j = await res.json(); } catch { /* tratado abaixo */ }
  // ⚠️ "Não transmitida" só com PROVA: recusa estruturada da aplicação marcada `antes_do_rpc`.
  // Um 503/429/504 de gateway ou da infraestrutura (sem a marca) pode ter chegado DEPOIS de o
  // servidor transmitir — é incerto, e a assinatura pública reconcilia.
  if (!res.ok) {
    if (j.ok === false && j.fase === "antes_do_rpc" && typeof j.erro === "string") {
      return { estado: "nao_enviada", assinatura, motivo: j.erro };
    }
    return { estado: "incerta", assinatura, motivo: `http_${res.status}` };
  }
  if (j.ok !== true) return { estado: "incerta", assinatura, motivo: "resposta_inesperada" };
  if (j.assinatura !== assinatura) return { estado: "incerta", assinatura, motivo: "assinatura_divergente" };
  if (j.estado === "enviada") return { estado: "enviada", assinatura };
  if (j.estado === "nao_enviada") return { estado: "nao_enviada", assinatura, motivo: j.motivo ?? "recusada" };
  return { estado: "incerta", assinatura, motivo: j.motivo ?? "incerta" };
}

export type StatusOnChain =
  | { estado: "confirmada" } | { estado: "falhou_na_rede"; erro: string }
  | { estado: "pendente" } | { estado: "expirada" } | { estado: "desconhecido"; motivo: string };

export async function consultarStatusOnChain(assinatura: string, validoAteBloco: number | undefined): Promise<StatusOnChain> {
  const q = new URLSearchParams({ sig: assinatura, ...(validoAteBloco !== undefined ? { lvbh: String(validoAteBloco) } : {}) });
  try {
    const res = await fetch(`/api/solana/status?${q}`, { cache: "no-store" });
    const j = await res.json() as { ok?: boolean; estado?: string; erro?: string; motivo?: string };
    if (!res.ok || j.ok !== true) return { estado: "desconhecido", motivo: j.erro ?? `http_${res.status}` };
    if (j.estado === "confirmada") return { estado: "confirmada" };
    if (j.estado === "falhou_na_rede") return { estado: "falhou_na_rede", erro: j.erro ?? "erro" };
    if (j.estado === "expirada") return { estado: "expirada" };
    if (j.estado === "pendente") return { estado: "pendente" };
    return { estado: "desconhecido", motivo: j.motivo ?? "desconhecido" };
  } catch {
    return { estado: "desconhecido", motivo: "conexao" };
  }
}

/**
 * Consulta até um desfecho DEFINITIVO (confirmada / falhou na rede / expirada) ou até o prazo.
 * Sem desfecho no prazo → `indefinido`: NÃO é falha — a tela e o histórico dizem "em verificação".
 */
export async function acompanharAteDesfecho(assinatura: string, validoAteBloco: number | undefined, opts: {
  intervaloMs?: number; prazoMs?: number; dormir?: (ms: number) => Promise<void>; agora?: () => number;
  aoMudar?: (s: StatusOnChain) => void;
} = {}): Promise<Desfecho> {
  const intervalo = opts.intervaloMs ?? 2_000;
  const prazo = opts.prazoMs ?? 120_000;
  const dormir = opts.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const agora = opts.agora ?? Date.now;
  const inicio = agora();
  let ultimo = "pendente";
  for (;;) {
    const s = await consultarStatusOnChain(assinatura, validoAteBloco);
    opts.aoMudar?.(s);
    if (s.estado === "confirmada") return { estado: "confirmada" };
    if (s.estado === "falhou_na_rede") return { estado: "falhou_na_rede", erro: s.erro };
    if (s.estado === "expirada") return { estado: "expirada" };
    ultimo = s.estado === "desconhecido" ? `desconhecido:${s.motivo}` : "pendente";
    if (agora() - inicio >= prazo) return { estado: "indefinido", motivo: ultimo };
    await dormir(intervalo);
  }
}

/** Etapa do histórico para cada desfecho do envio/acompanhamento. */
export function etapaDoEnvio(e: Envio): EtapaTx {
  return e.estado === "enviada" ? "pendente" : e.estado === "nao_enviada" ? "envio_falhou" : "envio_incerto";
}
export function etapaDoDesfecho(d: Desfecho, etapaAtual: EtapaTx): EtapaTx {
  if (d.estado === "confirmada") return "confirmada";
  if (d.estado === "falhou_na_rede") return "falhou_na_rede";
  if (d.estado === "expirada") return "expirada";
  return etapaAtual;   // indefinido: continua pendente / envio_incerto
}

/**
 * ⚠️ ANTI-DUPLICAÇÃO. Existe tentativa desta carteira que AINDA PODE pousar? Enquanto existir, uma
 * nova assinatura é bloqueada — se a anterior pousasse depois, o usuário trocaria duas vezes.
 * Só registros desta carteira contam (não mistura carteiras).
 */
export function tentativaEmAberto(entries: TxHistoryEntry[], wallet: string): TxHistoryEntry | undefined {
  return entries.find((e) => e.wallet === wallet && e.route === "jupiter" && !!e.etapa && ETAPAS_EM_ABERTO.has(e.etapa));
}
