/**
 * O TIER DA SESSÃO ARMADA, COM PRAZO — achado A111.
 *
 * ⚠️⚠️ O plano era conferido UMA VEZ, ao armar. A sessão dura horas. Assinatura
 * cancelada ou rebaixada no meio não chegava a lugar nenhum.
 *
 * ⚠️ E OS DOIS EXTREMOS SÃO RUINS. Revalidar a cada passada faz uma
 * instabilidade do provedor de assinatura derrubar a automação de todo mundo —
 * o briefing nomeia isso: "não transforme dependência comercial instável em
 * indisponibilidade de segurança". Nunca revalidar é o que existe hoje.
 *
 * A política, explícita: SNAPSHOT COM PRAZO.
 *
 *   carimbo fresco            vale, sem consultar nada
 *   carimbo vencido           revalida
 *   revalidou e satisfaz      novo carimbo, segue
 *   revalidou e NÃO satisfaz  para de ABRIR posição (sair continua livre)
 *   revalidação não respondeu carimbo antigo vale até o PRAZO DURO
 *   passou o prazo duro       para de abrir, mesmo sem veredito
 *
 * ⚠️ SAÍDA NUNCA É BARRADA. Prender o cliente numa posição por causa de uma
 * cobrança é o pior desfecho possível de um controle de acesso.
 */

/** Enquanto o carimbo tiver menos que isto, ninguém consulta nada. */
export const VALIDADE_DO_CARIMBO_MS =
  Number(process.env.AUTOPILOT_TIER_TTL_MS ?? 30 * 60_000);

/**
 * ⚠️ O PRAZO DURO. Depois dele, um carimbo que não conseguiu ser revalidado
 * deixa de valer para ENTRADAS. Doze horas é folgado para uma indisponibilidade
 * do provedor e curto o bastante para que uma assinatura cancelada não financie
 * um dia inteiro de trades.
 */
export const PRAZO_DURO_DO_CARIMBO_MS =
  Number(process.env.AUTOPILOT_TIER_PRAZO_DURO_MS ?? 12 * 3_600_000);

export interface EstadoDaAutorizacao {
  /** O tier carimbado na sessão. `null` = nunca carimbado. */
  carimbo: string | null;
  /** Quando foi carimbado, em ms. `null` = nunca. */
  carimbadoEmMs: number | null;
  agoraMs: number;
  /**
   * O veredito de uma revalidação feita AGORA.
   * `undefined` = não foi tentada; `null` = tentada e NÃO respondeu.
   */
  revalidacao?: { satisfaz: boolean; tier: string } | null;
}

export type DecisaoDeAutorizacao =
  /** Pode abrir posição nova. */
  | { abreEntrada: true; motivo: "carimbo_fresco" | "revalidado"; tier: string | null;
      precisaCarimbar: boolean }
  /**
   * ⚠️ NÃO abre entrada — mas SAIR continua permitido, sempre. Nenhum caminho
   * deste módulo bloqueia venda.
   */
  | { abreEntrada: false; motivo: "rebaixado" | "carimbo_vencido_sem_resposta" | "nunca_carimbado";
      porque: string };

/** Precisa consultar o provedor de assinatura nesta passada? */
export function precisaRevalidar(e: Pick<EstadoDaAutorizacao, "carimbadoEmMs" | "agoraMs">): boolean {
  if (e.carimbadoEmMs == null) return true;
  return e.agoraMs - e.carimbadoEmMs >= VALIDADE_DO_CARIMBO_MS;
}

export function decidirPelaAutorizacao(e: EstadoDaAutorizacao): DecisaoDeAutorizacao {
  const idade = e.carimbadoEmMs == null ? Infinity : e.agoraMs - e.carimbadoEmMs;

  // Revalidação com veredito manda, sempre — fresca é mais verdadeira que carimbo.
  if (e.revalidacao) {
    if (!e.revalidacao.satisfaz) {
      return { abreEntrada: false, motivo: "rebaixado",
        porque: `plano ${e.revalidacao.tier} nao satisfaz o exigido — entradas fechadas, saidas livres` };
    }
    return { abreEntrada: true, motivo: "revalidado", tier: e.revalidacao.tier,
      precisaCarimbar: true };
  }

  // Sem revalidação: o carimbo decide, até o prazo duro.
  if (e.carimbadoEmMs == null || e.carimbo == null) {
    /**
     * ⚠️ NUNCA CARIMBADO é o estado das sessões que existem hoje. Elas foram
     * armadas com o tier conferido e sem registro disso. Fechar entrada aqui
     * seria o correto em teoria e derrubaria toda sessão viva na virada — por
     * isso o worker CARIMBA na primeira passada, e só o prazo duro fecha.
     */
    if (idade === Infinity) {
      return { abreEntrada: false, motivo: "nunca_carimbado",
        porque: "sessao sem carimbo de plano — o worker precisa revalidar antes de abrir posicao" };
    }
  }
  if (idade >= PRAZO_DURO_DO_CARIMBO_MS) {
    return { abreEntrada: false, motivo: "carimbo_vencido_sem_resposta",
      porque: `plano nao pode ser reconferido ha ${Math.round(idade / 3_600_000)}h — entradas fechadas` };
  }
  return { abreEntrada: true, motivo: "carimbo_fresco", tier: e.carimbo,
    precisaCarimbar: false };
}
