/**
 * ⚠️ W4 (21/10) — CONEXÃO DA CARTEIRA × SESSÃO ASSINADA, e o deeplink da Phantom no celular.
 *
 * 1. PHANTOM NO ANDROID: o link "Abrir na Phantom" abre o site DENTRO do navegador da Phantom
 *    (`/ul/browse`), mas a doc oficial é explícita: conectar é um passo SEPARADO. Nada pedia a
 *    conexão ao chegar lá — o usuário via o site sem o pedido de autorização. Agora o link leva um
 *    MARCADOR na URL; dentro da Phantom (provedor injetado) a página pede a conexão UMA vez e remove
 *    o marcador. Cancelar no pop-up da Phantom não quebra nada: fica desconectado.
 *    Doc: https://docs.phantom.com/phantom-deeplinks/other-methods/browse
 *
 * 2. SESSÃO DA CARTEIRA A NUNCA VALE PARA A CARTEIRA B: se a carteira conectada da mesma rede da
 *    sessão é outra, a sessão é encerrada (o cookie é de A; quem está operando é B). Sem carteira
 *    conectada nada acontece — a sessão não depende de reconexão automática.
 */
export const MARCADOR_CONECTAR = "zsw_conectar";

/** Deeplink oficial `browse` com o marcador que pede a conexão ao chegar na Phantom. */
export function urlBrowsePhantom(href: string, origin: string): string {
  const alvo = new URL(href);
  alvo.searchParams.set(MARCADOR_CONECTAR, "phantom");
  return `https://phantom.com/ul/browse/${encodeURIComponent(alvo.toString())}?ref=${encodeURIComponent(origin)}`;
}

/** A URL pede conexão da Phantom? Devolve a URL limpa (sem o marcador) quando sim. */
export function pedidoDeConexao(href: string): { pedido: boolean; limpa: string } {
  const u = new URL(href);
  const pedido = u.searchParams.get(MARCADOR_CONECTAR) === "phantom";
  u.searchParams.delete(MARCADOR_CONECTAR);
  return { pedido, limpa: u.toString() };
}

/**
 * A sessão assinada deve ser ENCERRADA? Só quando a carteira conectada DA MESMA REDE da sessão é OUTRA
 * (ex.: sessão de A, Phantom trocou para B). Carteira de outra rede conectada junto (Solana + EVM) não
 * encerra: são identidades separadas, e o servidor já confere a origem de cada operação (W3).
 * EVM compara sem caixa (checksum); Solana compara exato (base58 diferencia maiúsculas).
 */
export function sessaoDeOutraCarteira(sessao: string | null, conectadas: { solana: string | null; evm: string | null }): boolean {
  if (!sessao) return false;
  if (sessao.startsWith("0x")) return !!conectadas.evm && conectadas.evm.toLowerCase() !== sessao.toLowerCase();
  return !!conectadas.solana && conectadas.solana !== sessao;
}
