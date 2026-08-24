/**
 * EINHERJAR — o TIPO e as funções PURAS da caixa de mensagens.
 * (`docs/PLANO-EINHERJAR.md`)
 *
 * ⚠️⚠️ POR QUE ESTE ARQUIVO EXISTE SEPARADO DE `mensagens.ts` (24/08).
 *
 * Porque o painel é `"use client"` e precisa de `estadoDa` e `faz`. Enquanto
 * essas duas moravam junto com `lerMensagens`, importar UMA delas arrastava o
 * módulo inteiro para o pacote do navegador — e com ele o
 * `import { getSupabaseAdmin } from "@/lib/supabase/server"` da primeira linha.
 *
 * Esse módulo tem uma guarda que LANÇA quando avaliada no navegador (ela existe
 * para transformar vazamento da service key em queda barulhenta, e cumpriu o
 * papel dela). Resultado: o shell inteiro do Z-SWAP caiu em produção com
 * "supabase/server.ts must never be imported in the browser" — não só o painel
 * novo, a APLICAÇÃO. O dono achou no celular.
 *
 * ⚠️ E NADA ACUSOU ANTES. `tsc`, `lint`, `build` e 1.696 testes passaram: o
 * erro é de AVALIAÇÃO no navegador, não de compilação. A trava que faltava é
 * `src/lib/supabase/nao-vaza-para-o-cliente.test.ts`, escrita junto com este
 * arquivo — ela varre a árvore de imports de todo componente cliente.
 *
 * ⚠️ REGRA: nada aqui pode importar de `@/lib/supabase/*`, nem de qualquer
 * módulo que importe. Isto é código que roda nos DOIS lados.
 */

/** O que a tabela guarda. Espelha `0029_einherjar_mensagens.sql`. */
export interface Mensagem {
  id:            string;
  de:            string;
  para:          string;
  assunto:       string;
  corpo:         string;
  criado_em:     string;
  /** `null` = o agente NEM VIU. Diferente de "viu e não respondeu". */
  lido_em:       string | null;
  resposta:      string | null;
  respondido_em: string | null;
}

/** Quem pode aparecer como remetente ou destinatário. */
export const INTERLOCUTORES = ["dono", "nuvem", "vscode", "todos"] as const;
export type Interlocutor = (typeof INTERLOCUTORES)[number];

export function interlocutorValido(v: string | null | undefined): v is Interlocutor {
  return typeof v === "string" && (INTERLOCUTORES as readonly string[]).includes(v);
}

/**
 * ⚠️ O ESTADO DE LEITURA É O PONTO DA TELA, e por isso é função pura e testada.
 *
 * "Ainda não lido" é a diferença entre "o agente não respondeu" e "o agente nem
 * viu" — sem isso o dono fica esperando alguém que não sabe que foi chamado.
 */
export type EstadoMensagem = "nao_lida" | "lida_sem_resposta" | "respondida";

export function estadoDa(m: Pick<Mensagem, "lido_em" | "resposta">): EstadoMensagem {
  if (m.resposta) return "respondida";
  return m.lido_em ? "lida_sem_resposta" : "nao_lida";
}

/** "há 12 min" — o tempo que a espera já custou, em texto curto. */
export function faz(desdeIso: string, agoraMs: number): string {
  const ms = agoraMs - Date.parse(desdeIso);
  if (!Number.isFinite(ms) || ms < 0) return "agora";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}
