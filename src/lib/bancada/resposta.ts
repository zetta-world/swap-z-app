/**
 * O QUE A TELA RECEBE — e como as DUAS respostas viram a MESMA coisa.
 *
 * ⚠️⚠️ A bancada lê a mesma rodada por dois canais: o `POST /backtest`, que
 * responde na hora, e o `GET /rodadas`, que a relê do banco depois. Se cada um
 * fosse desembrulhado no seu canto, a rodada mudaria de cara ao recarregar a
 * página — e mudaria em silêncio, porque nada compara os dois.
 *
 * Aqui os dois viram `Medida`, e o cartão da tela só conhece `Medida`.
 *
 * ⚠️ É PURO E FORA DO `.tsx` de propósito: o vitest desta base roda em
 * `environment: "node"`, e lógica que mora em componente é lógica sem teste.
 *
 * ⚠️ E NADA AQUI INVENTA NÚMERO. Campo ausente vira `null`, nunca 0 —
 * `Number(null)` é 0 e passa em `isFinite`, que é a cicatriz mais barata de
 * repetir nesta base. "Não medimos" e "medimos e deu zero" continuam
 * distinguíveis do outro lado.
 */

import { NAO_MEDIDO, type ChaveNaoMedido } from "@/lib/bancada/veredito";

export type VereditoDaTela = "perdeu" | "ganhou" | "ganhou_perdendo_do_indice" | "ruido";

export interface Medida {
  veredito: VereditoDaTela;
  n: number;
  acertos: number;
  brutoPct: number;
  taxaPct: number;
  liquidoPct: number;
  equilibrioPct: number | null;
  competidorPct: number | null;
  naoMedidoChaves: ChaveNaoMedido[];
  naoMedidoTexto: string[];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** ⚠️ `null` sobrevive. Ver o cabeçalho. */
function numOuNulo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function veredito(v: unknown): VereditoDaTela {
  return v === "perdeu" || v === "ganhou" || v === "ganhou_perdendo_do_indice" ? v : "ruido";
}

/**
 * ⚠️ SÓ CHAVE CONHECIDA ENTRA. Uma chave desconhecida (banco mais novo que a
 * tela, ou o contrário) sairia como `undefined` na tabela de tradução e a
 * ressalva viraria um marcador vazio — pior que ausente, porque parece medido.
 */
function chaves(v: unknown): ChaveNaoMedido[] {
  if (!Array.isArray(v)) return [];
  const validas = Object.keys(NAO_MEDIDO) as ChaveNaoMedido[];
  const out: ChaveNaoMedido[] = [];
  for (const k of v) {
    const achada = validas.find((c) => c === k);
    if (achada && !out.includes(achada)) out.push(achada);
  }
  return out;
}

function textos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * A resposta do `POST /api/bancada/backtest`.
 *
 * ⚠️ `liquidoCompostoPct`, NUNCA a soma aritmética dos retornos. Somar `Σ` de
 * retornos por trade e comparar com o retorno de janela do competidor infla a
 * estratégia quanto mais ela opera — ver a nota em `veredito.ts`.
 */
export function medidaDoPost(corpo: unknown): Medida | null {
  const o = (corpo ?? {}) as Record<string, unknown>;
  const v = (o.veredito ?? null) as Record<string, unknown> | null;
  const r = (o.resumo ?? null) as Record<string, unknown> | null;
  if (!v || !r) return null;
  return {
    veredito: veredito(v.veredito),
    n: num(r.n),
    acertos: num(r.acertos),
    brutoPct: num(r.brutoPct),
    taxaPct: num(r.taxaPct),
    liquidoPct: num(r.liquidoCompostoPct),
    equilibrioPct: numOuNulo(v.equilibrioPct),
    competidorPct: numOuNulo(v.competidorPct),
    naoMedidoChaves: chaves(v.naoMedidoChaves),
    /**
     * ⚠️⚠️ `naoMedidoTexto`, NUNCA `naoMedido`. O segundo é a SOMA de duas
     * listas — a prosa das chaves mais os problemas daquela leitura — e é essa
     * soma que vai para o banco, para quem abrir o Postgres ler. Desembrulhá-la
     * aqui mostraria toda ressalva duas vezes: uma traduzida pela chave e outra
     * em português cru. O teste de igualdade entre os dois canais pegou isto.
     */
    naoMedidoTexto: textos(v.naoMedidoTexto),
  };
}

/** Uma linha `resultado` do `GET /api/bancada/rodadas`. */
export function medidaDoHistorico(corpo: unknown): Medida | null {
  if (corpo == null) return null;
  const o = corpo as Record<string, unknown>;
  return {
    veredito: veredito(o.veredito),
    n: num(o.n),
    acertos: num(o.acertos),
    brutoPct: num(o.brutoPct),
    taxaPct: num(o.taxaPct),
    liquidoPct: num(o.liquidoPct),
    equilibrioPct: numOuNulo(o.equilibrioPct),
    competidorPct: numOuNulo(o.competidorPct),
    naoMedidoChaves: chaves(o.naoMedidoChaves),
    naoMedidoTexto: textos(o.naoMedidoTexto),
  };
}

/**
 * ⚠️ A TAXA DE ACERTO SAI DE `n`, e `n = 0` devolve `null` — não 0%.
 *
 * "Nenhuma operação" e "todas erradas" são estados diferentes, e o segundo é
 * bem pior. Uma divisão por zero silenciosa apagaria a diferença.
 */
export function acertoPct(m: Medida): number | null {
  return m.n > 0 ? (m.acertos / m.n) * 100 : null;
}
