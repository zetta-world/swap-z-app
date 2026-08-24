import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { guardarConexao } from "@/lib/cex/conexoes";
import { criarPlano, planosDaCarteira, ciclosDoPlano, avancarPlano } from "@/lib/dca/store";
import { proximaJanela, type Intervalo } from "@/lib/dca/relogio";
/**
 * ⚠️ AS MESMAS FUNÇÕES PURAS DA AUDITORIA DE `/orders` (PR #347).
 *
 * `lerCiclos` é quem recusa 0, negativo, fracionário e `1e9` — os valores que
 * a tela do DCA aceitava e transformava em "$Infinity por ciclo". Reusar aqui
 * não é economia: é garantir que a validação da API e a da tela são A MESMA.
 * Duas validações diferentes para o mesmo campo é como um valor impossível
 * entra pela porta dos fundos.
 */
import { lerCiclos, porCiclo } from "@/lib/orders/plano";
import { recordEvent } from "@/lib/admin/track";
import type { CexId } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OS PLANOS DE DCA DO USUÁRIO. (`docs/PLANO-DCA-AUTOMATICO.md` D6)
 *
 * ⚠️⚠️ CRIAR UM PLANO É ENTREGAR A CHAVE AO SERVIDOR, e a tela tem de dizer
 * isso. O console de CEX guarda as credenciais NO NAVEGADOR, atrás de senha e
 * com auto-lock — mas o cron roda sem o usuário, então o DCA precisa de uma
 * cópia cifrada no `cex_conexoes`. É um consentimento, não um formulário.
 */

const INTERVALOS: Intervalo[] = ["hourly", "daily", "weekly", "monthly"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const planoId = req.nextUrl.searchParams.get("plano");
  const planos = await planosDaCarteira(session.sub);
  if (!planoId) return NextResponse.json({ ok: true, planos });

  // ⚠️ O extrato só sai para um plano DESTA carteira. Sem esta conferência, um
  // id adivinhado leria os ciclos de outra pessoa.
  const meu = planos.find((p) => p.id === planoId);
  if (!meu) return NextResponse.json({ ok: false, error: "nao_encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, planos, ciclos: await ciclosDoPlano(planoId) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const exchangeId = String(b.exchangeId ?? "");
  const symbol     = String(b.symbol ?? "").toUpperCase();
  const intervalo  = String(b.intervalo ?? "") as Intervalo;
  const orcamento  = Number(b.orcamentoTotalUsd);
  const creds      = b.credentials as { apiKey?: string; apiSecret?: string; passphrase?: string } | undefined;

  if (!exchangeId || !/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/.test(symbol)) {
    return NextResponse.json({ ok: false, error: "par_invalido" }, { status: 400 });
  }
  if (!INTERVALOS.includes(intervalo)) {
    return NextResponse.json({ ok: false, error: "intervalo_invalido" }, { status: 400 });
  }
  if (!Number.isFinite(orcamento) || orcamento <= 0) {
    return NextResponse.json({ ok: false, error: "orcamento_invalido" }, { status: 400 });
  }
  // ⚠️ A MESMA função pura que a tela usa. Duas validações diferentes para o
  // mesmo campo é como um valor impossível entra pela porta dos fundos.
  const c = lerCiclos(String(b.ciclosTotal ?? ""));
  if (!c.ok) return NextResponse.json({ ok: false, error: `ciclos_${c.motivo}` }, { status: 400 });

  const cada = porCiclo(String(orcamento), c.ciclos, 8);
  if (!cada || Number(cada) <= 0) {
    return NextResponse.json({ ok: false, error: "por_ciclo_zero" }, { status: 400 });
  }
  if (!creds?.apiKey || !creds?.apiSecret) {
    return NextResponse.json({ ok: false, error: "credenciais_ausentes" }, { status: 400 });
  }

  /**
   * ⚠️ A CHAVE VAI PARA O COFRE, não para a linha do plano. É o ponto do
   * `cex_conexoes`: uma cópia do segredo, um lugar para revogar — e revogar
   * ali desliga DCA e autopilot de uma vez.
   */
  const conexao = await guardarConexao({
    walletAddress: session.sub,
    exchangeId:    exchangeId as CexId,
    credentials:   { apiKey: creds.apiKey, apiSecret: creds.apiSecret, passphrase: creds.passphrase },
  });
  if (!conexao.ok) {
    return NextResponse.json({ ok: false, error: "conexao_nao_gravada", detalhe: conexao.erro }, { status: 500 });
  }

  /**
   * ⚠️ O PRIMEIRO CICLO É AGORA, não na próxima janela.
   *
   * Quem aperta "criar plano" espera que a primeira compra aconteça. Agendar
   * para daqui a um dia faria a tela prometer uma coisa e o sistema fazer
   * outra — o defeito que a auditoria de hoje achou dez vezes.
   */
  const r = await criarPlano({
    conexaoId: conexao.id, walletAddress: session.sub, exchangeId, symbol,
    orcamentoTotalUsd: orcamento, porCicloUsd: Number(cada), ciclosTotal: c.ciclos,
    intervalo, primeiraJanelaIso: new Date().toISOString(),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: "plano_nao_gravado", detalhe: r.erro }, { status: 500 });

  await recordEvent("dca_plano_criado", { wallet: session.sub, meta: {
    exchangeId, symbol, intervalo, ciclos: c.ciclos, orcamento, porCiclo: cada,
  } });
  return NextResponse.json({
    ok: true, id: r.id, porCiclo: cada,
    // A tela mostra quando cai o próximo, para o dono conferir o relógio.
    proximaJanela: proximaJanela(new Date().toISOString(), intervalo),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const id   = String(b.id ?? "");
  const acao = String(b.acao ?? "");

  // ⚠️ Só mexe em plano DESTA carteira. O id sozinho não é autorização.
  const meus = await planosDaCarteira(session.sub);
  const meu = meus.find((p) => p.id === id);
  if (!meu) return NextResponse.json({ ok: false, error: "nao_encontrado" }, { status: 404 });

  if (acao === "pausar")  {
    if (!await avancarPlano(id, { status: "pausado" })) {
      return NextResponse.json({ ok: false, error: "nao_gravou" }, { status: 500 });
    }
  } else if (acao === "retomar") {
    if (meu.status !== "pausado") {
      return NextResponse.json({ ok: false, error: "nao_esta_pausado" }, { status: 400 });
    }
    /**
     * ⚠️ RETOMAR REAGENDA PARA AGORA. Voltar com o `next_run_at` antigo faria o
     * cron ver janelas vencidas durante a pausa e queimá-las como perdidas —
     * o dono perderia ciclos por ter pausado, que é punição que ninguém pediu.
     */
    if (!await avancarPlano(id, { status: "ativo", nextRunAt: new Date().toISOString() })) {
      return NextResponse.json({ ok: false, error: "nao_gravou" }, { status: 500 });
    }
  } else if (acao === "encerrar") {
    // ⚠️ `encerrado`, não `completo`: parar por vontade do dono não é o plano
    // ter terminado, e a soma dos "completos" não pode inchar com desistências.
    if (!await avancarPlano(id, { status: "encerrado", encerradoPor: "encerrado_pelo_dono" })) {
      return NextResponse.json({ ok: false, error: "nao_gravou" }, { status: 500 });
    }
  } else {
    return NextResponse.json({ ok: false, error: "acao_invalida" }, { status: 400 });
  }

  await recordEvent("dca_plano_acao", { wallet: session.sub, meta: { id, acao } });
  return NextResponse.json({ ok: true });
}
