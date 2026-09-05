/**
 * O DONO — o tipo que impede o vazamento antes de ele ser escrito.
 *
 * ⚠️⚠️ QUAL É O ATAQUE REAL, de verdade.
 *
 * Não é alguém lendo o banco. O anon key não alcança estas tabelas (RLS ligada,
 * zero policies) e a service key só vive no servidor. O ataque real é banal:
 *
 *     POST /api/bancada/estrategias  { "dono": "0xcarteira-da-vitima", ... }
 *
 * — o cliente MANDANDO de quem é a linha. Uma rota que aceite `dono` do corpo
 * entrega o laboratório inteiro de qualquer carteira a qualquer um, e nenhuma
 * policy de banco jamais veria isso: do ponto de vista do Postgres a consulta
 * está perfeitamente filtrada, só que pelo valor errado.
 *
 * ⚠️ POR ISSO `Dono` É UM TIPO MARCADO. Uma `string` não é um `Dono`; só
 * `donoDaSessao()` e `donoDeLinhaDoBanco()` produzem um. `req.json().dono` é
 * `unknown`, e passá-lo para o store NÃO COMPILA.
 *
 * A marca não existe em tempo de execução — some na compilação, custa zero.
 * O que ela faz é mover o erro de "vazamento em produção" para "erro de tipo no
 * CI", que é o único lugar barato de errar.
 *
 * ⚠️ E É AQUI QUE A MIGRATION 0037 APONTA. A promessa original do plano era uma
 * policy `using (dono = auth.jwt() ->> 'sub')`. Ela não funcionaria: a sessão
 * desta casa é um JWT nosso verificado no Node (`auth/session.ts`), que nunca
 * chega ao banco, e quem consulta usa a service key, que ignora RLS. Escrever
 * aquela policy seria criar uma trava desligada do caminho que decide — o
 * defeito exato que esta base já pagou seis vezes. O isolamento é real, mas
 * mora nesta camada, e o cabeçalho da migration diz isso por extenso.
 */

import type { SessionClaims } from "@/lib/auth/session";
import type { WalletChain } from "@/lib/supabase/types";

declare const marcaDeDono: unique symbol;

/** Uma carteira cuja procedência já foi verificada. Não se constrói de string. */
export type Dono = string & { readonly [marcaDeDono]: "carteira verificada" };

export interface DonoVerificado {
  dono: Dono;
  chain: WalletChain;
}

/**
 * O único caminho de entrada por REQUISIÇÃO: a carteira sai do `sub` do cookie
 * de sessão, que foi assinado por nós e verificado antes de chegar aqui.
 *
 * ⚠️ DEVOLVE `null` SEM SESSÃO, e quem chama tem de tratar. Um valor de
 * fallback ("anon", "") faria linhas de gente diferente compartilharem dono.
 *
 * ⚠️ A CARTEIRA VAI VERBATIM PARA O BANCO — sem `toLowerCase()`. `quotaBucket`
 * baixa a caixa porque uma chave de contagem pode perder informação; uma coluna
 * de DONO não pode. Endereço Solana é base58, onde 'A' e 'a' são caracteres
 * DIFERENTES: baixar a caixa devolve algo que não é mais um endereço válido, e
 * duas carteiras distintas podem colidir na mesma chave. É o mesmo verbatim que
 * `operations.wallet_address` e `cex_conexoes` já usam.
 */
export function donoDaSessao(claims: SessionClaims | null | undefined): DonoVerificado | null {
  const sub = claims?.sub;
  if (typeof sub !== "string") return null;
  const limpo = sub.trim();
  if (limpo.length === 0) return null;
  const chain = claims?.chain;
  if (chain !== "evm" && chain !== "solana") return null;
  return { dono: limpo as Dono, chain };
}

/**
 * O outro caminho — e o nome é longo de propósito.
 *
 * ⚠️ SÓ PARA CARTEIRA QUE VEIO DO PRÓPRIO BANCO. O cron do papel adiante varre
 * as posições abertas de TODO MUNDO e precisa reabrir cada uma como o dono
 * dela; ali a carteira não vem de requisição nenhuma, vem da linha.
 *
 * ⚠️ CHAMAR ISTO COM ALGO DE UMA REQUISIÇÃO ANULA A CAMADA INTEIRA. O nome
 * existe para que esse uso errado seja legível na linha da chamada, numa
 * revisão, sem precisar abrir este arquivo.
 */
export function donoDeLinhaDoBanco(carteiraGravada: string): Dono | null {
  if (typeof carteiraGravada !== "string") return null;
  const limpo = carteiraGravada.trim();
  return limpo.length > 0 ? (limpo as Dono) : null;
}
