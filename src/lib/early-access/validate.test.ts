/**
 * EARLY ACCESS — validação e normalização (módulo puro).
 *
 * Regras finais: docs/WHITELIST-FUNDRAISING-DISCOVERY.md §0 (correções A–H).
 * As versões legais são INJETADAS aqui porque as reais são "UNAPPROVED" — e
 * "UNAPPROVED" é recusado por esta mesma validação (testado abaixo).
 */
import { describe, it, expect } from "vitest";
import {
  validarInscricao, normalizarEmail, normalizarNome, normalizarPais, normalizarCarteira,
  normalizarReferral, normalizarUtm, pareceRobo, textoHumanoSeguro, UTM_MAX, validarConfirmacao,
} from "./validate";
import { TERMS_VERSION, PRIVACY_VERSION, versaoAprovada, ehSentinela } from "./legal-versions";

const V = { terms: "tos-2026-10", privacy: "priv-2026-10" };
const EVM = "0x072c80F3e898f41A2FfA10E25F2F1B99B5B1668A";
const SOL = "4iVKTpNMd7vefvx5VkBJpZxdJVSbuV3oxkcBUm8QzCNj";
const ZW = String.fromCharCode(0x200b);     // zero-width space
const RLO = String.fromCharCode(0x202e);    // right-to-left override
const BEL = String.fromCharCode(0x07);

function corpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: "ana@example.com", display_name: "Ana Souza", country: "BR",
    accept_terms: true, accept_privacy: true,
    terms_version: V.terms, privacy_version: V.privacy,
    form_ms: 5000, website: "",
    ...extra,
  };
}

describe("① email: trim → NFC → minúsculas, ASCII, sem canonicalização por provedor", () => {
  it("mixed case vira minúsculo", () => {
    expect(normalizarEmail("  Ana.Souza@Example.COM ")).toBe("ana.souza@example.com");
  });
  it("⚠️ SEM dot folding e SEM plus stripping (correção D)", () => {
    expect(normalizarEmail("a.n.a+promo@gmail.com")).toBe("a.n.a+promo@gmail.com");
    expect(normalizarEmail("a.n.a+promo@gmail.com")).not.toBe(normalizarEmail("ana@gmail.com"));
  });
  it("⚠️ não-ASCII é recusado nesta fase (homoglifo cirílico, acento, IDN cru)", () => {
    expect(normalizarEmail("аna@example.com")).toBeNull();
    expect(normalizarEmail("joão@example.com")).toBeNull();
    expect(normalizarEmail("ana@exämple.com")).toBeNull();
  });
  it("NFC é aplicado antes da checagem (NFD de 'é' não vira ASCII)", () => {
    expect(normalizarEmail("josé@example.com")).toBeNull();
  });
  it("estrutura: tamanho, arroba única, pontos, domínio com TLD", () => {
    expect(normalizarEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
    expect(normalizarEmail(`a@${"b".repeat(250)}.com`)).toBeNull();
    for (const ruim of ["ana", "ana@", "@x.com", "a@@x.com", "a@b@x.com", ".a@x.com", "a..b@x.com", "a@x", "a@x.c", "a@-x.com"]) {
      expect(normalizarEmail(ruim), ruim).toBeNull();
    }
  });
});

describe("② display_name obrigatório: Unicode humano sim, controle/bidi/zero-width não", () => {
  it("aceita nomes humanos em várias escritas", () => {
    for (const ok of ["Ana Souza", "José Ñúñez", "李小龙", "Владимир", "محمد", "O'Brien-Smith", "Zoë 🚀"]) {
      expect(normalizarNome(ok), ok).toBe(ok.normalize("NFC"));
    }
  });
  it("NFC: a forma decomposta é normalizada", () => {
    expect(normalizarNome("José")).toBe("José");
  });
  it("⚠️ recusa controle, bidi override e zero-width", () => {
    expect(normalizarNome(`Ana${BEL}Bia`)).toBeNull();
    expect(normalizarNome(`Ana${RLO}gnp.exe`)).toBeNull();
    expect(normalizarNome(`An${ZW}a`)).toBeNull();
    expect(textoHumanoSeguro(`a${String.fromCharCode(0xfeff)}b`)).toBe(false);
  });
  it("ZWNJ/ZWJ são legítimos (persa, emoji) e passam", () => {
    expect(textoHumanoSeguro(`می${String.fromCharCode(0x200c)}خواهم`)).toBe(true);
  });
  it("tamanho 2–80 code points; precisa de ao menos uma letra", () => {
    expect(normalizarNome("A")).toBeNull();
    expect(normalizarNome("a".repeat(81))).toBeNull();
    expect(normalizarNome("😀".repeat(80))).toBeNull(); // sem letra
    expect(normalizarNome("ab")).toBe("ab");
    expect(normalizarNome("é".repeat(80))).toBe("é".repeat(80));
  });
  it("ausente → campo inválido", () => {
    const r = validarInscricao(corpo({ display_name: undefined }), V);
    expect(r).toMatchObject({ ok: false, campo: "display_name" });
  });
});

describe("③ country obrigatório: ISO 3166-1 alpha-2 contra lista REAL", () => {
  it("válidos", () => {
    for (const c of ["BR", "US", "PT", "CN", "SS", "AX"]) expect(normalizarPais(c), c).toBe(c);
  });
  it("⚠️ formato certo mas código inexistente é recusado (não é só regex)", () => {
    for (const c of ["XX", "ZZ", "AA", "UK", "EU"]) expect(normalizarPais(c), c).toBeNull();
  });
  it("minúsculo, 3 letras e vazio são recusados, não corrigidos", () => {
    for (const c of ["br", "Br", "BRA", "", "B"]) expect(normalizarPais(c), c).toBeNull();
  });
  it("ausente → campo inválido", () => {
    expect(validarInscricao(corpo({ country: undefined }), V)).toMatchObject({ ok: false, campo: "country" });
  });
});

describe("④ carteira opcional — declarada, normalizada como no login", () => {
  it("EVM minúsculo vira checksum EIP-55", () => {
    expect(normalizarCarteira(EVM.toLowerCase(), "evm")).toEqual({ address: EVM, chain: "evm" });
  });
  it("Solana fica como está (base58 é case-sensitive; nunca lower)", () => {
    expect(normalizarCarteira(SOL, "solana")).toEqual({ address: SOL, chain: "solana" });
    // ⚠️ A versão minúscula pode até decodificar para 32 bytes válidos — mas é
    // OUTRA chave pública. O que importa é nunca dobrá-la na original.
    expect(normalizarCarteira(SOL.toLowerCase(), "solana")?.address).not.toBe(SOL);
  });
  it("EVM inválido / Solana inválido / chain desconhecida", () => {
    expect(validarInscricao(corpo({ wallet_address: "0x123", wallet_chain: "evm" }), V)).toMatchObject({ ok: false, campo: "wallet_address" });
    expect(validarInscricao(corpo({ wallet_address: "não-é-base58-0OIl", wallet_chain: "solana" }), V)).toMatchObject({ ok: false, campo: "wallet_address" });
    expect(validarInscricao(corpo({ wallet_address: EVM, wallet_chain: "btc" }), V)).toMatchObject({ ok: false });
  });
  it("⚠️ carteira sem chain e chain sem carteira são recusadas", () => {
    expect(validarInscricao(corpo({ wallet_address: EVM }), V)).toMatchObject({ ok: false, campo: "wallet_chain" });
    expect(validarInscricao(corpo({ wallet_chain: "evm" }), V)).toMatchObject({ ok: false, campo: "wallet_address" });
  });
  it("válida passa normalizada", () => {
    const r = validarInscricao(corpo({ wallet_address: EVM.toLowerCase(), wallet_chain: "evm" }), V);
    expect(r.ok && r.dados.walletAddress).toBe(EVM);
  });
});

describe("⑤ consentimento e versões legais", () => {
  it("⚠️ termos ou privacidade ausentes → consentimento_ausente", () => {
    expect(validarInscricao(corpo({ accept_terms: false }), V)).toMatchObject({ ok: false, erro: "consentimento_ausente" });
    expect(validarInscricao(corpo({ accept_privacy: undefined }), V)).toMatchObject({ ok: false, erro: "consentimento_ausente" });
    expect(validarInscricao(corpo({ accept_terms: "true" }), V)).toMatchObject({ ok: false, erro: "consentimento_ausente" });
  });
  it("versão de termos ou de privacidade diferente da atual → versao_legal", () => {
    expect(validarInscricao(corpo({ terms_version: "tos-velha" }), V)).toMatchObject({ ok: false, erro: "versao_legal" });
    expect(validarInscricao(corpo({ privacy_version: "priv-velha" }), V)).toMatchObject({ ok: false, erro: "versao_legal" });
  });
  it("⚠️⚠️ UNAPPROVED nunca é aceito — nem quando o cliente manda o mesmo valor", () => {
    expect(TERMS_VERSION).toBe("UNAPPROVED");
    expect(PRIVACY_VERSION).toBe("UNAPPROVED");
    const r = validarInscricao(corpo({ terms_version: "UNAPPROVED", privacy_version: "UNAPPROVED" }));
    expect(r).toMatchObject({ ok: false, erro: "versao_legal" });
  });
  it("⚠️⚠️ F-03: o sentinela em QUALQUER caixa e com espaço lateral nunca é aprovado", () => {
    for (const v of ["UNAPPROVED", "unapproved", " Unapproved", "UNAPPROVED ", "  unapproved", "uNaPpRoVeD"]) {
      expect(ehSentinela(v), JSON.stringify(v)).toBe(true);
      expect(versaoAprovada(v), JSON.stringify(v)).toBe(false);
      // mesmo injetado como versão "atual", a validação recusa
      expect(validarInscricao(corpo({ terms_version: v, privacy_version: v }), { terms: v, privacy: v }),
        JSON.stringify(v)).toMatchObject({ ok: false, erro: "versao_legal" });
    }
  });
  it("F-03: formato explícito de versão (o mesmo regex do CHECK)", () => {
    for (const ok of ["tos-2026-10", "v1", "2026.10", "a_b", "A".repeat(40)]) expect(versaoAprovada(ok), ok).toBe(true);
    for (const ruim of ["", "-tos", ".v1", "tos 1", "tos/1", "A".repeat(41), "tós"]) expect(versaoAprovada(ruim), ruim).toBe(false);
  });
  it("marketing é opcional e nunca presumido", () => {
    const r = validarInscricao(corpo(), V);
    expect(r.ok && r.dados.marketingOptIn).toBe(false);
    expect(validarInscricao(corpo({ marketing_opt_in: "yes" }), V)).toMatchObject({ ok: false, campo: "marketing_opt_in" });
  });
});

describe("⑥ forma do corpo", () => {
  it("⚠️ campo desconhecido é recusado (ex.: tentar mandar status)", () => {
    expect(validarInscricao(corpo({ status: "approved" }), V)).toMatchObject({ ok: false, erro: "campo_desconhecido", campo: "status" });
    expect(validarInscricao(corpo({ ip_hmac: "x" }), V)).toMatchObject({ ok: false, erro: "campo_desconhecido" });
  });
  it("corpo que não é objeto", () => {
    for (const c of [null, [], "x", 1]) expect(validarInscricao(c, V)).toMatchObject({ ok: false, erro: "corpo_invalido" });
  });
  it("tipo errado em campo opcional é erro, não silêncio", () => {
    expect(validarInscricao(corpo({ telegram: 123 }), V)).toMatchObject({ ok: false, campo: "telegram" });
  });
  it("handles: telegram 5–32, X 1–15, arroba opcional e removida", () => {
    const r = validarInscricao(corpo({ telegram: "@ana_souza", x: "@ana" }), V);
    expect(r.ok && [r.dados.telegram, r.dados.x]).toEqual(["ana_souza", "ana"]);
    expect(validarInscricao(corpo({ telegram: "abc" }), V)).toMatchObject({ ok: false, campo: "telegram" });
    expect(validarInscricao(corpo({ x: "a".repeat(16) }), V)).toMatchObject({ ok: false, campo: "x" });
  });
});

describe("⑦ UTM e atribuição — limites rígidos", () => {
  it(`UTM até ${UTM_MAX} passa; ${UTM_MAX + 1} é recusado`, () => {
    expect(normalizarUtm("u".repeat(UTM_MAX))).toBe("u".repeat(UTM_MAX));
    expect(validarInscricao(corpo({ utm_source: "u".repeat(UTM_MAX + 1) }), V)).toMatchObject({ ok: false, campo: "utm_source" });
  });
  it("UTM com controle/bidi é recusado", () => {
    expect(validarInscricao(corpo({ utm_campaign: `x${RLO}y` }), V)).toMatchObject({ ok: false, campo: "utm_campaign" });
  });
  it("landing_path precisa começar com / e não pode ser //host", () => {
    expect(validarInscricao(corpo({ landing_path: "http://evil" }), V)).toMatchObject({ ok: false, campo: "landing_path" });
    expect(validarInscricao(corpo({ landing_path: "//evil.com" }), V)).toMatchObject({ ok: false, campo: "landing_path" });
    const r = validarInscricao(corpo({ landing_path: "/early-access" }), V);
    expect(r.ok && r.dados.landingPath).toBe("/early-access");
  });
  it("source fora da lista fechada é recusado", () => {
    expect(validarInscricao(corpo({ source: "admin_panel" }), V)).toMatchObject({ ok: false, campo: "source" });
  });
});

describe("⑧ referral de entrada — formato inválido é silêncio, não erro", () => {
  it("normaliza para maiúsculo no alfabeto Crockford", () => {
    expect(normalizarReferral(" abcdefgh12 ")).toBe("ABCDEFGH12");
  });
  it("⚠️ formato inválido vira null sem erro de campo (nada de oráculo)", () => {
    expect(normalizarReferral("IIIIIIIIII")).toBeNull();
    const r = validarInscricao(corpo({ referral_code: "nao-existe" }), V);
    expect(r.ok && r.dados.referralCode).toBeNull();
  });
});

describe("⑨ sinais de robô", () => {
  it("honeypot preenchido ou rápido demais", () => {
    expect(pareceRobo({ honeypot: "http://spam", formMs: 9000 })).toBe(true);
    expect(pareceRobo({ honeypot: "", formMs: 500 })).toBe(true);
    expect(pareceRobo({ honeypot: "", formMs: null })).toBe(true);
    expect(pareceRobo({ honeypot: "", formMs: 4000 })).toBe(false);
  });
  it("form_ms com tipo errado é erro de campo", () => {
    expect(validarInscricao(corpo({ form_ms: "5000" }), V)).toMatchObject({ ok: false, campo: "form_ms" });
    expect(validarInscricao(corpo({ form_ms: -1 }), V)).toMatchObject({ ok: false, campo: "form_ms" });
  });
});

describe("⑦ Fase 2 — locale e corpo da confirmação", () => {
  it("locale: en/pt/es/zh; ausente → en; outro → campo_invalido", () => {
    for (const l of ["en", "pt", "es", "zh"]) {
      const r = validarInscricao(corpo({ locale: l }), V);
      expect(r.ok && r.dados.locale).toBe(l);
    }
    const sem = validarInscricao(corpo(), V);
    expect(sem.ok && sem.dados.locale).toBe("en");
    for (const l of ["fr", "PT", "", 5]) {
      expect(validarInscricao(corpo({ locale: l }), V)).toMatchObject({ ok: false, campo: "locale" });
    }
  });
  const TK = "D".repeat(42) + "A";
  // EA2-IA05: as versões que a tela apresentou (obrigatórias em confirm)
  const VC = { accept_terms_version: "tos-1", acknowledge_privacy_version: "priv-1" };
  it("⚠️ EA2-IA05: confirm exige as DUAS versões apresentadas, no formato de versão", () => {
    expect(validarConfirmacao({ token: TK, action: "confirm" })).toMatchObject({ ok: false, erro: "versao_legal", campo: "accept_terms_version" });
    expect(validarConfirmacao({ token: TK, action: "confirm", accept_terms_version: "tos-1" }))
      .toMatchObject({ ok: false, erro: "versao_legal", campo: "acknowledge_privacy_version" });
    expect(validarConfirmacao({ token: TK, action: "confirm", accept_terms_version: "tos 1", acknowledge_privacy_version: "priv-1" }))
      .toMatchObject({ ok: false, campo: "accept_terms_version" });
    expect(validarConfirmacao({ token: TK, action: "preview", ...VC })).toMatchObject({ erro: "campo_desconhecido" });
  });
  it("confirmação: token no formato, ação fechada", () => {
    expect(validarConfirmacao({ token: TK, action: "preview" })).toEqual({ ok: true, dados: {
      token: TK, acao: "preview", displayName: null, country: null, marketingOptIn: null, versaoTermos: null, versaoPrivacidade: null } });
    expect(validarConfirmacao({ token: TK, action: "aprovar" })).toMatchObject({ ok: false, campo: "action" });
    expect(validarConfirmacao({ token: "x", action: "confirm" })).toMatchObject({ ok: false, campo: "token" });
    expect(validarConfirmacao([])).toMatchObject({ ok: false, erro: "corpo_invalido" });
  });
  it("⚠️ D-6: só nome e país, só em confirm, pela MESMA normalização; email nunca", () => {
    expect(validarConfirmacao({ token: TK, action: "confirm", display_name: "  Ana  ", country: "PT", ...VC }))
      .toEqual({ ok: true, dados: { token: TK, acao: "confirm", displayName: "Ana", country: "PT", marketingOptIn: null,
                                    versaoTermos: "tos-1", versaoPrivacidade: "priv-1" } });
    // EA2-A02: escolha explícita, booleano literal, só em confirm
    expect(validarConfirmacao({ token: TK, action: "confirm", marketing_opt_in: false, ...VC })).toMatchObject({ ok: true, dados: { marketingOptIn: false } });
    expect(validarConfirmacao({ token: TK, action: "confirm", marketing_opt_in: true, ...VC })).toMatchObject({ ok: true, dados: { marketingOptIn: true } });
    expect(validarConfirmacao({ token: TK, action: "confirm", marketing_opt_in: "on" })).toMatchObject({ ok: false, campo: "marketing_opt_in" });
    expect(validarConfirmacao({ token: TK, action: "decline", marketing_opt_in: true })).toMatchObject({ erro: "campo_desconhecido" });
    expect(validarConfirmacao({ token: TK, action: "confirm", email: "b@c.com" })).toMatchObject({ erro: "campo_desconhecido", campo: "email" });
    expect(validarConfirmacao({ token: TK, action: "confirm", wallet_address: "x" })).toMatchObject({ erro: "campo_desconhecido" });
    expect(validarConfirmacao({ token: TK, action: "decline", country: "PT" })).toMatchObject({ erro: "campo_desconhecido" });
    expect(validarConfirmacao({ token: TK, action: "confirm", country: "XX" })).toMatchObject({ campo: "country" });
    expect(validarConfirmacao({ token: TK, action: "confirm", display_name: "A" + RLO + "na" })).toMatchObject({ campo: "display_name" });
  });
});
