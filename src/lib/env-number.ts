/**
 * LER NÚMERO DE VARIÁVEL DE AMBIENTE SEM PISAR NA MINA.
 *
 * O QUE ESTAVA ERRADO (achado em 01/08, olhando o detalhe da bancada):
 *
 * O padrão usado em todo o repo era este:
 *
 *     const TETO = Number(process.env.ALGUMA_COISA ?? 15);
 *
 * Parece certo e está errado. O `??` só cai no padrão quando o valor é `null`
 * ou `undefined`. Uma variável CRIADA E DEIXADA EM BRANCO vale `""`, o `??` não
 * dispara, e `Number("")` é **zero**. Não é `NaN`, que saltaria aos olhos: é um
 * zero silencioso e perfeitamente válido.
 *
 * O que isso fazia em cada lugar:
 *
 *   · `IMPACT_BLOCK_PCT = 0`  → `loss >= 0` é sempre verdade → TODO swap
 *                               bloqueado. A plataforma inteira parava de
 *                               trocar, e a mensagem culparia a liquidez.
 *   · `ZION_DAILY_MAX = 0`    → toda chamada do ZION vira 503.
 *   · `QUOTE_DAILY_MAX = 0`   → toda cotação vira 503. Sem cotação não há swap.
 *
 * Ou seja: criar a variável na Vercel e apertar Save sem digitar o valor —
 * coisa que se faz sem pensar — derrubava o produto de um jeito que nenhum
 * log acusaria, porque do ponto de vista do código estava tudo funcionando
 * conforme configurado.
 *
 * A REGRA AQUI: string vazia, espaço em branco e lixo não-numérico caem no
 * padrão, igual à variável ausente. Um valor que não dá para ler não é uma
 * configuração — é a falta de uma.
 *
 * Passe o VALOR, nunca a chave: `envNumber(process.env.NEXT_PUBLIC_X, 2)`. Em
 * `NEXT_PUBLIC_*` o Next.js substitui a expressão por texto na hora de
 * compilar, e uma leitura dinâmica (`process.env[chave]`) não é substituída —
 * viria sempre vazia no navegador.
 */

export interface EnvNumberOptions {
  /** Recusa valores ≤ 0 (tetos, limites, cotas — zero é sempre engano). */
  positive?: boolean;
}

export function envNumber(raw: string | undefined | null, fallback: number, opts: EnvNumberOptions = {}): number {
  const s = (raw ?? "").trim();
  if (s === "") return fallback;
  const n = Number(s);
  if (!Number.isFinite(n)) return fallback;
  if (opts.positive && n <= 0) return fallback;
  return n;
}
