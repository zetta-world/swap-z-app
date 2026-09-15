/**
 * AS FONTES DE COTAÇÃO QUE O MOTOR REALMENTE CONSULTA — achado A02.
 *
 * ⚠️⚠️ A HOME AFIRMAVA "14 rotas avaliadas", com o 14 escrito à mão no JSX:
 *
 *     <Chip label={t("swap.chipRoutes", { n: 14 })} />
 *
 * Nada foi avaliado. O visitante não escolheu par nenhum, não há cotação, e o
 * número não sai de lugar algum do código — era constante com cara de medição.
 *
 * ⚠️ E O 14 NÃO É NEM O TETO. `/api/quote` em `mode=list` despacha TRÊS fontes,
 * e elas são MUTUAMENTE EXCLUSIVAS pelo par de cadeias:
 *
 *     0x        mesma cadeia, EVM          (cross-chain é recusado)
 *     LiFi      SÓ entre cadeias           (mesma cadeia é pura redundância)
 *     Jupiter   mesma cadeia, Solana
 *
 * Para qualquer par concreto, no máximo UMA delas dispara. O número exibido não
 * era só inventado — ele era inalcançável.
 *
 * ⚠️ A CoW NÃO É FONTE DE COTAÇÃO, e o `StatPanel` a contava como uma, dizendo
 * "4 DEX Aggregators". Ela é a venue de ORDEM LIMITADA (`src/lib/limit/cow.ts`);
 * `/api/quote` não a consulta em caminho nenhum. Integração real, categoria
 * errada — e a lista literal do painel tinha derivado sem ninguém notar.
 *
 * Esta lista existe para que o número na tela SAIA do que o motor faz. Somar
 * uma fonte aqui sem ligá-la no `/api/quote` quebra `fontes.test.ts`.
 */

export type IdDaFonte = "0x" | "lifi" | "jupiter";

export interface FonteDeCotacao {
  id: IdDaFonte;
  nome: string;
  /** Quando ela é consultada — ver o despacho em `/api/quote` `mode=list`. */
  alcance: "mesma cadeia · EVM" | "entre cadeias" | "mesma cadeia · Solana";
}

export const FONTES_DE_COTACAO: readonly FonteDeCotacao[] = [
  { id: "0x",      nome: "0x",      alcance: "mesma cadeia · EVM" },
  { id: "lifi",    nome: "LiFi",    alcance: "entre cadeias" },
  { id: "jupiter", nome: "Jupiter", alcance: "mesma cadeia · Solana" },
] as const;

/** Os nomes, para a legenda da tela. */
export const NOMES_DAS_FONTES = FONTES_DE_COTACAO.map((f) => f.nome).join(" · ");
