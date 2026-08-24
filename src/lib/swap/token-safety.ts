/**
 * SEGURANÇA DO TOKEN — o selo que estava mentindo.
 *
 * O QUE ESTAVA ERRADO (auditoria de 30/07):
 *
 * O card de swap mostrava um indicador de risco calculado a partir de
 * `token.riskScore` — um NÚMERO DIGITADO À MÃO no registro de tokens
 * (`riskScore: 8`, `riskScore: 6`, …). Não era medição de nada: era constante.
 *
 * Enquanto isso, a plataforma JÁ TINHA verificação real de token — GoPlus +
 * Honeypot.is, com detecção de honeypot, "cannot sell" e taxa abusiva — usada
 * apenas num scanner avulso do explorer. O caminho do dinheiro, que é onde a
 * informação decide alguma coisa, não consultava nada.
 *
 * Um selo verde que vem de constante é pior que selo nenhum: ele produz
 * confiança sem produzir garantia, e o usuário assina em cima disso.
 *
 * A REGRA QUE MANDA AQUI:
 *
 *   Ausência de verificação NUNCA renderiza como segurança.
 *
 * Se a checagem não rodou, não respondeu, ou a chain não é suportada, o estado
 * é "não verificado" — visualmente distinto de "seguro". É a mesma regra do
 * `inconclusivo ≠ aprovado` da bancada, aplicada ao usuário final.
 */

export type SafetyLevel = "safe" | "caution" | "risky" | "danger" | "unverified";

export interface TokenSafety {
  level: SafetyLevel;
  score: number | null;
  /** Sinais de perigo em texto curto, os piores primeiro. */
  signals: string[];
  /** Mensagem pronta. Vazia quando `safe`. */
  message: string;
  /** Perigo confirmado — a interface deve IMPEDIR, não apenas avisar. */
  blocks: boolean;
}

/** Nativo (ETH, SOL…) não tem contrato para golpe: não precisa e não pode ser
 *  verificado por scanner de token. É o único caso em que "sem verificação"
 *  legitimamente não é motivo de alarme. */
export function isNativeToken(address: string | undefined): boolean {
  return address === "native";
}

export interface RiskApiShape {
  score?: number;
  category?: string;
  signals?: Array<{ level?: string; label?: string } | string>;
}

/**
 * Traduz a resposta da API de risco para o veredito da interface.
 *
 * `null` (não chamou, falhou, ou chain sem suporte) vira `unverified` — NUNCA
 * `safe`. Esse é o ponto inteiro deste arquivo.
 */
export function assessTokenSafety(api: RiskApiShape | null): TokenSafety {
  if (!api || typeof api.score !== "number") {
    return {
      level: "unverified", score: null, signals: [], blocks: false,
      message: "Token não verificado — a checagem de segurança não respondeu. Isso NÃO significa que é seguro.",
    };
  }
  const signals = (api.signals ?? [])
    .map((s) => (typeof s === "string" ? s : s?.label ?? ""))
    .filter(Boolean)
    .slice(0, 4);

  const level: SafetyLevel =
    api.category === "danger" ? "danger" :
    api.category === "risky" ? "risky" :
    api.category === "caution" ? "caution" : "safe";

  // Perigo confirmado (honeypot, não dá para vender) não é assunto de aviso:
  // o usuário perderia 100% do que colocasse. A interface impede.
  const blocks = level === "danger";

  const message =
    level === "danger"
      ? `Token BLOQUEADO pela verificação de segurança${signals.length ? `: ${signals[0]}` : ""}. `
        + "Sinais assim indicam que você pode não conseguir vender o que comprar."
      : level === "risky"
        ? `Token de ALTO RISCO${signals.length ? `: ${signals[0]}` : ""}. Confirme que você entende antes de seguir.`
        : level === "caution"
          ? `Atenção${signals.length ? `: ${signals[0]}` : " — o token tem sinais que merecem leitura"}.`
          : "";

  return { level, score: api.score, signals, message, blocks };
}

/** Estado para token nativo: seguro por natureza, e honesto sobre o porquê. */
export function nativeSafety(): TokenSafety {
  return { level: "safe", score: 0, signals: [], message: "", blocks: false };
}
