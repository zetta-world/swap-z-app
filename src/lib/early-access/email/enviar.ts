import { createHash } from "node:crypto";
import { logSecurity } from "@/lib/admin/track";
import { gerarToken, hashToken } from "../token";
import { registrarEnvio, pendentesDeEnvio, reemitir } from "../store";
import { configEmail } from "./config";
import { provedorPara } from "./provedor";
import { linkConfirmacao, mensagemConfirmacao, localeValido, type Locale } from "./templates";

/**
 * ENVIO DO EMAIL DE CONFIRMAÇÃO — só servidor. Nunca lança.
 *
 * ⚠️ O TOKEN CRU vive só no parâmetro desta função e no corpo do email. Não
 * entra em log, `logSecurity`, evento nem retorno.
 *
 * ⚠️ É chamado DEPOIS da resposta pública (via `waitUntil` na rota): a
 * latência do provider não pode virar oráculo de "email novo" × "verificado".
 *
 * Todo resultado vira estado no banco (`early_access_registrar_envio`): falha
 * TRANSITÓRIA fica `failed` e o cron reemite com token NOVO (D-3) até a 3ª
 * tentativa; falha PERMANENTE fica `dead` e nunca volta à fila (EA2-IA01).
 */
export async function enviarConfirmacao(p: { email: string; locale: string; token: string }): Promise<void> {
  const hash = hashToken(p.token);
  if (!hash) return;
  const cfg = configEmail();
  if (!cfg) {
    // O gate exige a configuração; isto só cobre a corrida de alguém removê-la.
    // config ausente é ambiente (o gate também fecha), não rejeição do provider:
    // transitória — volta à fila quando a configuração existir
    await registrarEnvio(hash, false, "config", null, true);
    return;
  }
  const locale: Locale = localeValido(p.locale) ? p.locale : "en";
  const m = mensagemConfirmacao(locale, linkConfirmacao(cfg.baseUrl, p.token));
  // Chave de idempotência derivada do hash (não é o token nem o hash em claro).
  const chave = createHash("sha256").update(`zswap-ea:idem\u0000${hash}`).digest("hex").slice(0, 48);
  let r;
  try {
    r = await provedorPara(cfg).enviar({ para: p.email, assunto: m.assunto, texto: m.texto, html: m.html }, chave);
  } catch {
    r = { ok: false as const, codigo: "rede" as const, transitorio: true };
  }
  const gravou = r.ok
    ? await registrarEnvio(hash, true, null, r.id, null)
    // EA2-IA01: a classificação do adaptador vai EXPLÍCITA para o banco
    : await registrarEnvio(hash, false, r.codigo, null, r.transitorio);
  if (!r.ok) logSecurity("early_access_envio_falhou", { codigo: r.codigo }, r.codigo === "config" ? "high" : "low");
  if (!gravou) logSecurity("early_access_envio_nao_registrado", {}, "med");
}

/**
 * Retry pelo cron: cada pendente ganha token NOVO (o antigo é revogado na
 * RPC) e um envio. Devolve quantos foram tentados, ou `null` se nem a lista
 * pôde ser lida.
 */
export async function reenviarPendentes(limite: number): Promise<number | null> {
  if (!configEmail()) return 0;
  const ids = await pendentesDeEnvio(limite);
  if (ids === null) return null;
  let n = 0;
  for (const id of ids) {
    const token = gerarToken();
    const hash = hashToken(token);
    if (!hash) continue;
    const alvo = await reemitir(id, hash);
    if (!alvo) continue;
    await enviarConfirmacao({ email: alvo.email, locale: alvo.locale, token });
    n++;
  }
  return n;
}
