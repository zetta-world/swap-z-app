/**
 * A TRAVA DA PASSADA DO DCA — o teto diário só vale se uma passada roda por vez.
 *
 * ⚠️⚠️ ACHADO A20 DA AUDITORIA EXTERNA (14/09), confirmado no código.
 *
 * O cron do DCA não tinha trava NENHUMA — nem por passada, nem por carteira. E
 * o teto diário é lido e aplicado assim:
 *
 *   1. `gastoHojeDaCarteira(wallet)` lê o gasto do dia;
 *   2. `tetoDoCiclo(…)` decide quanto este ciclo pode gastar;
 *   3. reserva → ordem → registro.
 *
 * Entre 1 e 3 existe uma janela. Duas invocações concorrentes — o cron-job.org
 * disparando duas vezes, ou uma repetição alcançando uma passada lenta — leem o
 * MESMO `gastoHoje` e as duas disparam, cada uma acreditando que há folga.
 *
 * ⚠️ E A TRAVA `unique` DO `reservarCiclo` NÃO COBRE ISTO. Ela impede duas
 * passadas de executarem o MESMO ciclo do MESMO plano — e faz isso bem. Mas o
 * teto diário é da CARTEIRA, atravessando planos: dois planos diferentes da
 * mesma carteira reservam ciclos diferentes, passam os dois pela `unique`, e
 * estouram o teto juntos.
 *
 * ⚠️ O CÓDIGO JÁ SUPUNHA SERIALIZAÇÃO QUE NÃO TINHA. O comentário do cron diz
 * que `gastoHojeDaCarteira` é consultado a cada plano, sem cache, para que "o
 * segundo enxergue o que o primeiro acabou de gastar". Isso está certo DENTRO
 * de uma passada — e é exatamente a suposição que uma segunda passada
 * simultânea quebra.
 *
 * ⚠️⚠️ POR QUE NÃO O HELPER DA VITRINE. `pegouATrava` em
 * `bancada/mesas-da-casa` é LÊ-DEPOIS-ESCREVE e falha ABERTO: duas chamadas
 * concorrentes podem ler "livre" e escrever as duas. Para a vitrine isso é
 * correto (o pior caso é medir duas vezes). Aqui seria uma trava que não trava,
 * no caminho do dinheiro.
 *
 * O padrão certo já existe nesta casa: `tryLockSession` faz UPDATE CONDICIONAL
 * com `.select()`. O Postgres serializa o UPDATE, então de duas passadas
 * sobrepostas exatamente uma vê linha alterada. É esse que se copia aqui.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

export const CHAVE_DA_TRAVA = "lock:dca:passada";

/**
 * A rota declara `maxDuration = 60`, então uma passada não pode durar mais que
 * isso. 90s dá folga e garante que uma trava presa por queda da função expire
 * sozinha na passada seguinte — sem precisar de mão humana.
 */
export const TTL_DA_TRAVA_MS = 90_000;

export type Aquisicao = "peguei" | "ocupada" | "nao_sei";

/**
 * Tenta pegar a trava da passada.
 *
 * ⚠️ TRÊS RESPOSTAS, NÃO DUAS. "não sei" (banco fora, erro na consulta) é
 * diferente de "ocupada", e quem chama trata diferente: ocupada é rotina e sai
 * calado; não sei é falha FECHADA com registro, porque seguir sem saber se
 * outra passada está comprando é exatamente o defeito que esta trava impede.
 */
export async function pegarATrava(agoraMs = Date.now()): Promise<Aquisicao> {
  const db = getSupabaseAdmin();
  if (!db) return "nao_sei";

  const agoraIso = new Date(agoraMs).toISOString();
  const ate = new Date(agoraMs + TTL_DA_TRAVA_MS).toISOString();

  /**
   * ⚠️ A LINHA PRECISA EXISTIR para o UPDATE condicional ter o que casar. Este
   * `insert` roda uma única vez na vida; `ignoreDuplicates` faz as demais
   * passadas não tocarem no valor — se ele sobrescrevesse, a própria semeadura
   * viraria a corrida que estamos fechando.
   */
  const { error: erroDaSemeadura } = await db.from("admin_kv").upsert(
    { key: CHAVE_DA_TRAVA, value: "", updated_at: agoraIso },
    { onConflict: "key", ignoreDuplicates: true },
  );
  if (erroDaSemeadura) return "nao_sei";

  /**
   * ⚠️⚠️ AQUI ESTÁ A ATOMICIDADE. O Postgres serializa este UPDATE: das duas
   * passadas sobrepostas, exatamente uma casa a condição e vê linha alterada; a
   * outra vê zero. É o mesmo mecanismo de `tryLockSession`.
   *
   * ⚠️ A comparação é de TEXTO, e está certa: ISO-8601 em UTC ordena
   * lexicograficamente igual a cronologicamente. `""` (a semeadura) é menor que
   * qualquer data, então a primeira passada da vida pega a trava.
   */
  const { data, error } = await db.from("admin_kv")
    .update({ value: ate, updated_at: agoraIso })
    .eq("key", CHAVE_DA_TRAVA)
    .lt("value", agoraIso)
    .select("key");
  if (error) return "nao_sei";
  return (data?.length ?? 0) > 0 ? "peguei" : "ocupada";
}

/**
 * Devolve a trava ao terminar, para a passada seguinte não esperar o TTL.
 *
 * ⚠️ MELHOR-ESFORÇO DE PROPÓSITO, e é o único ponto aqui que pode ser: falhar
 * em soltar só adia a próxima passada até o TTL vencer — nada é executado duas
 * vezes por causa disso. O TTL é a garantia; isto é a conveniência.
 */
export async function soltarATrava(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  await db.from("admin_kv")
    .update({ value: "", updated_at: new Date().toISOString() })
    .eq("key", CHAVE_DA_TRAVA);
}
