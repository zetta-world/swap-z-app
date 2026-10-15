/**
 * ⚠️⚠️ A FRONTEIRA DE NORMALIZAÇÃO DE ENDEREÇO (auditoria externa A31, 14/09).
 *
 * Endereço EVM é hex: maiúscula e minúscula são o MESMO endereço (o checksum é
 * só apresentação). Endereço Solana é base58: o case É a identidade — mudar uma
 * letra muda os bytes e aponta para OUTRA conta (`bs58.decode` prova).
 *
 * Antes, o cliente (`useTokenPrices`), a rota `/api/prices` e as consultas à
 * GeckoTerminal punham TODO endereço em minúsculas. Para EVM nada mudava; para
 * Solana o pedido saía com um mint inexistente e o preço voltava `null` — em
 * produção, USDC Solana sem preço e USDC Ethereum a 1,001 (medido 14/10). E o
 * vigia de ordens montava a chave SEM normalizar, então nem o EVM com checksum
 * achava o preço que a rota devolvia em minúsculas.
 *
 * Uma regra só, usada por todos: hex `0x…` → minúsculas; qualquer outra coisa
 * (base58, `native`) passa EXATAMENTE como veio.
 */

const HEX_EVM = /^0x[0-9a-fA-F]+$/;

/** O endereço na forma canônica para chave e consulta. */
export function enderecoCanonico(endereco: string): string {
  return HEX_EVM.test(endereco) ? endereco.toLowerCase() : endereco;
}

/** A chave do mapa de preços: `"<chain>:<endereço canônico>"`. */
export function chaveDePreco(chain: string, endereco: string): string {
  return `${chain.toLowerCase()}:${enderecoCanonico(endereco)}`;
}
