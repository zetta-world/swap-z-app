/**
 * TOKEN DE VERIFICAÇÃO — formato, hash em repouso e paridade com a 0069.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  gerarToken, hashToken, tokenValido, TOKEN_FORMATO, HASH_FORMATO,
  TOKEN_TTL_HORAS, RETENCAO_NAO_VERIFICADO_DIAS,
} from "./token";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0069_early_access_email_optin.sql"), "utf8");

describe("① geração", () => {
  it("43 caracteres base64url (32 bytes), todos distintos em 200 amostras", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = gerarToken();
      expect(t).toMatch(TOKEN_FORMATO);
      expect(Buffer.from(t, "base64url")).toHaveLength(32);
      vistos.add(t);
    }
    expect(vistos.size).toBe(200);
  });
});

describe("② hash em repouso", () => {
  // token fixo e determinístico (sem aleatoriedade em controle negativo)
  const T = "A".repeat(42) + "w";
  it("sha256 hex com separação de domínio — e NUNCA o token", () => {
    const h = hashToken(T)!;
    expect(h).toMatch(HASH_FORMATO);
    expect(h).toBe(createHash("sha256").update(`zswap-ea:verify\u0000${T}`).digest("hex"));
    expect(h).not.toBe(createHash("sha256").update(T).digest("hex"));
    expect(h).not.toContain(T);
  });
  it("⚠️ token fora do formato não vira hash (nem chega ao banco)", () => {
    for (const t of ["", "curto", T + "x", T.slice(1) + "=", T.slice(1) + "+", T.slice(1) + "/"]) {
      expect(hashToken(t), JSON.stringify(t)).toBeNull();
      expect(tokenValido(t)).toBe(false);
    }
  });
  it("⚠️ o hash bate com o CHECK da 0069", () => {
    expect(SQL).toMatch(/constraint eav_hash_formato\s+check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });
});

describe("③ constantes aprovadas pelo dono moram no SQL (D-3)", () => {
  it("TTL de 24 h é CHECK da tabela, e o espelho TS é o mesmo número", () => {
    expect(TOKEN_TTL_HORAS).toBe(24);
    expect(SQL).toMatch(/constraint eav_ttl_24h\s+check \(expires_at = created_at \+ interval '24 hours'\)/);
    expect(SQL).toMatch(/values \(p_signup, p_hash, p_tentativa, now\(\) \+ interval '24 hours'\)/);
  });
  it("retenção de não verificado: 7 dias, constante na purga", () => {
    expect(RETENCAO_NAO_VERIFICADO_DIAS).toBe(7);
    expect(SQL).toMatch(/where email_verified_at is null and created_at < now\(\) - interval '7 days'/);
  });
  it("⚠️ um token ativo por inscrição (unique parcial) e reenvio revoga os anteriores", () => {
    expect(SQL).toMatch(/early_access_verificacao_ativa_uq\s+on public\.early_access_verificacoes \(signup_id\) where consumed_at is null and revoked_at is null/);
    // EA2-IA02: a revogação mora DENTRO da emissão (motivo por parâmetro), depois das checagens
    expect(SQL).toMatch(/set revoked_at = now\(\), revoked_reason = p_motivo_revogacao\s+where signup_id = p_signup and consumed_at is null and revoked_at is null/);
    expect(SQL).toMatch(/ea_interno_emitir\(v_ex\.id, p_token_hash, 1, true, 'superseded'\)/);
  });
  it("⚠️ D-4: aprovar exige email verificado — CHECK de tabela e erro na RPC", () => {
    expect(SQL).toMatch(/constraint ea_aprovado_exige_email check \(status <> 'approved' or email_verified_at is not null\)/);
    expect(SQL).toMatch(/if p_para = 'approved' and v_verif is null then\s+raise exception 'early_access_email_nao_verificado'/);
  });
  it("⚠️⚠️ EA2-A02: marketing confirmado = escolha explícita do titular (sem escolha = opt-out), nunca a declaração", () => {
    const corpo = SQL.slice(SQL.indexOf("function public.early_access_confirmar_email"));
    const fn = corpo.slice(0, corpo.indexOf("$$;", corpo.indexOf("$$") + 2));
    expect(fn).toMatch(/p_marketing_opt_in boolean default null/);
    expect(fn).toMatch(/marketing_efetivo\s+= coalesce\(p_marketing_opt_in, false\)/);
    // EA2-IA05: a versão registrada é a APRESENTADA (conferida contra a da inscrição)
    expect(fn).toMatch(/'marketing', p_versao_privacidade, coalesce\(p_marketing_opt_in, false\), 'email_confirmation'/);
    expect(fn).toMatch(/if p_versao_termos is distinct from v_s\.terms_version\s+or p_versao_privacidade is distinct from v_s\.privacy_version then\s+raise exception 'early_access_versao_divergente'/);
    expect(fn).not.toMatch(/v_s\.marketing_opt_in/);
    expect(SQL).toMatch(/constraint ea_marketing_escolha_exige_email check \(marketing_escolhido_em is null or email_verified_at is not null\)/);
    expect(SQL).toMatch(/constraint ea_marketing_efetivo_exige_escolha check \(not marketing_efetivo or marketing_escolhido_em is not null\)/);
  });
  it("⚠️⚠️ EA2-A02 (reprova): `marketing_efetivo` só é ESCRITO num lugar — a confirmação, pela escolha explícita", () => {
    // toda atribuição `marketing_efetivo = …` (SET de UPDATE) no SQL inteiro
    const escritas = [...SQL.matchAll(/marketing_efetivo\s*:?=\s*([^\n]+)/g)].map((m) => m[1].trim());
    expect(escritas).toEqual(["coalesce(p_marketing_opt_in, false),"]);
    expect(SQL).toMatch(/marketing_elegivel boolean\s+generated always as \(marketing_efetivo and email_suppressed_at is null\) stored/);
  });
  it("⚠️⚠️ EA2-IA01/IA02/IA03 travados na fonte", () => {
    expect(SQL).toMatch(/send_status in \('pending','sent','failed','dead'\)/);
    expect(SQL).toMatch(/case when p_ok then 'sent' when p_transitorio then 'failed' else 'dead' end/);
    // a fila só pega 'failed' (ou pending velho) — 'dead' nunca
    const fila = SQL.slice(SQL.indexOf("function public.early_access_pendentes_de_envio"));
    expect(fila.slice(0, fila.indexOf("$$;", fila.indexOf("$$") + 2))).not.toMatch(/'dead'/);
    // reemitir não revoga antes de emitir
    const re = SQL.slice(SQL.indexOf("function public.early_access_reemitir"));
    const corpoRe = re.slice(0, re.indexOf("$$;", re.indexOf("$$") + 2));
    expect(corpoRe).not.toMatch(/set revoked_at/);
    expect(corpoRe).toMatch(/ea_interno_emitir\(v_sid, p_token_hash, v_t\.tentativa \+ 1, false, 'send_failed'\)/);
    // webhook: só hash do evento, sem provider_message_id
    const wh = SQL.slice(SQL.indexOf("create table if not exists public.early_access_webhook_eventos"));
    expect(wh.slice(0, wh.indexOf(");"))).not.toMatch(/provider_message_id|evento_id\s/);
  });
  it("⚠️⚠️ EA2-IA07: a rota de transição só escreve o CÓDIGO no log persistente (trava de fonte)", () => {
    const rota = readFileSync(join(process.cwd(), "src/app/admin/api/early-access/transition/route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const chamadas = [...rota.matchAll(/logAdminAction\(([^;]*)\);/g)].map((m) => m[1]);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatch(/\{ de: r\.de, para: r\.para, motivo_codigo: codigo \}/);
    expect(chamadas[0]).not.toMatch(/nota|note|motivoRegistro|reason/);
    // e nenhuma escrita do banco em admin_audit_log a partir das RPCs da 0069
    expect(SQL).not.toMatch(/insert into public\.admin_audit_log/i);
  });
  it("⚠️ a 0068 não foi editada (a correção é migration nova)", () => {
    const m0068 = readFileSync(join(process.cwd(), "supabase/migrations/0068_early_access.sql"), "utf8");
    expect(m0068).toMatch(/constraint ea_evento_kind  check \(kind in \('created','duplicate_attempt','status_changed'\)\)/);
    expect(m0068).not.toMatch(/verificacoes|email_verified_at is not null\)/);
  });
});
