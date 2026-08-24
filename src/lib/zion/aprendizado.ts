/**
 * O ESTADO DE APRENDIZADO DE CADA MESA — por que este mostrador existe.
 *
 * ⚠️⚠️ O VOLANTE MORREU EM 27/07 E NADA AVISOU POR 20 DIAS.
 *
 * O `runRetroSweep` roda a cada 30 minutos desde sempre e continuou rodando o
 * tempo todo. O que quebrou foi o GATILHO (ver `naoRefletidos` em `retro.ts`):
 * um marco absoluto medido contra uma população que o arquivamento esvaziou.
 * O resultado é o pior tipo de defeito — a varredura executava, não lançava
 * erro, não escrevia nada, e "não disparou" era indistinguível de "ainda não
 * deu o número".
 *
 * Vinte dias de mercado passaram sem uma lição. Descobrimos por acaso, porque o
 * dono discordou de uma leitura minha sobre a GERI e eu fui conferir a hipótese
 * dele no banco.
 *
 * ⚠️ UM MOTOR DE APRENDIZADO SEM MOSTRADOR É UM MOTOR QUE MORRE DE NOVO. O
 * conserto do gatilho tira o sistema da parede uma vez; este módulo é o que
 * faz a PRÓXIMA parada ser vista no mesmo dia.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ E "NÃO APRENDE" NÃO É UMA COISA SÓ — são três, e confundi-las é o erro.
 *
 *   · não aprende porque QUEBROU       → defeito, conserta
 *   · não aprende porque DECIDIMOS     → o VÖLUNDR é o grupo de controle, e
 *                                        sem ele não se mede o valor de nada
 *   · não aprende porque NÃO TEM ONDE  → `selectPlaybook` é código; lição é
 *                                        texto para prompt, e não há prompt
 *
 * Hoje as três aparecem iguais na tela: silêncio. O canal declarado aqui é o
 * que as separa — e a diferença entre um experimento e um defeito não pode
 * viver só num comentário de código.
 */

import { DESKS, type Desk } from "@/lib/zion/desks";

/**
 * COMO esta mesa aprende. É declaração, não dedução — deduzir do `return null`
 * do `brainFor()` daria "nenhum" para o VÖLUNDR e para uma mesa quebrada
 * exatamente igual, que é o buraco que este módulo fecha.
 */
export type CanalDeAprendizado =
  /** `agent_lessons` → `<your_lessons>` no próprio prompt. */
  | "licao"
  /** `loadPlaybookRecord()` + `loadHistory()` — histórico medido por playbook. */
  | "registro"
  /** Nenhum, DE PROPÓSITO: é o grupo de controle da comparação. */
  | "controle"
  /** Nenhum, e não há onde pousar: decisão determinística, sem prompt. */
  | "nenhum";

export const ROTULO_DO_CANAL: Record<CanalDeAprendizado, string> = {
  licao: "lição própria",
  registro: "registro medido",
  controle: "controle (não aprende de propósito)",
  nenhum: "sem canal",
};

/**
 * ⚠️ A ÚNICA MESA MECÂNICA COM CÉREBRO. `strat_ai` (MÍMIR) decide com
 * `roleProviderChain("brain")` e tem prompt próprio, mas o `source` não termina
 * em `_scan` nem começa com `oracle_` — foi por isso que ficou fora do
 * `brainFor()` até 16/08 e nunca teve uma lição na vida.
 */
const COM_CEREBRO_FORA_DO_PADRAO = new Set(["strat_ai", "radar", "sniper", "hybrid_scan"]);

/** A mesa que ignora tudo por decisão experimental. */
const CONTROLE = new Set(["strat_mech"]);

/** A mesa que lê o histórico medido em vez de lição em texto. */
const LE_REGISTRO = new Set(["strat_record"]);

export function canalDe(source: string, desk?: Desk | null): CanalDeAprendizado {
  if (CONTROLE.has(source)) return "controle";
  if (LE_REGISTRO.has(source)) return "registro";
  if (COM_CEREBRO_FORA_DO_PADRAO.has(source)) return "licao";
  if (source.endsWith("_scan") || source.startsWith("oracle_")) return "licao";
  // Sem cérebro e sem registro: `selectPlaybook` puro, arbitragem, lançamento.
  if (desk && desk.brain === "llm") return "licao";
  return "nenhum";
}

/** O que se sabe de uma mesa para julgar o aprendizado dela. */
export interface EntradaDeMesa {
  source: string;
  /** Instante da última lição gravada, em ms. `null` = nunca. */
  ultimaLicaoMs: number | null;
  /** Decididos que ainda não passaram por reflexão. */
  naoRefletidos: number;
}

export interface EstadoDeAprendizado {
  source: string;
  nome: string;
  canal: CanalDeAprendizado;
  rotulo: string;
  ultimaLicaoMs: number | null;
  diasParado: number | null;
  naoRefletidos: number;
  /** Quantos decididos faltam para a próxima reflexão. `null` = não se aplica. */
  faltam: number | null;
  /**
   * ⚠️ TRAVADO É UMA AFIRMAÇÃO FORTE e só sai quando o gatilho JÁ deveria ter
   * disparado. Mesa quieta porque o mercado não deu trade não está travada, e
   * marcar como travada gastaria a credibilidade do alarme no caso comum.
   */
  travado: boolean;
  porque: string;
}

/**
 * ⚠️ O PISO DE DIAS EXISTE PORQUE O CRON É DE 30 MINUTOS. Uma mesa que cruzou o
 * limiar há dez minutos ainda não teve a chance de refletir; chamar isso de
 * travamento seria alarme falso a cada varredura. Um dia inteiro é 48 chances
 * perdidas — aí já não é espera, é defeito.
 */
export const DIAS_ATE_CHAMAR_DE_TRAVADO = 1;

export function estadoDaMesa(
  e: EntradaDeMesa,
  agoraMs: number,
  everyN: number,
  desk?: Desk | null,
): EstadoDeAprendizado {
  const canal = canalDe(e.source, desk);
  const nome = desk ? `${desk.sigil} ${desk.name}` : e.source;
  const diasParado = e.ultimaLicaoMs === null
    ? null
    : Math.max(0, Math.floor((agoraMs - e.ultimaLicaoMs) / 86_400_000));

  const base = {
    source: e.source, nome, canal, rotulo: ROTULO_DO_CANAL[canal],
    ultimaLicaoMs: e.ultimaLicaoMs, diasParado, naoRefletidos: e.naoRefletidos,
  };

  if (canal === "controle") {
    return { ...base, faltam: null, travado: false,
      porque: "não aprende POR DECISÃO — é o grupo de controle que dá sentido à "
        + "comparação. Se ela também aprendesse, o ganho das outras não teria "
        + "contra o que ser medido." };
  }
  if (canal === "registro") {
    return { ...base, faltam: null, travado: false,
      porque: "aprende pelo histórico medido por playbook (`loadPlaybookRecord`), "
        + "não por lição em texto — o veto dela vem de número, não de prosa." };
  }
  if (canal === "nenhum") {
    return { ...base, faltam: null, travado: false,
      porque: "decide em código determinístico, sem prompt. Lição é texto para "
        + "prompt: aqui ela não teria onde pousar, e gerá-la produziria texto "
        + "que ninguém lê." };
  }

  // canal === "licao"
  const faltam = Math.max(0, everyN - e.naoRefletidos);
  const cruzou = e.naoRefletidos >= everyN;

  if (e.ultimaLicaoMs === null) {
    return { ...base, faltam,
      travado: cruzou,
      porque: cruzou
        ? `NUNCA refletiu e já tem ${e.naoRefletidos} decididos esperando — o `
          + "gatilho deveria ter disparado."
        : `ainda não refletiu; faltam ${faltam} decididos para a primeira.` };
  }

  // ⚠️ Cruzar o limiar não basta: o cron precisa ter tido tempo. Ver o piso.
  const travado = cruzou && (diasParado ?? 0) >= DIAS_ATE_CHAMAR_DE_TRAVADO;

  if (travado) {
    return { ...base, faltam,
      travado: true,
      porque: `${e.naoRefletidos} decididos esperam reflexão e a última lição é de `
        + `${diasParado} dia(s) atrás — o gatilho cruzou o limiar e não disparou. `
        + "Isto é defeito, não espera." };
  }
  if (cruzou) {
    return { ...base, faltam, travado: false,
      porque: `${e.naoRefletidos} decididos esperando — a próxima varredura reflete.` };
  }
  return { ...base, faltam, travado: false,
    porque: `${e.naoRefletidos} decididos desde a última lição; faltam ${faltam}.` };
}

export interface VereditoDoVolante {
  mesas: EstadoDeAprendizado[];
  /** Quantas mesas aprendem por lição. */
  comLicao: number;
  /** Quantas dessas estão travadas. */
  travadas: number;
  /** Dias desde a lição mais recente do sistema inteiro. `null` = nenhuma lição. */
  diasDesdeAUltimaLicao: number | null;
  veredito: string;
}

/**
 * O veredito do sistema inteiro.
 *
 * ⚠️ ELE FALA DO VOLANTE, NÃO DAS MESAS. A pergunta que ele responde é a que
 * ninguém fez por 20 dias: "o mecanismo de aprendizado está vivo?". Uma mesa
 * quieta é normal; TODAS quietas com trade resolvendo é o volante parado.
 */
export function vereditoDoVolante(
  entradas: readonly EntradaDeMesa[],
  agoraMs: number,
  everyN: number,
): VereditoDoVolante {
  const porSource = new Map(DESKS.map((d) => [d.source, d]));
  const mesas = entradas
    .map((e) => estadoDaMesa(e, agoraMs, everyN, porSource.get(e.source) ?? null))
    .sort((a, b) => Number(b.travado) - Number(a.travado) || b.naoRefletidos - a.naoRefletidos);

  const comLicao = mesas.filter((m) => m.canal === "licao");
  const travadas = comLicao.filter((m) => m.travado);
  const ultimas = comLicao.map((m) => m.ultimaLicaoMs).filter((t): t is number => t !== null);
  const diasDesdeAUltimaLicao = ultimas.length === 0
    ? null
    : Math.max(0, Math.floor((agoraMs - Math.max(...ultimas)) / 86_400_000));

  const base = { mesas, comLicao: comLicao.length, travadas: travadas.length, diasDesdeAUltimaLicao };

  if (comLicao.length === 0) {
    return { ...base, veredito: "nenhuma mesa com canal de lição está ativa — não há volante a medir." };
  }
  if (travadas.length > 0) {
    return { ...base,
      veredito: `⚠️ VOLANTE TRAVADO em ${travadas.length} de ${comLicao.length} mesas: `
        + travadas.map((m) => m.nome).join(", ")
        + ". Há decididos acumulados que cruzaram o limiar e a reflexão não aconteceu." };
  }
  /**
   * ⚠️ O SILÊNCIO TOTAL É SUSPEITO MESMO SEM NINGUÉM TRAVADO. Foi assim que os
   * 20 dias passaram: cada mesa, sozinha, tinha uma explicação inocente ("ainda
   * não deu o número"); juntas, diziam que o motor estava desligado.
   */
  if (diasDesdeAUltimaLicao !== null && diasDesdeAUltimaLicao >= 7) {
    return { ...base,
      veredito: `⚠️ nenhuma lição em TODO o sistema há ${diasDesdeAUltimaLicao} dias, e nenhuma `
        + "mesa individualmente travada. Ou o mercado não deu trade decidido, ou o gatilho "
        + "voltou a parar — conferir os decididos esperando antes de aceitar a primeira." };
  }
  if (diasDesdeAUltimaLicao === null) {
    return { ...base, veredito: "nenhuma mesa refletiu ainda — o volante nunca girou." };
  }
  return { ...base,
    veredito: `volante vivo: última lição há ${diasDesdeAUltimaLicao} dia(s), `
      + `${comLicao.length} mesas no canal de lição, nenhuma travada.` };
}
