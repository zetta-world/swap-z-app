import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { guardarConexao } from "@/lib/cex/conexoes";
import {
  criarPlano, planosDaCarteira, ciclosDoPlano, avancarPlano, type ModoPlano,
} from "@/lib/dca/store";
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
import { getFlywheelGates } from "@/lib/admin/gates";
import { rateLimitDurable } from "@/lib/rate-limit";
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

/**
 * Há quantos minutos o cron do DCA passou pela última vez.
 *
 * ⚠️⚠️ ISTO SUBSTITUI UM AVISO FIXO NA TELA, e a troca tem motivo.
 *
 * O painel trazia uma faixa vermelha dizendo "o cron ainda não está agendado".
 * Era verdade quando escrevi — e deixou de ser no minuto em que o dono criou o
 * job, sem que nada na tela soubesse. Aviso codificado à mão é uma afirmação
 * que envelhece sozinha: ou vira mentira, ou vira ruído que se aprende a
 * ignorar.
 *
 * Agora a tela LÊ o heartbeat que o próprio cron grava. Se ele parar, ela
 * volta a avisar sozinha — e se nunca rodou, ela diz isso, que é diferente de
 * "rodou e faz tempo".
 *
 * ⚠️ `null` = NUNCA rodou. Não confundir com um número grande.
 *
 * ⚠️⚠️ O HEARTBEAT SOZINHO NÃO DIZ QUE ALGO EXECUTA — 08/09, DINHEIRO REAL.
 *
 * O cron do DCA grava o heartbeat ANTES de ler o gate, e isso está certo: com
 * a trava fechada, o watchdog não pode acusar "cron parado" e esconder a causa
 * real atrás de um alarme errado. Só que o cliente lê o MESMO carimbo — e com
 * `pause_dca` ligado ele via "Agendador vivo — última passada há 3 min" sobre
 * uma fila onde NADA é executado. O cron passa; ele só passa e volta.
 *
 * "Passou" e "executa" são duas coisas, e a tela precisa das duas. Por isso o
 * gate vem junto — é o mesmo que `/api/bancada/agentes` já faz com
 * `pausadoPelaCasa`.
 */
async function ultimaPassadaDoCron(): Promise<{ haMinutos: number | null; pausado: boolean }> {
  // ⚠️ Best-effort e padrão `false`: falha ao ler o gate não pode derrubar a
  // tela de planos. E `false` é o padrão HONESTO — com gate ausente o cron
  // executa, então "não pausado" é a verdade, não um chute otimista.
  let pausado = false;
  try { pausado = (await getFlywheelGates()).pause_dca === true; } catch { /* ver acima */ }

  const db = getSupabaseAdmin();
  if (!db) return { haMinutos: null, pausado };
  const { data, error } = await db.from("admin_kv")
    .select("value").eq("key", "cron:dca:last").maybeSingle();
  const iso = (data as { value?: string } | null)?.value;
  if (error || !iso) return { haMinutos: null, pausado };
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return { haMinutos: 0, pausado };
  return { haMinutos: Math.floor(ms / 60_000), pausado };
}


/**
 * ⚠️ A CHAVE É A CARTEIRA, NÃO O IP — e a escolha é o ponto (30/08).
 *
 * O resto do repositório limita por `getClientId(headers)`, que é o certo para
 * rota ANÔNIMA: sem sessão, o IP é o único identificador que existe. Aqui há
 * sessão, e o IP passa a ser a chave errada nos dois sentidos.
 *
 * Ele deixa passar: uma sessão válida atrás de uma rede doméstica com IP
 * rotativo, ou de qualquer proxy, ganha um balde novo a cada troca. E ele
 * barra quem não devia: duas pessoas na mesma NAT — um escritório, um café,
 * uma operadora móvel — dividem o limite e uma tranca a outra.
 *
 * A carteira é o sujeito real do limite: é dela o orçamento, é dela o teto
 * diário do DCA, e é ela que o abuso custaria caro.
 *
 * ⚠️ POR QUE ESTA ROTA FALTAVA. Ela tinha sessão e por isso PARECIA protegida —
 * 37 das 43 rotas já limitavam. Mas sessão responde "quem é", não "quantas
 * vezes", e criar plano em modo real grava conexão CIFRADA no banco: é a
 * escrita mais cara do produto, e era a que ninguém contava.
 */
async function limitar(wallet: string, acao: "criar" | "mexer" | "ler") {
  const opts = acao === "criar"
    ? { windowMs: 3_600_000, max: 20 }   // plano é decisão rara: 20/hora sobra
    : acao === "mexer"
    ? { windowMs: 60_000, max: 30 }      // pausar/retomar/encerrar
    : { windowMs: 60_000, max: 60 };     // leitura da própria lista
  const rl = await rateLimitDurable(`dca_planos:${acao}:${wallet}`, opts);
  if (rl.ok) return null;
  return NextResponse.json(
    { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
    { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const barrado = await limitar(session.sub, "ler");
  if (barrado) return barrado;

  const planoId = req.nextUrl.searchParams.get("plano");
  const [planos, cron] = await Promise.all([
    planosDaCarteira(session.sub),
    ultimaPassadaDoCron(),
  ]);
  if (!planoId) return NextResponse.json({ ok: true, planos, cron });

  // ⚠️ O extrato só sai para um plano DESTA carteira. Sem esta conferência, um
  // id adivinhado leria os ciclos de outra pessoa.
  const meu = planos.find((p) => p.id === planoId);
  if (!meu) return NextResponse.json({ ok: false, error: "nao_encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, planos, cron, ciclos: await ciclosDoPlano(planoId) });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const barrado = await limitar(session.sub, "criar");
  if (barrado) return barrado;

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
  /**
   * ⚠️⚠️ O MODO É EXPLÍCITO, E O PADRÃO É SIMULADO.
   *
   * Qualquer coisa que não seja exatamente `"real"` cai em simulado. Um campo
   * ausente, um typo, um cliente antigo — nada disso pode acabar comprando com
   * dinheiro de verdade. O caminho que gasta exige dizer o nome dele.
   */
  const modo: ModoPlano = b.modo === "real" ? "real" : "simulado";

  /**
   * ⚠️ PLANO SIMULADO NÃO PEDE CREDENCIAL — e é o ponto.
   *
   * Dá para exercitar relógio, reserva, tetos e extrato sem entregar a chave
   * da corretora a ninguém. Só o caminho que gasta dinheiro exige a chave, e o
   * banco confirma (check `dca_planos_real_exige_conexao`).
   */
  let conexaoId: string | null = null;
  if (modo === "real") {
    if (!creds?.apiKey || !creds?.apiSecret) {
      return NextResponse.json({ ok: false, error: "credenciais_ausentes" }, { status: 400 });
    }
    const conexao = await guardarConexao({
      walletAddress: session.sub,
      exchangeId:    exchangeId as CexId,
      credentials:   { apiKey: creds.apiKey, apiSecret: creds.apiSecret, passphrase: creds.passphrase },
    });
    if (!conexao.ok) {
      return NextResponse.json({ ok: false, error: "conexao_nao_gravada", detalhe: conexao.erro }, { status: 500 });
    }
    conexaoId = conexao.id;
  }

  /**
   * ⚠️ O PRIMEIRO CICLO É AGORA, não na próxima janela.
   *
   * Quem aperta "criar plano" espera que a primeira compra aconteça. Agendar
   * para daqui a um dia faria a tela prometer uma coisa e o sistema fazer
   * outra — o defeito que a auditoria de hoje achou dez vezes.
   */
  const r = await criarPlano({
    conexaoId, modo, walletAddress: session.sub, exchangeId, symbol,
    orcamentoTotalUsd: orcamento, porCicloUsd: Number(cada), ciclosTotal: c.ciclos,
    intervalo, primeiraJanelaIso: new Date().toISOString(),
  });
  if (!r.ok) return NextResponse.json({ ok: false, error: "plano_nao_gravado", detalhe: r.erro }, { status: 500 });

  await recordEvent("dca_plano_criado", { wallet: session.sub, meta: {
    exchangeId, symbol, intervalo, ciclos: c.ciclos, orcamento, porCiclo: cada, modo,
  } });
  return NextResponse.json({
    ok: true, id: r.id, porCiclo: cada, modo,
    // A tela mostra quando cai o próximo, para o dono conferir o relógio.
    proximaJanela: proximaJanela(new Date().toISOString(), intervalo),
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });

  const barrado = await limitar(session.sub, "mexer");
  if (barrado) return barrado;

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
