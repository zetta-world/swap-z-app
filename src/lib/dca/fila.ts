export type LeituraFilaDca<T> =
  | { ok: true; planos: T[]; truncado: boolean }
  | { ok: false; erro: string; detalhe?: string };

export interface ItemFilaDca<T> {
  plano: T;
  /** true = veio apenas da fila de recovery; nenhuma entrada nova é permitida. */
  somenteRecovery: boolean;
}

export type ResultadoExecucaoFilasDca<R> =
  | {
      ok: true;
      status: 200;
      processed: number;
      truncado: boolean;
      resumo: R[];
    }
  | {
      ok: false;
      status: 503;
      error: "fila_indisponivel";
      origem: "ativa" | "recovery";
      motivo: string;
      detalhe?: string;
      processed: 0;
      truncado: false;
      resumo: [];
    };

/**
 * A58 + A86 — uma passada lê DUAS filas antes de processar qualquer plano:
 *
 *  1. planos ativos/vencidos, que podem abrir uma entrada nova;
 *  2. planos de QUALQUER status com intent DCA vivo, que existem só para
 *     recovery do que já cruzou o ponto sem volta.
 *
 * Se qualquer leitura falhar, a passada inteira é unhealthy (503) e o callback
 * `processar` nem é chamado. Quando o mesmo plano aparece nas duas filas, ele é
 * processado UMA vez e como fila ativa (`somenteRecovery=false`): o próprio
 * `processarPlano` recupera o intent primeiro e só depois considera nova entrada.
 */
export async function executarFilasDca<T extends { id: string }, R>(deps: {
  lerAtivos: () => Promise<LeituraFilaDca<T>>;
  lerRecovery: () => Promise<LeituraFilaDca<T>>;
  processar: (item: ItemFilaDca<T>) => Promise<R>;
  aoFalharProcessamento: (item: ItemFilaDca<T>, erro: unknown) => R;
}): Promise<ResultadoExecucaoFilasDca<R>> {
  const ativos = await deps.lerAtivos();
  if (!ativos.ok) {
    return {
      ok: false,
      status: 503,
      error: "fila_indisponivel",
      origem: "ativa",
      motivo: ativos.erro,
      detalhe: ativos.detalhe,
      processed: 0,
      truncado: false,
      resumo: [],
    };
  }

  const recovery = await deps.lerRecovery();
  if (!recovery.ok) {
    return {
      ok: false,
      status: 503,
      error: "fila_indisponivel",
      origem: "recovery",
      motivo: recovery.erro,
      detalhe: recovery.detalhe,
      processed: 0,
      truncado: false,
      resumo: [],
    };
  }

  const unicos = new Map<string, ItemFilaDca<T>>();
  for (const plano of ativos.planos) {
    unicos.set(plano.id, { plano, somenteRecovery: false });
  }
  for (const plano of recovery.planos) {
    if (!unicos.has(plano.id)) {
      unicos.set(plano.id, { plano, somenteRecovery: true });
    }
  }

  const resumo: R[] = [];
  for (const item of unicos.values()) {
    try {
      resumo.push(await deps.processar(item));
    } catch (erro) {
      resumo.push(deps.aoFalharProcessamento(item, erro));
    }
  }

  return {
    ok: true,
    status: 200,
    processed: unicos.size,
    truncado: ativos.truncado || recovery.truncado,
    resumo,
  };
}
