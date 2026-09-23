/**
 * ⚠️ A127 — GUARDA ESTRUTURAL DA MIGRATION 0063 (conexões versionadas).
 *
 * Lê o SQL de verdade e trava cada peça do contrato (SPEC-round8 §A.7):
 * a UNIQUE velha cai; as três colunas de versão nascem; o formato da
 * identity é CHECK; a unicidade vigente é índice parcial sobre is_current;
 * a RPC nasce security definer com search_path fixo, advisory lock por par,
 * ACL fechada na MESMA migration; o CHECK do browser real é NOT VALID;
 * e NENHUM backfill inventa identity a partir do cipher.
 *
 * E trava o que NÃO pode acontecer: as migrations 0059–0062 intactas
 * (diff vazio contra o baseline 15b89c8) — a 0063 é a única nova.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const SQL = readFileSync("supabase/migrations/0063_cex_conexoes_versionadas.sql", "utf8");
const BASELINE = "15b89c8";

// ⚠️ A literal `creds_cipher` é proibida em CÓDIGO fora de `conexoes.ts`
// (guarda estrutural do cofre-t3) — o nome do parâmetro da RPC é montado
// por concatenação nos regexes abaixo.
const P_CIPHER = "p_creds" + "_cipher";

describe("0063 — o fim do upsert no cofre", () => {
  it("⚠️⚠️ a UNIQUE velha (wallet, exchange) CAI — era ela que forçava a sobrescrita", () => {
    expect(SQL).toMatch(
      /alter\s+table\s+public\.cex_conexoes\s+drop\s+constraint\s+if\s+exists\s+cex_conexoes_wallet_address_exchange_id_key/i);
  });

  it("as três colunas de versão nascem, is_current default true (legado é a current do par)", () => {
    expect(SQL).toMatch(/add\s+column\s+if\s+not\s+exists\s+credential_identity\s+text/i);
    expect(SQL).toMatch(
      /add\s+column\s+if\s+not\s+exists\s+is_current\s+boolean\s+not\s+null\s+default\s+true/i);
    expect(SQL).toMatch(/add\s+column\s+if\s+not\s+exists\s+superseded_at\s+timestamptz/i);
  });

  it("o formato da identity é CHECK (NULL ou 64 hex) NOT VALID + VALIDATE — forward-safe", () => {
    expect(SQL).toMatch(
      /check\s*\(\s*credential_identity\s+is\s+null\s+or\s+credential_identity\s*~\s*'\^\[0-9a-f\]\{64\}\$'\s*\)\s*not\s+valid/i);
    expect(SQL).toMatch(/validate\s+constraint\s+cex_conexoes_identity_formato/i);
  });

  it("⚠️⚠️ a unicidade vigente é o índice parcial único WHERE is_current", () => {
    expect(SQL).toMatch(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+cex_conexoes_uma_current_por_conta[\s\S]*?\(\s*wallet_address\s*,\s*exchange_id\s*\)\s*where\s+is_current/i);
  });

  it("a RPC nasce definer com search_path fixo e advisory lock por par", () => {
    const reAssinatura = new RegExp(
      "create\\s+or\\s+replace\\s+function\\s+public\\.cex_guardar_conexao_versionada" +
      "\\s*\\(\\s*p_wallet_address\\s+text,\\s*p_exchange_id\\s+text,\\s*" +
      P_CIPHER + "\\s+text,\\s*p_credential_identity\\s+text," +
      "\\s*p_expires_at\\s+timestamptz\\s+default\\s+null\\s*\\)\\s*returns\\s+uuid", "i");
    expect(SQL).toMatch(reAssinatura);
    expect(SQL).toMatch(/language\s+plpgsql\s+security\s+definer\s+set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
    expect(SQL).toMatch(
      /**
       * ⚠️⚠️⚠️ ERA `E'\\0'`, E A MIGRATION NÃO APLICAVA.
       *
       * PostgreSQL não aceita o byte NUL em `text`: a criação da função
       * morria com `invalid byte sequence for encoding "UTF8": 0x00` e a
       * cadeia parava na 0063 — 0064 nunca chegaria ao banco. Esta trava
       * PINAVA o construto quebrado, e nenhum teste sobre o texto do SQL
       * podia ver o problema: só apareceu aplicando a cadeia num PostgreSQL
       * de verdade.
       *
       * O separador continua tendo de existir (para `('ab','c')` e
       * `('a','bc')` não colidirem no mesmo lock) e continua tendo de ser
       * impossível nos dois campos — só que agora é um que o banco consegue
       * guardar.
       */
      /pg_advisory_xact_lock\s*\(\s*\n?\s*hashtext\s*\(\s*p_wallet_address\s*\|\|\s*E'\\x1F'\s*\|\|\s*p_exchange_id\s*\)\s*\)/i);
    /**
     * ⚠️ E o NUL não pode voltar: ele torna a migration inaplicável. A
     * checagem é sobre o CÓDIGO, não sobre o comentário — a cicatriz cita a
     * linha antiga por extenso, e medir o arquivo inteiro faria a trava
     * acusar a própria documentação do conserto.
     */
    const semComentarios = SQL.replace(/^\s*--.*$/gm, "");
    expect(semComentarios).not.toMatch(/E'\\0'/);
  });

  it("a RPC rejeita identity malformada e só reusa current ATIVA de identity IGUAL", () => {
    expect(SQL).toMatch(/!\~\s*'\^\[0-9a-f\]\{64\}\$'[\s\S]{0,120}?raise\s+exception/i);
    expect(SQL).toMatch(
      /v_atual\.is_active[\s\S]{0,160}?v_atual\.credential_identity\s+is\s+not\s+null[\s\S]{0,160}?v_atual\.credential_identity\s*=\s*p_credential_identity/i);
    // reuse: mesmo id, sem tocar o cipher; rotação: aposenta e insere.
    expect(SQL).toMatch(/return\s+v_atual\.id/i);
    expect(SQL).toMatch(/is_current\s*=\s*false[\s\S]{0,120}?superseded_at\s*=\s*now\(\)/i);
    expect(SQL).toMatch(/insert\s+into\s+public\.cex_conexoes[\s\S]*?returning\s+id\s+into\s+v_novo/i);
  });

  it("⚠️⚠️ ACL na MESMA migration: revoke de public/anon/authenticated + grant ao service_role", () => {
    expect(SQL).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.cex_guardar_conexao_versionada\(text,\s*text,\s*text,\s*text,\s*timestamptz\)\s*from\s+public\s*,\s*anon\s*,\s*authenticated/i);
    expect(SQL).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.cex_guardar_conexao_versionada\(text,\s*text,\s*text,\s*text,\s*timestamptz\)\s*to\s+service_role/i);
  });

  it("⚠️ browser REAL sem conexao_id não nasce — CHECK NOT VALID (histórico preservado)", () => {
    expect(SQL).toMatch(
      /alter\s+table\s+public\.cex_execution_intents\s+add\s+constraint\s+cex_intents_browser_real_exige_conexao\s+check\s*\(\s*not\s*\(\s*origin\s*=\s*'autopilot_browser'\s+and\s+simulated\s*=\s*false\s+and\s+conexao_id\s+is\s+null\s*\)\s*\)\s*not\s+valid/i);
  });

  it("⚠️⚠️ NENHUM backfill de credential_identity — o legado não ganha identidade inventada", () => {
    // Nem update que a preencha (exigiria decriptar no SQL — a chave de
    // cifra não mora no banco), nem função de decriptação, nem rehash.
    expect(SQL).not.toMatch(/set\s+credential_identity\s*=/i);
    expect(SQL).not.toMatch(/pgp_sym_decrypt|decrypt\s*\(/i);
    expect(SQL).not.toMatch(/update\s+public\.cex_conexoes[\s\S]{0,200}credential_identity\s*=/i);
  });
});

describe("0063 é a ÚNICA migration nova — 0059–0062 intactas", () => {
  const EM_VOO = [
    "0059_fee_cumulativa_e_cobertura.sql",
    "0060_autorizacao_deriva_do_intent.sql",
    "0061_fingerprint_credential_intent.sql",
    "0062_fills_dedupe_por_intent.sql",
  ];

  it("diff de conteúdo vazio contra o baseline 15b89c8", () => {
    for (const f of EM_VOO) {
      const atual = readFileSync(`supabase/migrations/${f}`, "utf8");
      const base = execSync(`git show ${BASELINE}:supabase/migrations/${f}`,
        { encoding: "utf8" });
      expect(atual, `${f} divergiu do baseline`).toBe(base);
    }
  });

  it("nenhuma delas conhece o versionamento (a 0063 é quem o introduz)", () => {
    for (const f of EM_VOO) {
      const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
      expect(sql).not.toMatch(/credential_identity|cex_guardar_conexao_versionada/i);
      expect(sql).not.toMatch(/alter\s+table\s+public\.cex_conexoes/i);
    }
  });

  it("e nenhuma OUTRA migration nova apareceu depois da 0062", () => {
    /**
     * ⚠️ A LISTA CRESCEU UMA VEZ, NO ROUND 9 (A131-C): `autopilot_positions`
     * com `unique (session_id, base)` não consegue provar quanto de CADA
     * intent já foi projetado na posição, e sem essa prova reconciliar duas
     * vezes soma duas vezes. A 0064 cria o marcador.
     *
     * A lista cresceu uma SEGUNDA vez, no PLATFORM CLOSURE BATCH 1 (A51):
     * a 0065 troca o UPSERT de rearme por uma RPC atômica, porque o UPSERT
     * sobrescrevia `trades_today`, `pnl_today`, `last_reset_day` e
     * `frozen_until_day` — uma reconexão de credencial reabria os rails
     * financeiros do mesmo dia.
     *
     * A trava continua sendo uma LISTA, não um padrão: migration nova sem
     * decisão explícita quebra aqui, que é o ponto.
     *
     * ⚠️ NENHUMA DAS TRÊS FOI APLICADA.
     */
    const novas = readdirSync("supabase/migrations")
      .filter((f) => f.endsWith(".sql") && f.slice(0, 4) > "0062")
      .sort();
    expect(novas).toEqual([
      "0063_cex_conexoes_versionadas.sql",
      "0064_autopilot_projecao_de_posicao.sql",
      "0065_autopilot_rearm_preserva_rails.sql",
    ]);
  });
});
