import { describe, expect, it } from "vitest";
import { foundersPublicCopy } from "@/lib/founders-public/content";
import { foundersPublicFacts } from "@/lib/founders-public/facts";
import { messages } from "@/lib/i18n/messages";
import type { PublicLocale } from "@/lib/founders-public/types";

const locales: PublicLocale[] = ["en", "pt", "es", "zh"];
const facts = foundersPublicFacts();

function promotionalCopy(locale: PublicLocale): string {
  const orders = messages[locale].orders;
  return [
    orders.eyebrow,
    orders.pageTitleA,
    orders.pageTitleHL,
    orders.pageBody,
    orders.descLimit,
    orders.descDca,
    orders.descTwap,
    orders.zionWillLabel,
    orders.summaryLimit,
    orders.summaryDca,
    orders.summaryTwap,
  ].join(" ");
}

describe("Orders public truth", () => {
  it("keeps Orders PARTIAL everywhere the Founders page projects product status", () => {
    expect(facts.products.find(({ id }) => id === "orders")?.status).toBe("PARTIAL");

    for (const locale of locales) {
      const copy = foundersPublicCopy(locale, facts);
      expect(copy.productCopy.orders.body).toBeTruthy();
      expect(facts.products.find(({ id }) => id === "orders")?.status).toBe("PARTIAL");
    }
  });

  it.each(locales)("%s removes protocol-superiority claims from the complete Orders namespace", (locale) => {
    const allOrdersCopy = Object.values(messages[locale].orders).join(" ");
    expect(allOrdersCopy).not.toMatch(/Jupiter|Matcha/i);
    expect(promotionalCopy(locale)).not.toMatch(/\b(?:beat|beats|outperform)\b|supera(?:m|n)?|mejor\s+que|超越/i);
  });

  it.each([
    ["en", /walk away|executes? when|executes? automatically|hands[- ]free|autonomous execution/i],
    ["pt", /deixe rodar|executa quando|execu[cç][aã]o autom[aá]tica|executa sozinho/i],
    ["es", /d[eé]jalo correr|ejecuta cuando|ejecuci[oó]n autom[aá]tica|ejecuci[oó]n aut[oó]noma/i],
    ["zh", /即可离场|自动执行|无需确认|自行执行/],
  ] as const)("%s does not promise autonomous execution", (locale, forbidden) => {
    expect(promotionalCopy(locale)).not.toMatch(forbidden);
  });

  it.each([
    ["en", /explicitly confirm execution/i, /wallet signature/i, /does not execute saved plans/i],
    ["pt", /confirma[cç][aã]o expl[ií]cita/i, /assinatura na sua carteira/i, /n[aã]o executa os planos salvos/i],
    ["es", /confirmaci[oó]n expl[ií]cita/i, /firma de tu billetera/i, /no ejecuta los planes guardados/i],
    ["zh", /明确确认/, /钱包中签名/, /不会替你执行已保存的计划/],
  ] as const)("%s states confirmation, wallet signature and the non-autonomous boundary", (locale, confirmation, signature, boundary) => {
    const body = messages[locale].orders.pageBody;
    expect(body).toMatch(confirmation);
    expect(body).toMatch(signature);
    expect(body).toMatch(boundary);
  });
});
