/**
 * ⚠️⚠️ A120 — O VÍNCULO CREDENCIAL ↔ INTENT (credential fingerprint).
 *
 * O QUE ELE FECHA. O recovery por intentId (`/api/cex/order/status`) reconciliava
 * qualquer intent manual com QUALQUER credencial válida apresentada no body: um
 * atacante que soubesse o `intentId` (vazado num log, num print de suporte) podia
 * reconciliar a ordem de OUTRA pessoa com a PRÓPRIA chave — e pior: dependendo do
 * que a venue devolvesse para a credencial errada, o livro alheio era mutado por
 * uma leitura que não era daquela conta.
 *
 * A CORREÇÃO É UM HMAC, NÃO A CHAVE. Na criação da ordem MANUAL REAL o servidor
 * grava no intent `credential_fingerprint = HMAC_SHA256(env, exchange + NUL +
 * apiKey)` — uma impressão que NÃO permite recuperar a chave, mas permite conferir
 * se a credencial apresentada no recovery é a mesma que criou a ordem. Intents de
 * autopilot/DCA não recebem fingerprint: a credencial deles está no cofre e o
 * recovery deles é pela sessão. Intents históricos (coluna NULL) fecham: o
 * recovery responde `recovery_not_bound` em vez de reconciliar às cegas.
 *
 * ⚠️ A apiKey ENTRA EXATA — case-sensitive, sem trim, sem normalização. A chave é
 * um segredo opaco: "corrigir" a caixa dela criaria um vínculo que a corretora não
 * reconhece. Só a exchange é canonicalizada, e pela MESMA regra que as rotas já
 * usam (`toLowerCase`) — uma segunda canonicalização divergiria na primeira
 * exchange com nome ambíguo.
 *
 * ⚠️ ENV AUSENTE = CONFIGURAÇÃO QUEBRADA, não "fingerprint vazio". Um fingerprint
 * calculado com chave vazia seria um vínculo falso gravado no livro; preferimos
 * falhar a criação da ordem (`server_configuration_error`) a gravar mentira.
 */

import crypto from "node:crypto";

/**
 * A canonicalização de exchange que o sistema JÁ usa: as rotas CEX fazem
 * `exchange.toLowerCase()` antes de validar contra `SUPPORTED_CEX_IDS`
 * (ver `src/app/api/cex/order/route.ts` e `.../status/route.ts`). Reuso
 * deliberado — NÃO inventar uma segunda forma (trim, NFKC, punycode...) que
 * divergiria desta.
 */
export function canonicalizarExchange(exchangeId: string): string {
  return String(exchangeId).toLowerCase();
}

/**
 * A impressão da credencial: HMAC-SHA256 hex de
 * `canonicalizarExchange(exchangeId) + "\0" + apiKey`, com a chave do servidor
 * em `CEX_RECOVERY_HMAC_KEY`.
 *
 * O NUL separa os dois campos sem ambiguidade ("ab" + "c" ≠ "a" + "bc") e dá
 * separação de domínio por exchange: a mesma apiKey em duas corretoras gera
 * impressões diferentes.
 *
 * ⚠️ LANÇA `server_configuration_error` se a env estiver ausente/vazia — quem
 * chama (rota de criação) transforma em 500 ANTES de qualquer efeito externo.
 */
export function impressaoDaCredencial(exchangeId: string, apiKey: string): string {
  const chave = process.env.CEX_RECOVERY_HMAC_KEY;
  if (!chave) {
    throw new Error("server_configuration_error: CEX_RECOVERY_HMAC_KEY ausente ou vazia");
  }
  return crypto
    .createHmac("sha256", chave)
    .update(canonicalizarExchange(exchangeId) + "\0" + apiKey, "utf8")
    .digest("hex");
}

/**
 * A conferência é em TEMPO CONSTANTE e com guarda de comprimento: buffers de
 * tamanhos diferentes retornam `false` SEM comparar (o `timingSafeEqual` lança
 * nesse caso, e um throw aqui viraria 500 onde a resposta honesta é 403).
 */
export function impressaoConfere(apresentada: string, gravada: string): boolean {
  const a = Buffer.from(apresentada, "utf8");
  const b = Buffer.from(gravada, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * A127 — A IDENTIDADE DA CONEXÃO (domínio `cex-connection-v1`).
 *
 * Responde "estas credenciais são a MESMA conta CEX da conexão atual?" sem
 * guardar nem comparar segredo em claro: HMAC-SHA256 hex de
 *
 *   "cex-connection-v1" + NUL
 *   + canonicalizarExchange(exchangeId) + NUL
 *   + apiKey EXATA + NUL + apiSecret EXATA + NUL + (passphrase ?? "")
 *
 * sob `CEX_RECOVERY_HMAC_KEY`. É o que permite ao cofre versionar conexões
 * (migration 0063): mesma identidade na current ativa = mesma conta, reusa o
 * id; identidade diferente = OUTRA conta, aposenta a anterior e cria versão
 * nova — nunca sobrescreve o `creds_cipher` na mesma linha.
 *
 * ⚠️ DOMÍNIO DISTINTO do fingerprint manual do A120 (`impressaoDaCredencial`):
 * o prefixo "cex-connection-v1" e a inclusão de apiSecret/passphrase fazem
 * uma identidade de conexão NUNCA colidir com uma impressão de recovery — um
 * valor de um domínio não pode ser apresentado no outro.
 *
 * ⚠️ apiKey/apiSecret/passphrase entram EXATOS — sem trim, sem case-fold: o
 * segredo é opaco. Só a exchange é canonicalizada, pela MESMA regra do A120.
 * E env ausente = `server_configuration_error`, como lá: identidade calculada
 * com chave vazia seria um vínculo falso — quem chama (`guardarConexao`)
 * captura e NÃO GRAVA NADA (fail-closed).
 */
export function identidadeDaConexao(
  exchangeId: string,
  creds: { apiKey: string; apiSecret: string; passphrase?: string },
): string {
  const chave = process.env.CEX_RECOVERY_HMAC_KEY;
  if (!chave) {
    throw new Error("server_configuration_error: CEX_RECOVERY_HMAC_KEY ausente ou vazia");
  }
  return crypto
    .createHmac("sha256", chave)
    .update(
      "cex-connection-v1\0"
      + canonicalizarExchange(exchangeId) + "\0"
      + creds.apiKey + "\0"
      + creds.apiSecret + "\0"
      + (creds.passphrase ?? ""),
      "utf8",
    )
    .digest("hex");
}
