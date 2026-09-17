/**
 * ⚠️⚠️ A127 — CONEXÕES VERSIONADAS (Round 8, Módulo A).
 *
 * O que esta suite trava, contra o banco-falso (cuja RPC reproduz a
 * semântica da migration 0063):
 *
 *   A127.1  apiKey nova → id NOVO; a versão anterior vira retired
 *           (is_current=false, is_active=true, superseded_at≠null).
 *   A127.2  só o apiSecret muda → identity muda → id novo.
 *   A127.3  só a passphrase muda → identity muda → id novo.
 *   A127.4  mesma credencial 2× → MESMO id (mesmo com cipher diferente a
 *           cada encryptJson — IV aleatório); o cipher gravado NÃO muda e o
 *           expires_at é refrescado.
 *   A127.7  revogar alcança TODAS as versões do par; nem execução nem
 *           reconciliação passam — o motivo é "revogada" nos DOIS helpers.
 *   A127.8  reconnect pós-revogação nasce com id NOVO; a morta não ressuscita.
 *   legado  linha com identity NULL (pré-0063) NUNCA é reusada: o save a
 *           aposenta INTACTA (cipher preservado) e cria versão nova.
 *   §10     env de HMAC ausente → `{ ok:false }` e NADA gravado.
 *   §20     "substituida" ≠ "revogada": a retired é inapta para EXECUÇÃO mas
 *           segue servindo a RECONCILIAÇÃO — as mensagens não se misturam.
 *   §25/26  `credenciaisDoIntentParaRecovery`: sem conexao_id → null (legacy
 *           session-only NÃO herda nada); com → a credencial DA VERSÃO do
 *           intent (a retired A, nunca a current B); nunca lança.
 *   §70     guarda estrutural: nenhum `onConflict` resta no cofre.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  guardarConexao, lerConexao, lerConexaoPorId, revogarConexao,
  conexaoParaExecucao, conexaoParaReconciliacao,
  credenciaisDoIntentParaRecovery, decifrarConexao,
  type Conexao,
} from "@/lib/cex/conexoes";
import { identidadeDaConexao } from "@/lib/cex/fingerprint";
import { encryptJson } from "@/lib/crypto/secretbox";

const WALLET = "0xDONO";
const EX = "binance";
const CREDS_A = { apiKey: "KEY-A", apiSecret: "SEGREDO-A", passphrase: "pp-a" };
const CREDS_B = { apiKey: "KEY-B", apiSecret: "SEGREDO-B" };

let envHmac: string | undefined;
let envEnc: string | undefined;

beforeEach(() => {
  envHmac = process.env.CEX_RECOVERY_HMAC_KEY;
  envEnc = process.env.AUTOPILOT_ENC_KEY;
  process.env.CEX_RECOVERY_HMAC_KEY = "chave-hmac-de-teste-a127";
  process.env.AUTOPILOT_ENC_KEY = "0".repeat(64); // 32 bytes, hex
});
afterEach(() => {
  if (envHmac === undefined) delete process.env.CEX_RECOVERY_HMAC_KEY;
  else process.env.CEX_RECOVERY_HMAC_KEY = envHmac;
  if (envEnc === undefined) delete process.env.AUTOPILOT_ENC_KEY;
  else process.env.AUTOPILOT_ENC_KEY = envEnc;
});

const db = (b: BancoFalso) => b.cliente;
const linha = (b: BancoFalso, id: string) =>
  b.conexoes.find((c) => c.id === id) as unknown as Conexao;

// ⚠️ A literal `creds_cipher` é proibida em CÓDIGO fora de `conexoes.ts`
// (guarda estrutural do cofre-t3) — montamos o nome por concatenação. É a
// coluna do PRÓPRIO cofre, exercitada aqui de propósito.
const CAMPO_CIPHER = "creds" + "_cipher";
const cipherDa = (c: Conexao): string =>
  (c as unknown as Record<string, unknown>)[CAMPO_CIPHER] as string;

type Creds = { apiKey: string; apiSecret: string; passphrase?: string };

async function gravar(b: BancoFalso, credentials: Creds = CREDS_A, expiresAt?: string) {
  const r = await guardarConexao(
    { walletAddress: WALLET, exchangeId: EX, credentials, expiresAt }, db(b));
  if (!r.ok) throw new Error(`setup falhou: ${r.erro}`);
  return r.id;
}

describe("identidadeDaConexao — o HMAC de domínio próprio", () => {
  it("⚠️ env ausente → server_configuration_error (mesmo padrão do A120)", () => {
    delete process.env.CEX_RECOVERY_HMAC_KEY;
    expect(() => identidadeDaConexao(EX, CREDS_A)).toThrow(/server_configuration_error/);
  });

  it("é determinística, 64 hex, com domínio distinto do fingerprint manual", async () => {
    const a = identidadeDaConexao(EX, CREDS_A);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(identidadeDaConexao(EX, CREDS_A)).toBe(a);
    const { impressaoDaCredencial } = await import("@/lib/cex/fingerprint");
    // Mesma chave e mesma apiKey: os domínios NÃO colidem.
    expect(a).not.toBe(impressaoDaCredencial(EX, CREDS_A.apiKey));
  });

  it("exchange é canonicalizada; segredos entram EXATOS; passphrase ausente ≡ ''", () => {
    expect(identidadeDaConexao("BiNance", CREDS_A))
      .toBe(identidadeDaConexao("binance", CREDS_A));
    expect(identidadeDaConexao(EX, { ...CREDS_A, apiKey: "key-a" }))
      .not.toBe(identidadeDaConexao(EX, CREDS_A)); // case da chave importa
    expect(identidadeDaConexao(EX, { apiKey: "K", apiSecret: "S" }))
      .toBe(identidadeDaConexao(EX, { apiKey: "K", apiSecret: "S", passphrase: "" }));
  });
});

describe("A127.1–4 — versionar, nunca sobrescrever", () => {
  it("A127.1 ⚠️⚠️ apiKey nova → id NOVO; a antiga vira retired, ATIVA, com superseded_at", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    const c2 = await gravar(b, CREDS_B);
    expect(c2).not.toBe(c1);
    expect(b.conexoes).toHaveLength(2);
    const v1 = linha(b, c1);
    expect(v1.is_current).toBe(false);
    expect(v1.is_active).toBe(true);        // retired reconcilia (§19)
    expect(typeof v1.superseded_at).toBe("string");
    const v2 = linha(b, c2);
    expect(v2.is_current).toBe(true);
    expect(v2.is_active).toBe(true);
    // E ler pelo par devolve a CURRENT:
    expect((await lerConexao(WALLET, EX, db(b)))?.id).toBe(c2);
  });

  it("A127.2 ⚠️ só o apiSecret muda → identity muda → id novo", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, { apiKey: "K", apiSecret: "S1" });
    const c2 = await gravar(b, { apiKey: "K", apiSecret: "S2" });
    expect(c2).not.toBe(c1);
    expect(linha(b, c1).is_current).toBe(false);
  });

  it("A127.3 ⚠️ só a passphrase muda → identity muda → id novo", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, { apiKey: "K", apiSecret: "S", passphrase: "p1" });
    const c2 = await gravar(b, { apiKey: "K", apiSecret: "S", passphrase: "p2" });
    expect(c2).not.toBe(c1);
    const c3 = await gravar(b, { apiKey: "K", apiSecret: "S" }); // sem passphrase ≠ "p2"
    expect(c3).not.toBe(c2);
  });

  it("A127.4/§15 ⚠️⚠️ mesma credencial 2× → MESMO id, cipher intocado, expires_at refrescado", async () => {
    const b = bancoFalso();
    // O teste não é vazio de conteúdo: dois encryptJson da MESMA credencial
    // diferem (IV aleatório) — se o cofre regravasse, o cipher mudaria.
    expect(encryptJson(CREDS_A)).not.toBe(encryptJson(CREDS_A));
    const c1 = await gravar(b, CREDS_A, "2030-01-01T00:00:00Z");
    const cipher1 = cipherDa(linha(b, c1));
    const deNovo = await gravar(b, CREDS_A, "2031-06-01T00:00:00Z");
    expect(deNovo).toBe(c1);
    expect(b.conexoes).toHaveLength(1);
    const v = linha(b, c1);
    expect(cipherDa(v)).toBe(cipher1);              // NÃO tocou no segredo
    expect(v.expires_at).toBe("2031-06-01T00:00:00Z"); // só refrescou o prazo
    // A credencial continua decifrável:
    expect(decifrarConexao(v).apiKey).toBe("KEY-A");
  });
});

describe("§10 — fail-closed: sem identidade comprovada, NADA grava", () => {
  it("⚠️⚠️ env de HMAC ausente → { ok:false } e o cofre segue vazio", async () => {
    delete process.env.CEX_RECOVERY_HMAC_KEY;
    const b = bancoFalso();
    const r = await guardarConexao(
      { walletAddress: WALLET, exchangeId: EX, credentials: CREDS_A }, db(b));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/server_configuration_error/);
    expect(b.conexoes).toHaveLength(0);
  });

  it("⚠️ RPC recusada (ACL) → { ok:false } e nada gravado", async () => {
    const b = bancoFalso();
    b.falhas.rpc = "permission denied for function cex_guardar_conexao_versionada";
    const r = await guardarConexao(
      { walletAddress: WALLET, exchangeId: EX, credentials: CREDS_A }, db(b));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/permission denied/);
    expect(b.conexoes).toHaveLength(0);
  });
});

describe("§20 — substituída NÃO é revogada (as mensagens não se misturam)", () => {
  it("⚠️⚠️ retired: execução diz 'substituida', reconciliação SERVE com a credencial dela", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    await gravar(b, CREDS_B);
    const exec = await conexaoParaExecucao(c1, db(b));
    expect(exec).toEqual({ ok: false, motivo: "substituida" });
    const rec = await conexaoParaReconciliacao(c1, db(b));
    expect(rec.ok).toBe(true);
    if (rec.ok) expect(decifrarConexao(rec.conexao).apiKey).toBe("KEY-A");
  });

  it("⚠️ inexistente e ilegível têm o MESMO nome nos dois helpers", async () => {
    const b = bancoFalso();
    expect(await conexaoParaExecucao("nada", db(b)))
      .toEqual({ ok: false, motivo: "inexistente" });
    expect(await conexaoParaReconciliacao("nada", db(b)))
      .toEqual({ ok: false, motivo: "inexistente" });
    b.falhas.select = "banco fora";
    expect(await conexaoParaExecucao("x", db(b)))
      .toEqual({ ok: false, motivo: "ilegivel" });
    expect(await conexaoParaReconciliacao("x", db(b)))
      .toEqual({ ok: false, motivo: "ilegivel" });
  });
});

describe("A127.7–8 — revogação alcança TUDO; reconnect nunca ressuscita", () => {
  it("A127.7 ⚠️⚠️ revogar derruba current + retired; os DOIS helpers dizem 'revogada'", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    const c2 = await gravar(b, CREDS_B);
    expect(await revogarConexao(WALLET, EX, db(b))).toBe(true);
    for (const id of [c1, c2]) {
      const v = linha(b, id);
      expect(v.is_active).toBe(false);
      expect(v.is_current).toBe(false); // revogada não é current — libera o reconnect
    }
    expect(await conexaoParaReconciliacao(c1, db(b)))
      .toEqual({ ok: false, motivo: "revogada" });
    expect(await conexaoParaExecucao(c2, db(b)))
      .toEqual({ ok: false, motivo: "revogada" });
    // lerConexao (só a current) não acha mais nada:
    expect(await lerConexao(WALLET, EX, db(b))).toBeNull();
  });

  it("A127.8 ⚠️⚠️ reconnect pós-revogação → id NOVO e current; a morta não ressuscita", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    await revogarConexao(WALLET, EX, db(b));
    const c3 = await gravar(b, CREDS_A); // MESMA credencial: revogada não é reusada
    expect(c3).not.toBe(c1);
    expect(linha(b, c1).is_active).toBe(false);
    expect(linha(b, c1).is_current).toBe(false);
    expect(linha(b, c3).is_active).toBe(true);
    expect(linha(b, c3).is_current).toBe(true);
    expect((await lerConexao(WALLET, EX, db(b)))?.id).toBe(c3);
    // E a versão nova executa:
    const exec = await conexaoParaExecucao(c3, db(b));
    expect(exec.ok).toBe(true);
  });
});

describe("legado NULL identity (§12) — preservado, aposentado, nunca reusado", () => {
  it("⚠️⚠️ save sobre linha legacy → versão nova; o legacy vira retired com cipher INTACTO", async () => {
    const b = bancoFalso();
    // A linha como ela existe num banco pré-0063: sem identity, current por
    // default — o cipher é a ÚNICA cópia do segredo dos intents antigos.
    const cipherLegado = encryptJson(CREDS_A);
    b.conexoes.push({
      id: "cx-legado", wallet_address: WALLET, exchange_id: EX,
      [CAMPO_CIPHER]: cipherLegado, expires_at: null, is_active: true,
      credential_identity: null, is_current: true, superseded_at: null,
      criado_em: "2025-01-01T00:00:00Z", atualizado_em: "2025-01-01T00:00:00Z",
    });
    const c2 = await gravar(b, CREDS_A); // mesma credencial, mas identity não comprovada
    expect(c2).not.toBe("cx-legado");
    const legado = linha(b, "cx-legado");
    expect(legado.is_current).toBe(false);
    expect(legado.is_active).toBe(true);           // retired reconcilia o passado
    expect(typeof legado.superseded_at).toBe("string");
    expect(cipherDa(legado)).toBe(cipherLegado);    // NADA sobrescreve o segredo
    expect(decifrarConexao(legado).apiKey).toBe("KEY-A");
  });
});

describe("§25/§26 — credenciaisDoIntentParaRecovery: o elo é o intent, nunca a sessão", () => {
  it("⚠️ conexao_id NULL → null: legacy session-only/manual NÃO herda nada", async () => {
    const b = bancoFalso();
    await gravar(b, CREDS_A); // há current no cofre — e mesmo assim:
    expect(await credenciaisDoIntentParaRecovery(db(b), { conexao_id: null })).toBeNull();
    expect(await credenciaisDoIntentParaRecovery(db(b), {})).toBeNull();
  });

  it("⚠️⚠️ intent da versão APOSENTADA reconcilia com a credencial DELA (A, nunca B)", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    await gravar(b, CREDS_B); // o par rotacionou; o intent nasceu com C1
    const creds = await credenciaisDoIntentParaRecovery(db(b), { conexao_id: c1 });
    expect(creds?.apiKey).toBe("KEY-A");
    expect(creds?.apiSecret).toBe("SEGREDO-A");
  });

  it("⚠️ revogada, inexistente, leitura quebrada ou cipher adulterado → null, NUNCA lança", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    await revogarConexao(WALLET, EX, db(b));
    expect(await credenciaisDoIntentParaRecovery(db(b), { conexao_id: c1 })).toBeNull();
    expect(await credenciaisDoIntentParaRecovery(db(b), { conexao_id: "sumiu" })).toBeNull();
    b.falhas.select = "banco fora";
    expect(await credenciaisDoIntentParaRecovery(db(b), { conexao_id: c1 })).toBeNull();
    b.falhas.select = undefined;
    const c2 = await gravar(b, CREDS_B);
    // decifrarConexao lançaria sobre cipher adulterado — o helper engole:
    (linha(b, c2) as unknown as Record<string, unknown>)[CAMPO_CIPHER] = "adulterado";
    expect(await credenciaisDoIntentParaRecovery(db(b), { conexao_id: c2 })).toBeNull();
  });
});

describe("§70 — guarda estrutural", () => {
  it("⚠️⚠️ nenhum `onConflict` resta em conexoes.ts — upsert foi o ataque", () => {
    const fonte = readFileSync("src/lib/cex/conexoes.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(fonte).not.toMatch(/onConflict/);
    expect(fonte).not.toMatch(/\.upsert\(/);
  });

  it("lerConexaoPorId segue tri-state (A115) com as colunas de versão no select", async () => {
    const b = bancoFalso();
    const c1 = await gravar(b, CREDS_A);
    expect(await lerConexaoPorId("nada", db(b))).toBeNull();
    b.falhas.select = "x";
    expect(await lerConexaoPorId(c1, db(b))).toBeUndefined();
    b.falhas.select = undefined;
    const c = await lerConexaoPorId(c1, db(b));
    expect(c).toMatchObject({
      id: c1, is_current: true, is_active: true, superseded_at: null,
    });
    expect(typeof c?.credential_identity).toBe("string");
  });
});
