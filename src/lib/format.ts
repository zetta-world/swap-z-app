/**
 * Premium-quality number formatting for crypto UIs.
 * Smart decimal precision based on magnitude — never lies, never spams zeros.
 */

export function formatUsd(n: number | undefined | null, opts: { compact?: boolean } = {}) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(n);
  if (opts.compact && abs >= 1000) {
    return "$" + compactNumber(n);
  }
  if (abs >= 1) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  if (abs >= 0.01) {
    return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 });
  }
  // sub-cent: use 6 sig figs, no commas
  return "$" + n.toPrecision(4);
}

export function formatAmount(n: number | undefined | null, decimals = 4) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return compactNumber(n);
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
  if (abs >= 0.0001) return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  if (abs === 0) return "0";
  return n.toExponential(2);
}

export function compactNumber(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9)  return (n / 1e9 ).toFixed(2) + "B";
  if (abs >= 1e6)  return (n / 1e6 ).toFixed(2) + "M";
  if (abs >= 1e3)  return (n / 1e3 ).toFixed(2) + "K";
  return n.toFixed(2);
}

export function formatPct(n: number | undefined | null, signed = true) {
  if (n === undefined || n === null || !Number.isFinite(n)) return "0%";
  const sign = signed && n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function shortenAddress(addr: string, head = 6, tail = 4) {
  if (!addr) return "";
  if (addr.length <= head + tail) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/**
 * Canonical locale-aware parser for financial decimal text.
 *
 * Returns a plain decimal string using `.` as the decimal separator, or null
 * when the input is invalid / materially ambiguous.
 *
 * Important: this function never passes the value through `Number`, so all
 * user-supplied digits survive intact for subsequent base-unit conversion.
 *
 * Examples:
 *   "0,5"       -> "0.5"
 *   "3.420,50"  -> "3420.50"
 *   "3,420.50"  -> "3420.50"
 *   "1.000.000" -> "1000000"
 *   "3,420"     -> null  (could be 3420 or 3.420)
 */
export function normalizarDecimalFinanceiro(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "bigint") return null;

  const source = String(raw)
    .trim()
    .replace(/[\s\u00A0\u202F]/g, "");
  if (!source || !/^[0-9.,]+$/.test(source)) return null;

  const normalizeInteger = (value: string): string => value.replace(/^0+(?=\d)/, "") || "0";
  const validThousands = (value: string, sep: "." | ","): boolean => {
    const groups = value.split(sep);
    return groups.length > 1
      && /^[1-9]\d{0,2}$/.test(groups[0] ?? "")
      && groups.slice(1).every((group) => /^\d{3}$/.test(group));
  };

  const commaCount = (source.match(/,/g) ?? []).length;
  const dotCount = (source.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    const decimalSep: "." | "," = source.lastIndexOf(",") > source.lastIndexOf(".") ? "," : ".";
    const thousandsSep: "." | "," = decimalSep === "," ? "." : ",";
    if ((decimalSep === "," ? commaCount : dotCount) !== 1) return null;

    const splitAt = source.lastIndexOf(decimalSep);
    const integerRaw = source.slice(0, splitAt);
    const fraction = source.slice(splitAt + 1);
    if (!fraction || !/^\d+$/.test(fraction)) return null;

    let integer: string;
    if (integerRaw.includes(thousandsSep)) {
      if (!validThousands(integerRaw, thousandsSep)) return null;
      integer = integerRaw.split(thousandsSep).join("");
    } else {
      if (!/^\d+$/.test(integerRaw)) return null;
      integer = integerRaw;
    }
    return `${normalizeInteger(integer)}.${fraction}`;
  }

  const sep: "." | "," | null = commaCount > 0 ? "," : dotCount > 0 ? "." : null;
  if (!sep) return /^\d+$/.test(source) ? normalizeInteger(source) : null;

  const count = sep === "," ? commaCount : dotCount;
  if (count > 1) {
    if (!validThousands(source, sep)) return null;
    return normalizeInteger(source.split(sep).join(""));
  }

  const [integerRaw = "", fraction = ""] = source.split(sep);
  if (!/^\d+$/.test(integerRaw) || !/^\d+$/.test(fraction)) return null;

  // One separator followed by exactly three digits is inherently ambiguous
  // for a 1-3 digit non-zero integer prefix: "3,420" can mean 3420 or 3.420.
  // Fail closed unless the left side itself rules out thousands notation.
  if (fraction.length === 3 && /^[1-9]\d{0,2}$/.test(integerRaw)) return null;

  return `${normalizeInteger(integerRaw)}.${fraction}`;
}

/**
 * "12.34" + decimals → unidades base, em STRING, sem passar por `Number`.
 *
 * ⚠️⚠️ POR QUE ISTO NÃO PODE TOCAR EM `Number` (auditoria da ponte, 23/08).
 *
 * A versão anterior morava no `SwapCard` e fazia `amt.toString()` sobre um
 * número JS. Dois defeitos saíam daí, e o segundo é o caro:
 *
 *   1. NOTAÇÃO EXPONENCIAL. `0.0000001.toString()` é `"1e-7"`, e o split no
 *      ponto devolvia `"1e-7"` como parte inteira. O valor enviado virava
 *      `"1e-7000000000000000000"`. O `/^\d+$/` do servidor rejeitava com 400,
 *      então o usuário só via um erro sem explicação ao mover poeira.
 *
 *   2. PERDA SILENCIOSA DE PRECISÃO, que passa em TODAS as travas.
 *      `123456789012345678901` vira `123456789012345680000` — porque acima de
 *      2^53 o `Number` não representa inteiro exato. O resultado é só dígitos,
 *      então `validateAmount` aprova, o `/^\d+$/` aprova, e o usuário assina
 *      uma quantia DIFERENTE da que digitou. Memecoin de 18 casas (SHIB, PEPE)
 *      tem saldo nessa ordem — não é caso de laboratório.
 *
 * ⚠️ TRUNCA, NÃO ARREDONDA. Casas além do que o token suporta são cortadas.
 * Arredondar para cima faria o usuário gastar mais do que digitou, e no botão
 * MAX faria pedir mais do que tem — a transação reverteria DEPOIS de ele já ter
 * pago a aprovação. Errar para baixo deixa poeira; errar para cima queima gás.
 *
 * ⚠️ Entrada inválida devolve `"0"`, nunca lança: isto roda a cada tecla.
 */
export function toBaseUnits(input: string | null | undefined, decimals: number): string {
  if (typeof input !== "string") return "0";
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return "0";

  const normalized = normalizarDecimalFinanceiro(input);
  if (normalized === null) return "0";

  const [intRaw = "0", fracRaw = ""] = normalized.split(".");
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, "0");
  const joined = (intRaw + frac).replace(/^0+/, "");
  return joined === "" ? "0" : joined;
}

/**
 * O caminho de volta: unidades base → string decimal, também sem `Number`.
 *
 * Existe para o botão de porcentagem (25/50/MAX) poder fazer a conta inteira em
 * `bigint` e devolver ao campo um texto exato. `Number(saldo) * 1` num saldo de
 * memecoin arredonda — e arredondar PARA CIMA no MAX faz a carteira pedir mais
 * do que tem: a transação reverte depois de o usuário já ter pago a aprovação.
 */
export function fromBaseUnits(raw: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return "0";
  if (decimals === 0) return raw.toString();
  const neg = raw < 0n;
  const digits = (neg ? -raw : raw).toString().padStart(decimals + 1, "0");
  const int  = digits.slice(0, digits.length - decimals);
  let frac = digits.slice(digits.length - decimals).replace(/0+$/, "");
  // `normalizarDecimalFinanceiro` correctly rejects "1.005" as ambiguous
  // user text. `fromBaseUnits` is an internal producer, so make the generated
  // decimal self-disambiguating without changing its numeric value.
  if (frac.length === 3 && /^[1-9]\d{0,2}$/.test(int)) frac += "0";
  return `${neg ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Convert locale-formatted decimal input into a safe number. */
export function parseDecimalInput(s: string): number | null {
  const normalized = normalizarDecimalFinanceiro(s);
  if (normalized === null) return null;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
