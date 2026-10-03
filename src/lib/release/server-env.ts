import catalogo from "./server-env.catalog.json";

/**
 * VARIÁVEIS DE SERVIDOR QUE O ALVO DE RELEASE EXIGE — só nomes, nunca valores.
 *
 * Nasceu da reconciliação ao vivo de 03/10 (L-029): o alvo `53cd85a` exige
 * `CEX_RECOVERY_HMAC_KEY` e ela não estava na Vercel; o runbook do ensaio dizia
 * "nenhum segredo novo" (errata RB-01). O ensaio local não pegou porque o
 * laboratório tinha a variável.
 *
 * ⚠️ NENHUMA FUNÇÃO DAQUI DEVOLVE VALOR, TAMANHO OU HASH DE SEGREDO. O resultado
 * é a lista de NOMES presentes/ausentes. Quem precisa provar presença em outro
 * ambiente usa `scripts/release/check-env-names.mjs` com a lista de nomes
 * (por exemplo, a 1ª coluna de `vercel env ls`), sem ler nenhum valor.
 *
 * Escopos:
 *   · `release`     — sem ela, o release com gate fechado quebra ou falha fechado
 *   · `public_gate` — só a ABERTURA do early access precisa dela
 */
export type Escopo = "release" | "public_gate";

export interface VariavelExigida {
  nome:        string;
  escopo:      Escopo;
  evidencia:   string;
  ausencia:    string;
  minimo?:     number;
  novaNoAlvo?: boolean;
}

export const VARIAVEIS: readonly VariavelExigida[] = catalogo.variaveis as VariavelExigida[];

export interface AvaliacaoAmbiente {
  escopo:    Escopo;
  presentes: string[];
  ausentes:  string[];
}

/** Presente = string não vazia (e, se o código exige, com o tamanho mínimo). */
export function presente(v: VariavelExigida, valor: string | undefined): boolean {
  if (typeof valor !== "string" || valor.trim() === "") return false;
  return v.minimo === undefined || valor.length >= v.minimo;
}

/** Avalia um ambiente (por padrão `process.env`). Devolve só nomes. */
export function avaliarAmbiente(
  escopo: Escopo,
  env: Record<string, string | undefined> = process.env,
): AvaliacaoAmbiente {
  const presentes: string[] = [];
  const ausentes: string[] = [];
  for (const v of VARIAVEIS) {
    if (v.escopo !== escopo) continue;
    (presente(v, env[v.nome]) ? presentes : ausentes).push(v.nome);
  }
  return { escopo, presentes, ausentes };
}

/**
 * Para pré-voo SEM valores: recebe a lista de NOMES configurados num ambiente
 * hospedado e devolve os exigidos que faltam. `minimo` não pode ser checado
 * só pelo nome — por isso o check de auditoria em runtime continua necessário.
 */
export function faltandoPorNome(escopo: Escopo, nomesConfigurados: Iterable<string>): string[] {
  const tem = new Set(Array.from(nomesConfigurados, (n) => n.trim()).filter(Boolean));
  return VARIAVEIS.filter((v) => v.escopo === escopo && !tem.has(v.nome)).map((v) => v.nome);
}
