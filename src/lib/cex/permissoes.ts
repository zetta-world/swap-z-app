/**
 * VERIFICAR SE A CHAVE PODE SACAR — antes de guardá-la no servidor.
 *
 * ⚠️⚠️ POR QUE ISTO EXISTE (09/08, auditoria da Fase 7).
 *
 * O autopilot em segundo plano guarda a credencial do cliente CIFRADA NO
 * SERVIDOR (`autopilot_sessions.creds_cipher`) para negociar com o navegador
 * fechado. Isso está divulgado na tela de armar, com bloco próprio — a
 * divulgação está correta e eu conferi antes de reclamar dela.
 *
 * O que NÃO está: o controle que torna esse risco aceitável — a chave ser
 * "só negociar, não sacar" — **nunca foi verificado**.
 *
 *   · `CexSettings.tsx` grava `readOnly: true` FIXO, em toda chave salva;
 *   · o tipo diz "marked trade-only by the USER" — o usuário não marca nada;
 *   · o nome é `readOnly` e o significado é "trade-only", que são coisas
 *     DIFERENTES (só-leitura não negocia; trade-only negocia e não saca);
 *   · e o campo **nunca é lido** por ninguém: gate nenhum.
 *
 * Ou seja: quatro problemas numa linha, e o efeito é que um cliente que colar
 * uma chave com permissão TOTAL recebe zero aviso, e ela é guardada no servidor
 * do mesmo jeito.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ TRÊS RESPOSTAS, NÃO DUAS — e a terceira é a que costuma virar defeito.
 *
 * "Não consegui verificar" NÃO é "está seguro". É a invariante nº 6 da lista:
 * *não medimos ≠ medimos zero*. Uma chave não verificada tem que sair marcada
 * como não verificada, e a decisão de aceitá-la é de quem lê — nunca um
 * default silencioso.
 */

import ccxt from "ccxt";
import type { CexId, CexCredentials } from "./types";

export type VereditoChave = "so_negocia" | "pode_sacar" | "nao_verificavel";

export interface PermissaoChave {
  veredito: VereditoChave;
  /** O que a corretora respondeu, para o veredito ser conferível. */
  detalhe: string;
  /** A corretora expõe endpoint de permissão? Declarado, não inferido. */
  suportado: boolean;
}

/**
 * ⚠️ QUEM EXPÕE PERMISSÃO DE CHAVE, declarado por corretora.
 *
 * Nem toda corretora publica isso. Marcar as que não publicam como
 * `nao_verificavel` é honesto; assumir que "sem endpoint = sem saque" seria
 * inventar segurança — exatamente o que este arquivo existe para impedir.
 */
const SUPORTA_VERIFICACAO: Record<CexId, boolean> = {
  binance:  true,   // sapi/v1/account/apiRestrictions
  bybit:    true,   // v5/user/query-api
  okx:      true,   // v5/account/config → permissões da chave
  kucoin:   true,   // v1/user/api-key
  coinbase: false,
  kraken:   false,
  bitfinex: false,
  mexc:     false,
  gateio:   false,
  htx:      false,
};

export function suportaVerificacao(id: CexId): boolean {
  return SUPORTA_VERIFICACAO[id] === true;
}

/**
 * Lê a permissão de saque de uma resposta de corretora.
 *
 * ⚠️ SEPARADO DA CHAMADA DE REDE de propósito: é a parte que decide, e decisão
 * sem teste é como o `readOnly` nasceu fixo em `true` e ninguém percebeu.
 *
 * ⚠️ E O DEFAULT É O PESSIMISTA. Campo ausente devolve `nao_verificavel`, nunca
 * `so_negocia`. Um formato de resposta que mude do outro lado não pode virar
 * "chave segura" em silêncio.
 */
export function lerPermissao(id: CexId, resposta: unknown): PermissaoChave {
  if (!suportaVerificacao(id)) {
    return {
      veredito: "nao_verificavel", suportado: false,
      detalhe: `${id} não expõe permissão de chave em endpoint público da API`,
    };
  }
  if (resposta == null || typeof resposta !== "object") {
    return {
      veredito: "nao_verificavel", suportado: true,
      detalhe: "resposta vazia ou fora do formato esperado",
    };
  }
  /**
   * ⚠⚠ O ENVELOPE DA CORRETORA — achado A16 da auditoria externa, e maior do
   * que ele descreve.
   *
   * A versão anterior lia os campos no TOPO da resposta. Três das quatro
   * corretoras envelopam o corpo, então o campo vinha `undefined` e o veredito
   * saía `nao_verificavel` SEMPRE — para toda chave, inclusive as que sacam.
   *
   * ⚠️ FALHA SEGURO, MAS NÃO FUNCIONA. `nao_verificavel` não libera nada (é a
   * doutrina do topo deste arquivo), então ninguém ficou exposto por um default
   * otimista. O que aconteceu foi pior de outro jeito: o controle que este
   * arquivo existe para ter — avisar que a chave SACA — nunca disparou nessas
   * três, e a tela dizia "não consegui verificar" achando que era limitação da
   * corretora.
   *
   * ⚠⚠ E O TESTE CODIFICAVA O DEFEITO: ele alimentava `{ permissions: {...} }`
   * e `{ perm: "..." }` no topo, formatos que corretora nenhuma envia. Teste e
   * código concordavam, e os dois discordavam da realidade — quebrar a trava
   * nos dois sentidos nunca acharia isto.
   *
   * Os envelopes abaixo têm EVIDÊNCIA na fonte do ccxt vendido em
   * `node_modules`, não na minha memória:
   *
   *   bybit  `{ retCode, result: { permissions: {…} } }`   (bybit.js:1432)
   *   okx    `{ code, data: [ { perm: "read_only,withdraw,trade" } ] }` (okx.js:1620)
   *   kucoin `{ code: "200000", data: {…} }`               (71 leituras de `data`)
   *
   * ⚠️ BINANCE FICA COMO ESTÁ. `sapi/v1/account/apiRestrictions` devolve o
   * objeto direto, e eu NÃO achei evidência no ccxt para confirmar. Não mexo no
   * que não verifiquei.
   */
  const env = resposta as Record<string, unknown>;
  const r = (
    id === "bybit"  ? env.result
    : id === "okx"  ? (Array.isArray(env.data) ? env.data[0] : undefined)
    : id === "kucoin" ? env.data
    : env
  ) as Record<string, unknown> | undefined;

  if (r == null || typeof r !== "object") {
    return {
      veredito: "nao_verificavel", suportado: true,
      detalhe: `corpo ausente no envelope de ${id}`,
    };
  }

  /**
   * Os nomes de campo por corretora. Achatados num só lugar para a leitura ser
   * conferível — e `undefined` (campo ausente) é tratado diferente de `false`.
   *
   * ⚠️ BYBIT VARRE TODOS OS GRUPOS. A permissão de saque não mora numa chave
   * fixa: o ccxt documenta grupos como `Wallet`, `Exchange`, `NFT`, e o próprio
   * código dele cita os nomes "Account Transfer", "Subaccount Transfer" e
   * "Withdrawal" (bybit.js:9772). Procurar só por `permissions.Withdraw` erra
   * quando a Bybit guarda o saque em outro grupo — e errar aqui é deixar passar
   * chave que saca.
   */
  const bruto =
    id === "binance" ? r.enableWithdrawals
    : id === "bybit" ? achatarPermissoesBybit(r.permissions)
    : id === "okx" ? r.perm
    : id === "kucoin" ? r.permission
    : undefined;

  if (bruto === undefined || bruto === null) {
    return {
      veredito: "nao_verificavel", suportado: true,
      detalhe: `campo de permissão ausente na resposta de ${id}`,
    };
  }

  const podeSacar =
    typeof bruto === "boolean" ? bruto
    : Array.isArray(bruto) ? bruto.length > 0
    : typeof bruto === "string" ? /withdraw/i.test(bruto)
    : null;

  if (podeSacar === null) {
    return {
      veredito: "nao_verificavel", suportado: true,
      detalhe: `permissão de ${id} veio num formato que não sei ler: ${typeof bruto}`,
    };
  }
  return podeSacar
    ? { veredito: "pode_sacar", suportado: true, detalhe: `${id} confirma permissão de SAQUE nesta chave` }
    : { veredito: "so_negocia", suportado: true, detalhe: `${id} confirma que a chave não saca` };
}

/**
 * Junta todos os grupos de permissão da Bybit num texto só.
 *
 * ⚠️ `undefined` quando não há objeto de permissões — e `undefined` vira
 * `nao_verificavel` lá em cima, nunca "não saca".
 *
 * ⚠️ Objeto de permissões VAZIO devolve string vazia, que é legítimo: a Bybit
 * respondeu e não listou poder nenhum. Isso é `so_negocia`, não "não sei".
 */
function achatarPermissoesBybit(p: unknown): string | undefined {
  if (p == null || typeof p !== "object") return undefined;
  const partes: string[] = [];
  for (const v of Object.values(p as Record<string, unknown>)) {
    if (Array.isArray(v)) partes.push(...v.map(String));
    else if (typeof v === "string") partes.push(v);
  }
  return partes.join(",");
}

/** As chamadas por corretora. Nome do método privado do ccxt, declarado. */
const METODO: Partial<Record<CexId, string>> = {
  binance:  "sapiGetAccountApiRestrictions",
  bybit:    "privateGetV5UserQueryApi",
  okx:      "privateGetAccountConfig",
  kucoin:   "privateGetUserApiKey",
};

/**
 * Pergunta à corretora se esta chave pode sacar.
 *
 * ⚠️ NUNCA LANÇA. Falha de rede vira `nao_verificavel` com o motivo — e
 * `nao_verificavel` NÃO libera nada. Ver a nota do topo.
 */
export async function verificarChave(
  id: CexId, creds: CexCredentials,
): Promise<PermissaoChave> {
  if (!suportaVerificacao(id)) return lerPermissao(id, null);
  const metodo = METODO[id];
  if (!metodo) {
    return {
      veredito: "nao_verificavel", suportado: true,
      detalhe: `sem método declarado para ${id}`,
    };
  }
  try {
    const Klass = (ccxt as unknown as Record<string, new (c: unknown) => unknown>)[id];
    if (!Klass) {
      return { veredito: "nao_verificavel", suportado: true, detalhe: `ccxt não expõe ${id}` };
    }
    const ex = new Klass({
      apiKey: creds.apiKey, secret: creds.apiSecret,
      password: creds.passphrase, enableRateLimit: true,
    }) as Record<string, unknown>;
    const fn = ex[metodo];
    if (typeof fn !== "function") {
      return {
        veredito: "nao_verificavel", suportado: true,
        detalhe: `${metodo} não existe nesta versão do ccxt`,
      };
    }
    const bruta = await (fn as (p?: unknown) => Promise<unknown>).call(ex, {});
    /**
     * ⚠⚠ A RESPOSTA VAI CRUA — o desembrulho é UM SÓ, e mora em
     * `lerPermissao` (achado do revisor no #439).
     *
     * Aqui havia um pré-desembrulho `bruta.data?.[0] ?? bruta` com o comentário
     * *"OKX e Bybit embrulham em `data: [...]`"*. O comentário estava errado
     * sobre a Bybit — ela embrulha em `result` — e por isso só a OKX era
     * desembrulhada de fato.
     *
     * ⚠️ E EU NÃO TINHA LIDO ESTA LINHA quando escrevi o #439. Concluí "3 das 4
     * quebradas" olhando só `lerPermissao`: eram DUAS (bybit e kucoin), a OKX
     * funcionava por causa deste pré-desembrulho — e meu envelope passou a
     * desembrulhá-la DUAS vezes, quebrando o que estava certo.
     *
     * Dois desembrulhos em lugares diferentes é a porta dos fundos de sempre.
     * Agora é um, na função PURA, que é a que tem teste.
     */
    return lerPermissao(id, bruta);
  } catch (e) {
    return {
      veredito: "nao_verificavel", suportado: true,
      detalhe: `falha ao consultar ${id}: ${String(e).slice(0, 80)}`,
    };
  }
}

/**
 * ⚠️ A DECISÃO, separada da leitura.
 *
 * Guardar credencial no servidor para negociar sozinho só é aceitável com a
 * chave provada incapaz de sacar. `pode_sacar` BLOQUEIA. `nao_verificavel` não
 * bloqueia — bloquear inviabilizaria seis das dez corretoras — mas tem que
 * chegar ao usuário como aviso explícito, nunca como silêncio.
 */
export interface DecisaoArmar {
  permitido: boolean;
  aviso: string | null;
  motivo: string;
}

export function decidirArmar(p: PermissaoChave): DecisaoArmar {
  if (p.veredito === "pode_sacar") {
    return {
      permitido: false, aviso: null,
      motivo: "esta chave PODE SACAR. Guardá-la no servidor para operar sozinha "
        + "colocaria seus fundos ao alcance de quem invadir o servidor. Crie uma chave "
        + `sem permissão de saque e tente de novo. (${p.detalhe})`,
    };
  }
  if (p.veredito === "nao_verificavel") {
    return {
      permitido: true,
      aviso: "⚠️ NÃO CONSEGUIMOS VERIFICAR se esta chave pode sacar — "
        + `${p.detalhe}. Confira você mesmo no painel da corretora antes de deixar `
        + "o autopilot rodando com o navegador fechado.",
      motivo: "permissão não verificável; seguiu com aviso explícito",
    };
  }
  return { permitido: true, aviso: null, motivo: p.detalhe };
}
