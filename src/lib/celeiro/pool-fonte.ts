/**
 * A FONTE DO POOL NOVO — de onde vêm os fatos que o portão exige.
 *
 * ⚠️⚠️ POR QUE ESTE MÓDULO ATRASOU O AGENTE (21/08). O `portaoDeSobrevivencia`
 * existia e estava testado, e o Pool Novo mesmo assim ficou fora do cron —
 * porque nada no repositório respondia às perguntas dele: a liquidez está
 * travada? quanto o top 10 detém? dá para vender?
 *
 * Ligá-lo com esses portões devolvendo "ok" teria sido pior que não rodar: o
 * agente apostaria em pool sem verificar nada, **com a aparência de estar
 * protegido**. É exatamente o defeito do "escudo MEV" que era adesivo — flag
 * lida só por quem a desenhava, nenhuma linha do caminho de execução olhando.
 *
 * ⚠️ E AS TRÊS FONTES JÁ EXISTIAM. `getNewPoolsForChain`, `getPairDetail` e
 * `getTokenSecurity` estão no repositório há meses, servindo a outras telas.
 * O que faltava era a PONTE — e procurar antes de escrever economizou três
 * integrações.
 */

import { getTokenSecurity, isGoPlusSupported, type GoPlusTokenSecurity } from "@/lib/api/goplus";
import { getPairDetail } from "@/lib/api/dexscreener";
import { getNewPoolsForChain, type PoolSummary } from "@/lib/api/geckoterminal";
import type { Pool } from "@/lib/celeiro/pool-novo";

/**
 * A liquidez está travada?
 *
 * ⚠️ AUSÊNCIA DE PROVA NÃO É PROVA DE TRAVA — e o portão continua REPROVANDO
 * quando não dá para medir. Um pool cuja trava ninguém verificou é, para efeito
 * de decisão, indistinguível de um pool sem trava: quem criou pode retirar a
 * liquidez a qualquer momento.
 *
 * ⚠️⚠️ MAS TRÊS RESPOSTAS, NÃO DUAS (07/09) — e a diferença é de DIAGNÓSTICO,
 * não de decisão.
 *
 * A versão anterior devolvia `boolean`, colapsando "medi e NÃO está travada" com
 * "a fonte não me devolveu os detentores de LP". As duas reprovam igual, e é
 * certo que reprovem — mas com a mesma frase na recusa **não dá para saber qual
 * das duas está acontecendo**.
 *
 * Isso custou caro: em 18 dias o agente examinou 5.004 pools e aprovou zero,
 * com 92,4% dos que chegaram ao portão barrados por esta linha. Com uma frase
 * só, não há como decidir entre "o mercado da Base é assim mesmo" (nada a
 * fazer) e "a GoPlus não indexa LP nesta chain" (troca de fonte ou de chain).
 * Instrumento que não separa as duas é instrumento que manda ajustar às cegas.
 *
 * ⚠️ É a mesma disciplina que `concentracaoTop10` já tinha ao lado: `null` para
 * "não medi". Ela estava certa e esta estava errada, no mesmo arquivo.
 *
 * ⚠️ E "QUEIMADO" CONTA COMO TRAVADO. LP enviado para endereço morto não volta —
 * é a trava mais forte que existe, e a GoPlus a marca com `tag` de burn.
 */
export function liquidezTravada(sec: GoPlusTokenSecurity | null): boolean | null {
  const lps = sec?.lp_holders;
  // ⚠️ `null` = NÃO MEDI. O portão trata como reprovação, igual a `false`.
  if (!Array.isArray(lps) || lps.length === 0) return null;

  const travadoPct = lps.reduce((s, h) => {
    const pct = Number(h.percent);
    if (!Number.isFinite(pct)) return s;
    const morto = /burn|black.?hole|dead|null/i.test(h.tag ?? "");
    return s + (h.is_locked === 1 || morto ? pct : 0);
  }, 0);

  // Metade travada já impede a retirada que mata o pool de uma vez.
  return travadoPct >= 0.5;
}

/**
 * A fração do supply nas 10 maiores carteiras.
 *
 * ⚠️ `null` QUANDO NÃO DEU PARA MEDIR, e o portão reprova nisso. Devolver 0
 * diria "pulverizado" — a leitura mais otimista possível a partir de nenhuma
 * informação, e a mais cara quando estiver errada.
 *
 * ⚠️ CARTEIRA TRAVADA OU QUEIMADA SAI DA CONTA. Supply em contrato de trava ou
 * em endereço morto não vai ser vendido; contá-lo como concentração reprovaria
 * pools honestos por um risco que não existe.
 */
export function concentracaoTop10(sec: GoPlusTokenSecurity | null): number | null {
  const hs = sec?.holders;
  if (!Array.isArray(hs) || hs.length === 0) return null;

  const soma = hs.slice(0, 10).reduce((s, h) => {
    const pct = Number(h.percent);
    if (!Number.isFinite(pct)) return s;
    const morto = /burn|black.?hole|dead|null|lock/i.test(h.tag ?? "");
    return s + (h.is_locked === 1 || morto ? 0 : pct);
  }, 0);

  return Math.min(1, Math.max(0, soma));
}

/**
 * A venda de teste passou?
 *
 * ⚠️ TRÊS RESPOSTAS, NÃO DUAS. `true` dá para sair, `false` não dá, e `null`
 * ninguém conseguiu simular — que o portão trata como o caso MAIS perigoso,
 * porque é exatamente o que um honeypot produz.
 *
 * ⚠️ IMPOSTO DE VENDA ALTO É "NÃO DÁ PARA SAIR" na prática. Um token com 40% de
 * taxa de venda tecnicamente permite vender e economicamente não — e o portão
 * precisa da resposta econômica.
 */
export const TETO_IMPOSTO_DE_VENDA = Number(process.env.CELEIRO_POOL_SELL_TAX_MAX ?? 0.1);

export function vendaTestePassou(sec: GoPlusTokenSecurity | null): boolean | null {
  if (!sec) return null;

  const honeypot = sec.is_honeypot;
  const naoVendeTudo = sec.cannot_sell_all;
  const taxa = Number(sec.sell_tax);

  // Nenhum dos três campos veio: a simulação não aconteceu.
  if (honeypot === undefined && naoVendeTudo === undefined && !Number.isFinite(taxa)) return null;

  if (honeypot === "1" || naoVendeTudo === "1") return false;
  if (Number.isFinite(taxa) && taxa > TETO_IMPOSTO_DE_VENDA) return false;
  return true;
}

/** Monta o `Pool` que o portão consome. Função pura — o teste vive sem rede. */
export function montarPool(
  sec: GoPlusTokenSecurity | null,
  liquidezUsd: number,
  idadeMinutos: number,
): Pool {
  return {
    liquidezUsd: Number.isFinite(liquidezUsd) && liquidezUsd > 0 ? liquidezUsd : 0,
    liquidezTravada: liquidezTravada(sec),
    concentracaoTop10: concentracaoTop10(sec),
    vendaTestePassou: vendaTestePassou(sec),
    idadeMinutos: Number.isFinite(idadeMinutos) && idadeMinutos > 0 ? idadeMinutos : 0,
  };
}

export interface Candidato {
  chain: string;
  poolAddress: string;
  tokenAddress: string;
  nome: string;
  pool: Pool | null;
  /**
   * ⚠️ POR QUE NÃO DEU PARA LER — presente só quando `pool` é `null`.
   *
   * "Não lido" tinha quatro causas distintas colapsadas numa frase só, e as
   * quatro pediam ações opostas: cadeia sem cobertura (nunca vai funcionar),
   * candidato montado errado (defeito nosso), e cada uma das duas fontes fora
   * do ar (esperar). Sem separá-las, dez dias de falha determinística passaram
   * por "as fontes andam instáveis".
   */
  porqueNaoLeu?: string;
}

/**
 * Lê um candidato completo: liquidez e idade da dexscreener, segurança da GoPlus.
 *
 * ⚠️ CADEIA SEM SUPORTE NA GOPLUS DEVOLVE `pool: null`, e o portão reprova. Não
 * dá para verificar honeypot numa rede que a fonte não cobre — e apostar ali
 * seria operar exatamente onde a proteção não alcança.
 */
export async function lerCandidato(
  chain: string,
  poolAddress: string,
  tokenAddress: string,
  nome: string,
  agoraMs: number = Date.now(),
): Promise<Candidato> {
  const base: Candidato = { chain, poolAddress, tokenAddress, nome, pool: null };
  if (!isGoPlusSupported(chain)) {
    return { ...base, porqueNaoLeu: `cadeia ${chain} não é coberta pela GoPlus — sem verificar honeypot não se aposta` };
  }
  /**
   * ⚠️ ENDEREÇO IGUAL AO DO POOL É DEFEITO DE MONTAGEM, e foi ELE que manteve
   * este agente em zero por dez dias. A GoPlus perguntada sobre um contrato de
   * pool devolve vazio, e o "não lido" resultante parecia falha de rede.
   */
  if (tokenAddress.toLowerCase() === poolAddress.toLowerCase()) {
    return { ...base, porqueNaoLeu: "endereço do token igual ao do pool — o candidato foi montado errado, não é falha da fonte" };
  }

  const [par, sec] = await Promise.all([
    getPairDetail(chain, poolAddress).catch(() => null),
    getTokenSecurity(chain, tokenAddress).catch(() => null),
  ]);

  /**
   * ⚠️⚠️ QUAL FONTE FALHOU, E NÃO SÓ QUE FALHOU (30/08).
   *
   * Antes as duas colapsavam num `pool: null` e o portão dizia "pool não lido"
   * para tudo: cadeia sem cobertura, dexscreener muda, GoPlus muda e candidato
   * montado errado davam a MESMA frase. Com 100% das recusas iguais, ninguém
   * conseguia ver que nenhuma delas era um julgamento sobre o pool.
   */
  if (!par || !sec) {
    const quais = [!par ? "dexscreener" : null, !sec ? "goplus" : null].filter(Boolean).join(" e ");
    return { ...base, porqueNaoLeu: `${quais} não respondeu para este candidato` };
  }

  const idadeMinutos = par.pairCreatedAt > 0
    ? (agoraMs - par.pairCreatedAt) / 60_000
    : 0;

  return { ...base, pool: montarPool(sec, par.liquidity.usd, idadeMinutos) };
}

/**
 * Os pools recém-criados que valem examinar.
 *
 * ⚠️ O ENDEREÇO DO TOKEN VEM DO ID DO POOL na GeckoTerminal (`rede_endereço`),
 * e o token que interessa é o BASE — o quote é a moeda de cotação (WETH, USDT)
 * e checar segurança dela seria auditar a moeda errada, aprovando qualquer coisa.
 */
export function candidatosDe(pools: readonly PoolSummary[]): Array<Omit<Candidato, "pool">> {
  const out: Array<Omit<Candidato, "pool">> = [];
  for (const p of pools) {
    const endereco = (p.address ?? "").trim();
    if (!endereco) continue;
    /**
     * ⚠️⚠️ O TOKEN BASE VEM DE `baseTokenAddress`, e a versão anterior o
     * inventava a partir do id do POOL — `id.split("_")[1]`. O id da
     * GeckoTerminal é `<rede>_<endereço do POOL>`: o token não está lá. O
     * resultado era `tokenAddress === poolAddress` em TODOS os candidatos, e a
     * GoPlus não devolve segurança de um contrato de pool.
     *
     * Dez dias, zero posições, e o relatório dizendo "pool não lido" — que soa
     * transitório. Ver `extrairEndereco` em `geckoterminal.ts`.
     *
     * ⚠️ SEM O ENDEREÇO, O CANDIDATO NÃO ENTRA. Cair de volta no endereço do
     * pool reproduziria o defeito com outro nome; é melhor um candidato a menos
     * que um candidato que nunca pode ser julgado.
     */
    const token = (p.baseTokenAddress ?? "").trim();
    if (!token || token.toLowerCase() === endereco.toLowerCase()) continue;
    out.push({
      chain: p.network,
      poolAddress: endereco,
      tokenAddress: token,
      nome: p.name || `${p.baseSymbol}/${p.quoteSymbol}`,
    });
  }
  return out;
}

export { getNewPoolsForChain };
