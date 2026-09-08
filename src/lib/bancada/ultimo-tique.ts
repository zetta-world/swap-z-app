/**
 * O QUE O AGENTE ACABOU DE FAZER — e há quanto tempo.
 *
 * ⚠️⚠️ ESTE MÓDULO EXISTE POR UMA FRASE DO DONO (07/09), logo depois de
 * contratar a FREYJA: *"ao contratar o agente deveria aparecer aí no próprio
 * agente, as informações e resultados em tempo real"*.
 *
 * O card sabia dizer "esperando setup". É verdade e é inútil, porque não separa
 * as três coisas que o investidor precisa distinguir:
 *
 *   1. VERIFICOU e ficou de fora — e existe um motivo, que é a mesa trabalhando;
 *   2. AINDA NÃO VERIFICOU — contratado há 3 minutos, e o cron é de 30;
 *   3. QUEBRADO — parou de tickar e ninguém sabe.
 *
 * As três desenhavam a mesma tela. É a mesma família do Maker de Faixa, que
 * ficou dois dias sem abrir posição sem ninguém notar — e ali éramos NÓS, com
 * acesso ao banco.
 *
 * ⚠️ E NADA AQUI É "AO VIVO". O preço guardado é o fechamento da última vela que
 * o cron leu, e a idade dele viaja junto, sempre. Um número sem a idade cria a
 * expectativa de cotação — que esta bancada não tem e não promete.
 *
 * ⚠️ PURO: o vitest desta base roda em `environment: "node"`.
 */

/**
 * ⚠️⚠️ VOCABULÁRIO FECHADO DO MOTIVO — e a razão é a tela de um cliente pagante.
 *
 * A primeira versão guardava a string crua: `"ja_tem_posicao"`, `"aquecendo"`, e
 * — pior — `tentativas[0].reason`, um texto que vem do seletor da casa e que
 * NENHUM arquivo desta pasta controla. Renderizar isso põe `ja_tem_posicao` na
 * tela de um cliente chinês, e deixa o texto do admin vazar para a Bancada na
 * primeira entrega que o reescrever, sem ninguém notar.
 *
 * Com o union fechado a tela traduz nos quatro idiomas, e o que não for mapeado
 * cai em `outro` — nunca no inglês do seletor.
 */
export type MotivoDeNaoAbrir =
  /** Já há posição aberta nesse símbolo. Uma por vez, por construção. */
  | "ja_tem_posicao"
  /** Indicador ainda não nasceu — abaixo das 200 barras de aquecimento. */
  | "aquecendo"
  /** A vela do último sinal já foi avaliada: o cron é mais rápido que a vela. */
  | "sem_vela_nova"
  /** Não deu para ler preço/velas. É problema NOSSO, não decisão da mesa. */
  | "sem_dado"
  /** O seletor olhou e ficou de fora. ⚠️ O caso NORMAL, e o mais comum. */
  | "sem_setup"
  /** Qualquer outro — o texto cru viaja em `detalhe`, nunca na tradução. */
  | "outro";

/** O que o tique viu num símbolo. */
export interface VistoNoSimbolo {
  /** Fechamento da última vela lida. `null` = o tique não conseguiu ler. */
  preco: number | null;
  /**
   * ⚠️⚠️ O CARIMBO DA VELA, não o do cron.
   *
   * O cron pode passar às 14:30 e servir um fechamento de 11:00 — o cache
   * `mercado_vela` responde com o que tem quando a fonte recusa. Guardar só a
   * hora do cron faria a tela declarar uma idade ERRADA para o preço, que é
   * pior que não declarar idade nenhuma.
   *
   * ⚠️ ELE É A **ABERTURA** DA VELA (`VelaComTempo.t`) — nunca use este campo
   * para calcular idade. Use `velaFechaEm`. Ver a nota lá.
   */
  velaEm: number | null;
  /**
   * ⚠️⚠️ QUANDO A VELA FECHOU — e é ESTE o carimbo da idade (08/09).
   *
   * O DEFEITO, visto pelo dono num print: o card dizia *"vela de 104 min
   * atrás"* sobre uma vela de 1h aberta às 07:00, lida às 08:44. Mas essa vela
   * FECHOU às 08:00: o dado tinha 44 minutos, não 104. Medir da ABERTURA
   * superestima a idade em até uma duração de intervalo inteira.
   *
   * E isso é pior do que parece por uma razão que este mesmo arquivo já
   * declarava: *"idade errada declarada é pior que idade nenhuma"*. Um número
   * sem carimbo o leitor trata com desconfiança; um número com carimbo ERRADO
   * ele trata como verificado — e conclui que o agente está cego quando ele
   * está em dia.
   */
  velaFechaEm: number | null;
  /** ⚠️ Fechado e traduzível — ver `MotivoDeNaoAbrir`. `null` quando abriu. */
  motivo: MotivoDeNaoAbrir | null;
  /**
   * O REGIME de mercado que o seletor leu — `null` quando não deu para ler.
   *
   * ⚠️ ELE É O "O QUE O AGENTE ESTÁ FAZENDO" TRADUZÍVEL. O dono, olhando o
   * card: *"não dá pra saber o que o agente está fazendo"*. A tela dizia
   * "olhou e não achou setup", que é verdade e não informa nada. O regime tem
   * quatro valores fechados e diz em que mercado ele acha que está — é a
   * metade da resposta que cabe nos quatro idiomas.
   */
  regime: string | null;
  /** O texto cru, só para diagnóstico. ⚠️ NUNCA é o que a tela mostra. */
  detalhe: string | null;
  abriu: boolean;
}

export interface UltimoTique {
  /** Unix ms de quando o cron efetivamente AVALIOU esta instância. */
  em: number;
  /**
   * ⚠️⚠️ QUANDO A CASA A DEIXOU DE FORA POR TETO DE TRABALHO.
   *
   * `aVezDeQuem` gira uma janela de `AGENTES_POR_TICK` instâncias: com 10
   * agentes e teto 8, cada um perde a vez uma vez a cada cinco ciclos. Sem
   * registrar isso, o intervalo entre duas avaliações passa de 60 minutos e o
   * único alarme do investidor dispara — acusando o AGENTE DELE por uma
   * limitação NOSSA. Depois de duas ou três vezes ele aprende a ignorar o
   * aviso, que é o mesmo efeito de não ter aviso.
   */
  adiadaEm?: number | null;
  simbolos: Record<string, VistoNoSimbolo>;
}

const MOTIVOS: readonly MotivoDeNaoAbrir[] =
  ["ja_tem_posicao", "aquecendo", "sem_vela_nova", "sem_dado", "sem_setup", "outro"] as const;

/**
 * Traduz o motivo cru (do `agente.ts` ou do `papel.ts`) para o vocabulário
 * fechado — na BORDA do tique, uma vez, antes de gravar.
 *
 * ⚠️ O DESCONHECIDO VIRA `sem_setup`, não `outro`. O seletor devolve prosa livre
 * exatamente no caso normal ("EMA50 acima do preço", "suporte não testado"), e
 * mandar isso para `outro` faria o estado MAIS COMUM da tela ser o rótulo
 * genérico. Os casos realmente anômalos são nomeados um a um, acima.
 */
export function motivoFechado(cru: string | null | undefined): MotivoDeNaoAbrir | null {
  if (cru == null || cru === "") return null;
  switch (cru) {
    case "ja_tem_posicao":     return "ja_tem_posicao";
    case "aquecendo":          return "aquecendo";
    case "vela_ja_avaliada":   return "sem_vela_nova";
    case "sem_velas":          return "sem_dado";
    case "sem_sinal":          return "sem_setup";
    case "plano sem preço de entrada":
    case "bracket degenerado": return "outro";
    default:                   return "sem_setup";
  }
}

function numeroOuNulo(v: unknown): number | null {
  // ⚠️ `Number(null)` é 0 e passa em `isFinite`. Um preço zero na tela do
  // investidor é pior que um traço: ele parece medido.
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Lê a coluna `ultimo_tique` (jsonb, portanto `unknown`).
 *
 * ⚠️ `null` = NUNCA FOI VERIFICADA, e é um estado legítimo — toda instância
 * passa por ele nos primeiros 30 minutos. Devolver um objeto vazio no lugar
 * faria a tela dizer "verificado, nada encontrado" sobre algo que não foi
 * verificado.
 */
export function lerUltimoTique(v: unknown): UltimoTique | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const em = numeroOuNulo(o.em);
  if (em == null || em <= 0) return null;

  const simbolos: Record<string, VistoNoSimbolo> = {};
  const cru = o.simbolos;
  if (cru != null && typeof cru === "object") {
    for (const [k, val] of Object.entries(cru as Record<string, unknown>)) {
      const s = (val ?? {}) as Record<string, unknown>;
      const m = typeof s.motivo === "string" ? s.motivo : null;
      simbolos[k] = {
        preco: numeroOuNulo(s.preco),
        velaEm: numeroOuNulo(s.velaEm),
        velaFechaEm: numeroOuNulo(s.velaFechaEm),
        regime: typeof s.regime === "string" && s.regime.length > 0 ? s.regime : null,
        // ⚠️ SÓ MOTIVO CONHECIDO PASSA. Uma linha gravada por uma versão mais
        // nova (ou mais velha) do código não pode virar chave de tradução
        // inexistente — isso desenharia um marcador vazio, que é pior que
        // ausente porque parece medido.
        motivo: m != null && (MOTIVOS as string[]).includes(m) ? (m as MotivoDeNaoAbrir) : null,
        detalhe: typeof s.detalhe === "string" && s.detalhe.length > 0 ? s.detalhe.slice(0, 200) : null,
        abriu: s.abriu === true,
      };
    }
  }
  return { em, adiadaEm: numeroOuNulo(o.adiadaEm), simbolos };
}

/**
 * ⚠️ O CRON ANDA DE 30 EM 30 MINUTOS — a mesma cadência de `papel.ts`. Vive
 * aqui de novo? Não: quem quiser o número importa de lá. Este módulo só recebe.
 */
export type Saude = "nunca_verificado" | "em_dia" | "adiado" | "atrasado";

/**
 * A instância está sendo verificada como devia?
 *
 * ⚠️⚠️ QUATRO ESTADOS, E O QUARTO NASCEU DE UM DEFEITO MEU (07/09).
 *
 * A primeira versão tinha três, e `atrasado` era `agora − em > 2 ciclos`. Uma
 * auditoria mostrou que o falso alarme já era alcançável HOJE: com 10 agentes e
 * `AGENTES_POR_TICK = 8`, a janela rolante de `aVezDeQuem` deixa cada instância
 * de fora uma vez a cada cinco ciclos, e o intervalo entre duas avaliações cai
 * exatamente na fronteira dos 60 minutos.
 *
 * O resultado seria o pior tipo de alarme: **o único aviso que o investidor tem
 * disparando por limitação NOSSA, e culpando o agente DELE**. Depois de duas ou
 * três vezes ele aprende a ignorar o aviso — que é o mesmo efeito de não ter
 * aviso, com mais ruído.
 *
 * Então `adiado` é um estado próprio, e ele diz a verdade: a mesa não parou, a
 * casa é que não chegou nela nesta passagem.
 *
 * ⚠️ E A TOLERÂNCIA CONTINUA DE DOIS CICLOS para `atrasado`: um tique pode
 * escorregar sem nada estar errado, e gritar no primeiro atraso ensina a
 * ignorar.
 */
export function saudeDoTique(
  t: UltimoTique | null, cadenciaMs: number, agoraMs: number,
): Saude {
  if (t == null) return "nunca_verificado";

  const avaliadaHa = agoraMs - t.em;
  if (avaliadaHa <= cadenciaMs * 2) return "em_dia";

  /**
   * ⚠️ O ADIAMENTO SÓ EXPLICA O SILÊNCIO SE FOR RECENTE. Um `adiadaEm` de
   * ontem não justifica não ter avaliado hoje — ele diria "a casa está sempre
   * te deixando de fora", que é `atrasado` com outro nome e sem o alarme.
   */
  const adiadaHa = t.adiadaEm == null ? null : agoraMs - t.adiadaEm;
  if (adiadaHa != null && adiadaHa <= cadenciaMs * 2) return "adiado";

  return "atrasado";
}

/**
 * Quanto falta, em % do preço atual, para o alvo e para o stop.
 *
 * ⚠️⚠️ ESTA CONTA É O "TEMPO REAL" QUE O DONO PEDIU: com a posição aberta a
 * 118.733 e o último preço em 121.750, o investidor quer ler "faltam 0,4% para
 * o alvo", não recalcular de cabeça a partir de quatro números soltos.
 *
 * ⚠️ SEM PREÇO, DEVOLVE `null` — nunca 0. Zero aqui diria "chegou no alvo".
 *
 * ⚠️ E O SINAL É RELATIVO AO LADO. Numa venda o alvo está ABAIXO da entrada;
 * uma conta que assuma compra mostraria a distância com o sinal trocado, e o
 * investidor leria "faltam 2%" para um alvo que já passou.
 */
export function distanciaAte(
  p: {
    lado: "long" | "short";
    entrada: number;
    alvoPct: number | null;
    stopPct: number | null;
  },
  precoAtual: number | null,
): { alvoPct: number | null; stopPct: number | null; abertoPct: number | null } {
  if (precoAtual == null || !(precoAtual > 0) || !(p.entrada > 0)) {
    return { alvoPct: null, stopPct: null, abertoPct: null };
  }
  const dir = p.lado === "long" ? 1 : -1;
  // Quanto a posição já rendeu, em % da entrada, no sentido do lado.
  const abertoPct = ((precoAtual - p.entrada) / p.entrada) * 100 * dir;
  return {
    // ⚠️ `Math.max(0, ...)`: distância negativa significaria que o alvo já foi
    // ultrapassado sem a posição ter fechado — o que só acontece entre o toque
    // e o próximo tique. Mostrar "faltam −0,3%" seria ruído; zero é a verdade
    // legível ("está no alvo, fecha no próximo tique").
    alvoPct: p.alvoPct == null ? null : Math.max(0, p.alvoPct - abertoPct),
    stopPct: p.stopPct == null ? null : Math.max(0, p.stopPct + abertoPct),
    abertoPct,
  };
}
