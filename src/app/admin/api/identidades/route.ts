import { NextRequest, NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { avisoDeAuditoria, comandoAuditado, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
import { repoCorp } from "@/lib/admin/corp/repo";
import { novoCodigoDeAtivacao } from "@/lib/admin/corp/fluxo";
import { PAPEIS, type Papel } from "@/lib/admin/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SEM_CACHE = { "Cache-Control": "no-store" };
const ATIVACAO_H = 72;
/** Papéis que exigem SEGUNDA pessoa (CHECK da 0083 + design §4.8). Sem o fluxo de aprovação, só o runbook SQL. */
const PAPEIS_DUPLOS: ReadonlySet<Papel> = new Set(["superadmin", "security_admin"]);

/**
 * IDENTIDADES CORPORATIVAS DO ADMIN (R1) — `admin_private.admin_identities` / `admin_role_assignments`.
 *
 * GET  (`identity.read`) — lista identidades com papéis ativos (sem hash de ativação).
 * POST (`identity.invite | identity.revoke | roles.grant | roles.revoke`, step-up, trilha durável):
 *   · `{ acao: "convidar", email, provider, issuer, tenant, rotulo? }` → devolve o CÓDIGO DE ATIVAÇÃO
 *     UMA vez (entregar fora de banda; 72 h; só o hash fica no banco);
 *   · `{ acao: "revogar", id, motivo }` → identidade + todas as sessões revogadas;
 *   · `{ acao: "conceder", id, papel }` · `{ acao: "revogar_papel", atribuicao, motivo }`.
 * Invariantes: ninguém concede papel a si; não se revoga a si nem o ÚLTIMO superadmin (ADM-009);
 * `superadmin`/`security_admin` exigem aprovação de outra pessoa → até o fluxo de aprovação existir,
 * só pelo runbook SQL do dono (design §9.5). Concessão exige principal CORPORATIVO (granted_by = identidade).
 */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("identity.corp.list");
  const r = await repoCorp().listarIdentidades(new Date().toISOString());
  if (!r.ok) return NextResponse.json({ error: "identidades_ilegiveis", state: "unavailable", porque: "não consegui ler admin_private (schema exposto? 0083 aplicada?)" }, { status: 503, headers: SEM_CACHE });
  return NextResponse.json({ identidades: r.valor, fetchedAt: new Date().toISOString() }, { headers: SEM_CACHE });
}

const idDoCorp = (wallet: string) => (wallet.startsWith("corp:") ? wallet.slice(5) : null);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: ator, fonte } = await autorizarAdmin("identity.corp.write");
  const corpo = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!corpo || typeof corpo.acao !== "string") return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: SEM_CACHE });
  const repo = repoCorp();
  const agora = new Date().toISOString();
  const eu = idDoCorp(ator);
  const recusa = (error: string, porque: string, status = 400) => NextResponse.json({ error, porque }, { status, headers: SEM_CACHE });

  if (corpo.acao === "convidar") {
    const email = typeof corpo.email === "string" ? corpo.email.trim().toLowerCase() : "";
    const provider = corpo.provider === "google" || corpo.provider === "azure" ? corpo.provider : null;
    const issuer = typeof corpo.issuer === "string" ? corpo.issuer.trim() : "";
    const tenant = typeof corpo.tenant === "string" ? corpo.tenant.trim() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return recusa("email_invalido", "e-mail inválido");
    if (!provider || !/^https:\/\//.test(issuer) || !tenant) return recusa("idp_invalido", "provider google|azure, issuer https://… e tenant obrigatórios");
    // Bootstrap (design §5): em `dual`, só a carteira de ADMIN_WALLETS (fonte env) convida sem ser corporativa.
    if (!eu && fonte !== "env" && fonte !== "breakglass") return recusa("so_corporativo", "convite exige identidade corporativa (ou a carteira de ADMIN_WALLETS no bootstrap)", 403);
    const { codigo, hash } = novoCodigoDeAtivacao();
    const r = await comandoAuditado({
      acao: "identity.invite", ator, alvo: `${email.slice(0, 3)}…@${email.split("@")[1]}`, dados: { provider },
      executar: async () => {
        const g = await repo.convidar({ email, provider, issuer, tenant, label: typeof corpo.rotulo === "string" ? corpo.rotulo.slice(0, 80) : null,
          codigoHash: hash, expira: new Date(Date.now() + ATIVACAO_H * 3600_000).toISOString(), por: eu ?? "" });
        return g.ok && g.valor ? { ok: true, valor: g.valor } : { ok: false, codigo: "nao_gravou", detalhe: g.ok ? "sem id" : g.erro };
      },
    });
    if (r.estado === "recusado") return recusa("auditoria_indisponivel", PORQUE_AUDITORIA_INDISPONIVEL, 503);
    if (r.estado !== "executado") return recusa("nao_gravou", "o convite NÃO foi gravado (e-mail já convidado?)", 409);
    return NextResponse.json({ ok: true, id: r.valor, codigoAtivacao: codigo, validoPorHoras: ATIVACAO_H,
      porque: "entregue este código FORA DE BANDA; ele não aparece de novo", ...avisoDeAuditoria(r.auditoria) }, { headers: SEM_CACHE });
  }

  if (corpo.acao === "revogar") {
    if (!uuid(corpo.id) || typeof corpo.motivo !== "string" || corpo.motivo.trim().length < 5) return recusa("invalid_body", "id e motivo (≥5) obrigatórios");
    if (eu && corpo.id === eu) return recusa("nao_a_si", "ninguém revoga o próprio acesso por aqui", 409);
    const ids = await repo.listarIdentidades(agora);
    if (!ids.ok) return recusa("identidades_ilegiveis", "não consegui conferir os superadmins — NADA foi alterado", 503);
    const alvo = ids.valor.find((i) => i.id === corpo.id);
    if (!alvo) return recusa("nao_encontrada", "identidade não encontrada", 404);
    const supers = ids.valor.filter((i) => i.status === "active" && i.papeis.some((p) => p.role === "superadmin"));
    if (alvo.papeis.some((p) => p.role === "superadmin") && supers.length <= 1) return recusa("ultimo_superadmin", "não se revoga o ÚLTIMO superadmin ativo (ADM-009)", 409);
    // Revogar acesso é PROTETOR (D-AUD-1): contém incidente mesmo com a trilha fora.
    const r = await comandoAuditado({
      acao: "identity.revoke", ator, alvo: alvo.id, dados: { motivo: corpo.motivo.slice(0, 200) }, protetor: true,
      executar: async () => {
        const g = await repo.revogarIdentidade(alvo.id, eu ?? alvo.id, corpo.motivo as string);
        if (!g.ok || !g.valor) return { ok: false, codigo: "nao_gravou" };
        await repo.revogarTodasDaIdentidade(alvo.id, "identidade_revogada", eu);
        return { ok: true, valor: true };
      },
    });
    if (r.estado === "recusado") return recusa("auditoria_indisponivel", PORQUE_AUDITORIA_INDISPONIVEL, 503);
    if (r.estado !== "executado") return recusa("nao_gravou", "a revogação NÃO foi gravada", 503);
    return NextResponse.json({ ok: true, ...avisoDeAuditoria(r.auditoria) }, { headers: SEM_CACHE });
  }

  if (corpo.acao === "conceder") {
    if (!eu) return recusa("so_corporativo", "conceder papel exige identidade corporativa (granted_by)", 403);
    const papel = PAPEIS.find((p) => p === corpo.papel);
    if (!uuid(corpo.id) || !papel) return recusa("invalid_body", "id e papel válidos obrigatórios");
    if (corpo.id === eu) return recusa("nao_a_si", "ninguém concede papel a si", 409);
    if (PAPEIS_DUPLOS.has(papel)) return recusa("dupla_autorizacao", `${papel} exige aprovação de uma segunda pessoa — use o runbook SQL do dono (design §9.5) até o fluxo de aprovação existir`, 409);
    const r = await comandoAuditado({
      acao: "roles.grant", ator, alvo: corpo.id, dados: { papel },
      executar: async () => {
        const g = await repo.concederPapel(corpo.id as string, papel, eu);
        return g.ok && g.valor ? { ok: true, valor: g.valor } : { ok: false, codigo: "nao_gravou", detalhe: g.ok ? "" : g.erro };
      },
    });
    if (r.estado === "recusado") return recusa("auditoria_indisponivel", PORQUE_AUDITORIA_INDISPONIVEL, 503);
    if (r.estado !== "executado") return recusa("nao_gravou", "o papel NÃO foi concedido (já tem?)", 409);
    return NextResponse.json({ ok: true, atribuicao: r.valor, ...avisoDeAuditoria(r.auditoria) }, { headers: SEM_CACHE });
  }

  if (corpo.acao === "revogar_papel") {
    if (!eu && fonte !== "breakglass") return recusa("so_corporativo", "revogar papel exige identidade corporativa", 403);
    if (!uuid(corpo.atribuicao) || typeof corpo.motivo !== "string" || corpo.motivo.trim().length < 5) return recusa("invalid_body", "atribuicao e motivo (≥5) obrigatórios");
    const ids = await repo.listarIdentidades(agora);
    if (!ids.ok) return recusa("identidades_ilegiveis", "não consegui conferir os superadmins — NADA foi alterado", 503);
    const dono = ids.valor.find((i) => i.papeis.some((p) => p.id === corpo.atribuicao));
    const atr = dono?.papeis.find((p) => p.id === corpo.atribuicao);
    if (!dono || !atr) return recusa("nao_encontrada", "atribuição não encontrada", 404);
    if (dono.id === eu && atr.role === "superadmin") return recusa("nao_a_si", "ninguém tira o próprio superadmin", 409);
    const supers = ids.valor.filter((i) => i.status === "active" && i.papeis.some((p) => p.role === "superadmin"));
    if (atr.role === "superadmin" && supers.length <= 1) return recusa("ultimo_superadmin", "não se tira o ÚLTIMO superadmin ativo (ADM-009)", 409);
    const r = await comandoAuditado({
      acao: "roles.revoke", ator, alvo: atr.id, dados: { papel: atr.role, motivo: corpo.motivo.slice(0, 200) }, protetor: true,
      executar: async () => {
        const g = await repo.revogarPapel(atr.id, eu ?? dono.id, corpo.motivo as string);
        if (!g.ok || !g.valor) return { ok: false, codigo: "nao_gravou" };
        // Troca de papel revoga as sessões do alvo (design §4.4): o papel novo vale no próximo login.
        await repo.revogarTodasDaIdentidade(dono.id, "papel_revogado", eu);
        return { ok: true, valor: true };
      },
    });
    if (r.estado === "recusado") return recusa("auditoria_indisponivel", PORQUE_AUDITORIA_INDISPONIVEL, 503);
    if (r.estado !== "executado") return recusa("nao_gravou", "o papel NÃO foi revogado", 503);
    return NextResponse.json({ ok: true, ...avisoDeAuditoria(r.auditoria) }, { headers: SEM_CACHE });
  }

  return recusa("acao_desconhecida", "acao: convidar | revogar | conceder | revogar_papel");
}
