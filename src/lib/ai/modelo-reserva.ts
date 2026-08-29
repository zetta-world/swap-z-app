import { openaiCompatChat, type ChatRequest, type ChatResult } from "@/lib/ai/provider";
import { classificarFalha, type ClasseFalha } from "@/lib/ai/circuit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTelegram } from "@/lib/admin/track";

/**
 * CADEIA DE MODELOS DENTRO DE UM PROVEDOR — a reserva que faltava.
 *
 * ⚠️⚠️ O QUE ACONTECEU EM 29/08. A Mistral recusou `mistral-large-latest` com
 * `403 tier_not_allowed` — a chave vale, o plano é que não inclui o modelo.
 * Três falhas seguidas abriram o disjuntor e a **Mistral inteira** saiu do ar:
 * ela ocupa o assento `brain` E o `sentiment`, então caíram junto o flywheel, o
 * radar, o oráculo e o sniper. Um nome de modelo recusado apagou quatro mesas.
 *
 * Já existia reserva de PROVEDOR (`roleProviderChain`, 03/08) e reserva de
 * modelo na plataforma (`zion/model.ts`, N1). Faltava exatamente esta: a fila de
 * modelos DE UM provedor do registro. O buraco tem forma de bug histórico —
 * cada camada ganhou a sua reserva no dia em que caiu, e esta caiu agora.
 *
 * ⚠️ E A TROCA É SÓ PARA DUAS CLASSES. `plano` e `modelo` são recusas DO NOME:
 * outro nome pode passar. `auth` (chave revogada), `cota` (sem saldo) e
 * `upstream` (instável) NÃO são — ali trocar de modelo multiplica a mesma
 * recusa por três e ainda esconde a causa, porque o operador passa a ver
 * "caiu para a reserva" onde o certo era "recarregue o crédito". Esperar É a
 * ação nesses casos, e o disjuntor continua sendo quem cuida deles.
 */

/** As recusas em que o NOME do modelo é o problema — e só elas. */
export const CLASSES_TROCA_MODELO: ReadonlySet<ClasseFalha> =
  new Set<ClasseFalha>(["plano", "modelo"]);

export function deveTrocarDeModelo(reason?: string): boolean {
  return CLASSES_TROCA_MODELO.has(classificarFalha(reason));
}

/**
 * ⚠️ TIPO ESTRUTURAL, e não `import { ProviderConfig }`.
 *
 * O `registry.ts` precisa chamar esta função (o `callGeoModel` também merece a
 * reserva), e importar o tipo de lá criaria ciclo de módulo. `ProviderConfig`
 * satisfaz esta forma sem que nenhum dos dois arquivos dependa do outro.
 */
export interface ProvedorChamavel {
  id:      string;
  label:   string;
  apiKey?: string;
  baseUrl: string;
  model:   string;            // o preferido — sempre `models[0]`
  models?: string[];          // a fila inteira; ausente = sem reserva
  temperature?: number;
  timeoutMs?:   number;
  extraBody?:   Record<string, unknown>;
}

/** A fila de modelos, sem repetição e sem vazios. Nunca devolve lista vazia. */
export function modelosDoProvedor(p: ProvedorChamavel): string[] {
  const lista = (p.models?.length ? p.models : [p.model]).filter(Boolean);
  return lista.length > 0 ? [...new Set(lista)] : [p.model];
}

/**
 * A MEMÓRIA DO VETO — por que ela existe e por que EXPIRA.
 *
 * Sem memória, toda chamada paga a recusa do preferido antes de chegar na
 * reserva: seis mesas × 12 ticks/hora = centenas de 403 por dia, latência e
 * ruído de log para reaprender o que já se sabia no primeiro.
 *
 * ⚠️ MAS O VETO É TEMPORÁRIO, pelo mesmo motivo que o disjuntor volta a sondar:
 * um veto eterno exigiria alguém lembrar de rearmar depois de subir o plano, e
 * um provedor que só ressuscita por intervenção manual é a morte silenciosa que
 * este repo se recusa a causar. Seis horas: mexeu no plano, o próximo ciclo
 * usa o modelo bom de novo, sozinho.
 */
const VETO_MS = Number(process.env.AI_MODELO_VETO_MIN ?? 360) * 60_000;

export interface Veto { ate: number; causa: ClasseFalha }
export type Vetos = Record<string, Veto>;

/** Vetos ainda válidos agora — os vencidos somem, que é como o veto expira. */
export function vetosVivos(v: Vetos, agora = Date.now()): Vetos {
  const out: Vetos = {};
  for (const [modelo, r] of Object.entries(v)) if (r.ate > agora) out[modelo] = r;
  return out;
}

/**
 * O PRÓXIMO A TENTAR: o primeiro não vetado; se TODOS estão vetados, o
 * preferido.
 *
 * ⚠️ A segunda metade é deliberada. "Todos vetados" e "nenhum a tentar" não são
 * a mesma coisa: o veto é uma aposta baseada no passado, e desistir por causa
 * dele transformaria uma heurística de economia em um desligamento — sem
 * ninguém decidir isso. Se a fila inteira está vetada, tentamos o preferido e
 * deixamos o upstream falar; se ele voltar a funcionar (plano resolvido), o
 * sucesso limpa tudo antes das seis horas.
 */
export function proximoModelo(modelos: string[], vetados: Vetos, agora = Date.now()): string {
  const vivos = vetosVivos(vetados, agora);
  return modelos.find((m) => !vivos[m]) ?? modelos[0];
}

function chaveVeto(id: string): string { return `modelo_vetado:${id}`; }

/** Best-effort: qualquer soluço de banco devolve "nenhum veto" — falha ABERTA,
 *  igual ao disjuntor. Sem memória o sistema fica lento, não morto. */
async function lerVetos(id: string): Promise<Vetos> {
  const db = getSupabaseAdmin();
  if (!db) return {};
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", chaveVeto(id)).maybeSingle();
    if (data?.value) return vetosVivos(JSON.parse(data.value) as Vetos);
  } catch { /* fail open */ }
  return {};
}

async function gravarVetos(id: string, v: Vetos): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("admin_kv").upsert(
      { key: chaveVeto(id), value: JSON.stringify(v), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  } catch { /* best-effort */ }
}

export interface MemoriaDeVeto {
  ler:    (id: string) => Promise<Vetos>;
  gravar: (id: string, v: Vetos) => Promise<void>;
}

const MEMORIA_PADRAO: MemoriaDeVeto = { ler: lerVetos, gravar: gravarVetos };

export interface OpcoesReserva {
  memoria?: MemoriaDeVeto;
  chamar?:  (req: ChatRequest, cfg: { apiKey: string; baseUrl: string }) => Promise<ChatResult>;
  avisar?:  (msg: string) => void;
  agora?:   number;
}

/**
 * Chama o provedor com reserva de modelo. Devolve o `ChatResult` normal.
 *
 * ⚠️⚠️ A VISIBILIDADE VEM DE GRAÇA E ERA REQUISITO. `ChatResult.model` carrega o
 * modelo que REALMENTE respondeu, e todo chamador já grava `model: r.model` no
 * `recordEvent`. Se a reserva atender, o flywheel atribui o resultado ao modelo
 * certo — sem isso a mesa mediria um modelo e creditaria outro, que é pior que
 * ficar parada: um número errado tem a mesma cara de um número certo.
 */
export async function chamarComReserva(
  p: ProvedorChamavel,
  req: Omit<ChatRequest, "model">,
  opts: OpcoesReserva = {},
): Promise<ChatResult> {
  const chamar  = opts.chamar  ?? openaiCompatChat;
  const memoria = opts.memoria ?? MEMORIA_PADRAO;
  const avisar  = opts.avisar  ?? ((m: string) => { notifyTelegram(m); });
  const agora   = opts.agora   ?? Date.now();

  // Sem chave nem começa: mandar `Bearer ` vazio devolveria 401, que a
  // classificação lê como `auth` e vira "gere outra chave" — mandando o dono
  // caçar credencial quando o que falta é a variável estar preenchida.
  if (!p.apiKey) throw new Error(`${p.label}: sem chave configurada (${p.id.toUpperCase()}_API_KEY)`);

  const modelos = modelosDoProvedor(p);
  const vetados = await memoria.ler(p.id);
  const preferido = proximoModelo(modelos, vetados, agora);
  // A partir do preferido, na ordem da fila — quem ficou para trás já foi
  // vetado e não volta nesta chamada.
  const fila = modelos.slice(modelos.indexOf(preferido));

  const base = {
    ...req,
    timeoutMs:   req.timeoutMs   ?? p.timeoutMs,
    temperature: req.temperature ?? p.temperature,
    extraBody:   req.extraBody   ?? p.extraBody,
  };
  const cfg = { apiKey: p.apiKey ?? "", baseUrl: p.baseUrl };

  let primeiroErro: unknown;
  const novosVetos: Vetos = {};

  for (let i = 0; i < fila.length; i++) {
    const modelo = fila[i];
    try {
      const r = await chamar({ ...base, model: modelo }, cfg);
      // Grava o que esta chamada aprendeu — os que foram recusados ANTES deste.
      // Nada é limpo aqui: um sucesso da reserva não é notícia sobre o
      // preferido, que acabou de ser recusado nesta mesma chamada. Quem devolve
      // o preferido é o vencimento do veto, e só depois de testá-lo de novo.
      if (Object.keys(novosVetos).length > 0) {
        await memoria.gravar(p.id, { ...vetosVivos(vetados, agora), ...novosVetos });
      }
      return r;
    } catch (e) {
      primeiroErro ??= e;
      const reason = e instanceof Error ? e.message : String(e);
      const causa = classificarFalha(reason);
      // Recusa que NÃO é do nome do modelo: para aqui. Trocar de modelo com a
      // chave revogada só repete o 401 com outro nome.
      if (!CLASSES_TROCA_MODELO.has(causa)) break;

      const jaVetado = !!vetosVivos(vetados, agora)[modelo];
      novosVetos[modelo] = { ate: agora + VETO_MS, causa };
      const proximo = fila[i + 1];
      // ⚠️ O AVISO SAI UMA VEZ POR VETO NOVO, não por chamada. Um alerta por
      // tick treina o operador a ignorar — a mesma armadilha que fez o
      // disjuntor passar a calar em causa permanente repetida.
      if (!jaVetado) {
        avisar(
          `🔀 <b>Modelo de reserva</b> — ${p.label}: <code>${modelo}</code> recusado (${causa}).`
          + (proximo
            ? `\nUsando <code>${proximo}</code> por ${Math.round(VETO_MS / 60_000)}min. A mesa segue viva, com modelo pior.`
            : `\n<b>Sem reserva na fila</b> — configure ${p.id.toUpperCase()}_MODEL com uma lista separada por vírgula.`)
          + `\n<i>${reason.slice(0, 160)}</i>`,
        );
      }
    }
  }

  if (Object.keys(novosVetos).length > 0) {
    await memoria.gravar(p.id, { ...vetosVivos(vetados, agora), ...novosVetos });
  }

  /**
   * ⚠️ RELANÇA O PRIMEIRO ERRO, não o último. Quem pega isto é o
   * `recordResult`, que classifica a mensagem para dizer ao dono o que fazer. O
   * erro do primeiro modelo é o da causa raiz (`plano` → "troque o modelo ou
   * suba o plano"); o do último costuma ser o mesmo texto para um nome que
   * ninguém escolheu, e mandaria o dono investigar a reserva em vez do plano.
   */
  const tentados = fila.slice(0, Math.max(1, Object.keys(novosVetos).length));
  const msg = primeiroErro instanceof Error ? primeiroErro.message : String(primeiroErro);
  throw new Error(tentados.length > 1 ? `${msg} [reservas esgotadas: ${tentados.join(", ")}]` : msg);
}
