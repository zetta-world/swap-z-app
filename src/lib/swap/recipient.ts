import { isAddress } from "viem";
import { isBurnAddress } from "@/lib/validate";

/**
 * O DESTINATÁRIO DA PONTE — uma regra só, cliente e servidor.
 * (auditoria do setor ponte, 23/08)
 *
 * ⚠️⚠️ O DEFEITO QUE ESTE MÓDULO FECHA, e ele é de perda de fundo.
 *
 * Existiam TRÊS definições de "endereço válido" no caminho da ponte:
 *
 *   · `RecipientField`      → `viem.isAddress`, com checksum, conhece a rede
 *   · `BridgeWalletStatus`  → regex solta, sem checksum
 *   · `/api/quote`          → outra regex, `.toLowerCase()`, E SEM SABER A REDE
 *
 * A terceira é a que custava dinheiro. O caminho completo, reproduzido:
 *
 *   1. o usuário põe destino Solana e cola um endereço Solana — válido;
 *   2. troca o destino para Base. `setToToken` NÃO limpa o destinatário;
 *   3. o campo fica vermelho, mas a LOJA continua com o endereço Solana;
 *   4. `canExecute` não olhava validade de destinatário — o botão seguia vivo;
 *   5. `validateAddress` no servidor aceita base58 sem saber que o destino é
 *      EVM, e o endereço seguia para a LiFi como `toAddress`.
 *
 * Cinco camadas, e a única que reclamava era uma cor. Terceirizar a última
 * palavra para o agregador é exatamente o que o caminho do dinheiro não faz.
 *
 * ⚠️ MAIÚSCULAS SÃO ACEITAS, e isso é correção, não afrouxamento. O `isAddress`
 * do viem valida checksum EIP-55 — e `0xD8DA…045` todo em maiúsculas é um
 * endereço legítimo que ele REPROVA, porque caixa única não carrega checksum
 * nenhum para conferir. A regra certa: caixa mista tem checksum e ele é
 * exigido; caixa única não tem, e aí só o formato manda. Recusar endereço bom
 * é falha de segurança também — empurra o usuário para copiar de outro lugar.
 */

export type Familia = "evm" | "solana";

/** A família de endereço que uma rede usa. Tudo que não é Solana é EVM. */
export function familiaDaRede(chain: string | null | undefined): Familia {
  return chain === "solana" ? "solana" : "evm";
}

export type MotivoRecusa =
  /** Campo vazio — não é erro, é ausência: entrega na carteira conectada. */
  | "vazio"
  /** Não parece endereço de rede nenhuma. */
  | "formato"
  /** É endereço válido, da rede ERRADA. O caso que custava dinheiro. */
  | "familia"
  /** Formato bom, checksum EIP-55 não bate — quase sempre erro de digitação. */
  | "checksum"
  /** Endereço de queima: o dinheiro seria destruído. */
  | "queima";

export type VereditoDestinatario =
  | { ok: true;  endereco: string }
  | { ok: false; motivo: MotivoRecusa };

const EVM_FORMA    = /^0x[0-9a-fA-F]{40}$/;
const SOLANA_FORMA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Caixa mista ⇒ carrega checksum EIP-55 ⇒ tem de bater. */
const TEM_CHECKSUM = (s: string) => /[a-f]/.test(s.slice(2)) && /[A-F]/.test(s.slice(2));

/**
 * O veredito completo sobre um destinatário, para uma família de destino.
 *
 * ⚠️ A ORDEM DAS CHECAGENS É DELIBERADA: queima antes de família, porque
 * `0x000…000` é EVM bem-formado e diria "família certa" — e a mensagem que o
 * usuário precisa ler é "isto destrói o dinheiro", não "endereço aceito".
 */
export function conferirDestinatario(
  bruto: string | null | undefined,
  familia: Familia,
): VereditoDestinatario {
  if (typeof bruto !== "string") return { ok: false, motivo: "vazio" };
  const s = bruto.trim();
  if (s === "") return { ok: false, motivo: "vazio" };

  if (isBurnAddress(s)) return { ok: false, motivo: "queima" };

  const pareceEvm    = EVM_FORMA.test(s);
  const pareceSolana = SOLANA_FORMA.test(s);
  if (!pareceEvm && !pareceSolana) return { ok: false, motivo: "formato" };

  if (familia === "solana") {
    // ⚠️ `pareceSolana` primeiro: base58 aceita quase tudo, mas um `0x…` de 42
    // caracteres NUNCA é base58 válido (o `x` não está no alfabeto). Ainda
    // assim testamos o EVM antes para a mensagem sair específica.
    if (pareceEvm) return { ok: false, motivo: "familia" };
    return pareceSolana ? { ok: true, endereco: s } : { ok: false, motivo: "formato" };
  }

  if (!pareceEvm) return { ok: false, motivo: "familia" };
  // Caixa única não tem checksum para conferir; caixa mista tem e é exigido.
  if (TEM_CHECKSUM(s) && !isAddress(s)) return { ok: false, motivo: "checksum" };
  return { ok: true, endereco: s };
}

/** Atalho para os pontos que só querem sim/não. */
export function destinatarioValido(bruto: string | null | undefined, familia: Familia): boolean {
  return conferirDestinatario(bruto, familia).ok;
}
