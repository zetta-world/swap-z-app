import { TIERS, CONFIG_APROVADA, fingerprintConfig, reservaEfetiva, type TierVenda, type ConfigVenda } from "./config";
import { configDeEnsaio, montarEnsaio, abrirAteAllowlist, abrirPublica, comprar, acompanharAte, inscricaoSintetica, carteiraSintetica, adminExecuta, qualificar, type MontagemEnsaio } from "./cenario-local";
import { contagem, type Contagem } from "./relogio";
import { estadoDaUI, visaoProgresso, visaoAlocacao, type EstadoUI, type VisaoProgresso, type VisaoAlocacao, type Elegibilidade, type EntradaVisao } from "./visao";
import { estadoTxPublico, type EstadoTx, type EstadoTxPublico } from "./ciclo-tx";
import type { EstadoCarteira } from "./carteira";
import type { EstadoPublico } from "./maquina";
import { formatarSol } from "./preco";
import { beneficiosPorEstado, TAXA_SWAP_BPS } from "./beneficios";

/**
 * QUADROS DA PRÉVIA LOCAL — roda o SERVIÇO de verdade (cenário local, supply reduzido de SIMULAÇÃO) e fotografa,
 * em cada momento, o estado autoritativo projetado para a UI. A página só RENDERIZA estes quadros (JSON puro):
 * o navegador não decide nada. Uso exclusivo da rota de prévia atrás de `FOUNDERS_SALE_PREVIEW=1`.
 * Preços: PROVISÓRIOS (rotulados); a vitrine pública mostra "preço em definição".
 */
export interface QuadroPrevia {
  id: string;
  estadoUI: EstadoUI;
  publico: EstadoPublico | null;
  contagem: Contagem;
  progressoTotal: VisaoProgresso;
  progressoPorTier: Record<TierVenda, VisaoProgresso>;
  alocacao: VisaoAlocacao;
  carteira: EstadoCarteira;
  tx: EstadoTxPublico;
  txRef: string | null;
  snapshot: { id: string; raiz: string; versao: number } | null;
  configFingerprint: string;
  preco: { status: string; porTier: Record<TierVenda, { usd: number; sol: string | null }> };
  supplyPago: Record<TierVenda, number>;
  /** OD-NFT-04: reserva NÃO paga, divulgada (fora do supply pago). */
  reservaPorTier: Record<TierVenda, number>;
  taxaBps: Record<TierVenda, number>;
  pilotSomenteAllowlist: boolean;
  onboarding: null | {
    tier: TierVenda;
    premiumAte: number | null;
    beneficiosAgora: string[];
    beneficiosDesabilitados: string[];
    beneficiosAConfirmar: string[];
    beneficiosPlanejados: string[];
  };
  simulacao: true;
}

interface OpcoesQuadro {
  venda?: EntradaVisao["venda"]; elegibilidade?: Elegibilidade; tx?: EstadoTx; txRef?: string | null; carteira?: EstadoCarteira;
  restante?: number | null; redeErrada?: boolean; precoDisponivel?: boolean; configValida?: boolean;
  janela?: { inicioMs: number | null; fimMs: number | null }; usado?: number | null; concedido?: number | null;
  prova?: "ausente" | "verificando" | "valida" | "invalida"; onboarding?: QuadroPrevia["onboarding"];
}

const SEM_DADOS = visaoProgresso({ supply: null, mintados: null, reservados: null });

function quadroSemVenda(id: string, cfg: ConfigVenda): QuadroPrevia {
  const porTier = {} as QuadroPrevia["preco"]["porTier"];
  for (const t of TIERS) porTier[t] = { usd: cfg.precoUsd[t], sol: null };
  return {
    id, estadoUI: estadoDaUI({ venda: null, contagem: { tipo: "sem_hora" }, elegibilidade: "desconhecida", tx: "ocioso", txId: null }),
    publico: null, contagem: { tipo: "sem_hora" }, progressoTotal: SEM_DADOS,
    progressoPorTier: { PRO: SEM_DADOS, TRADER: SEM_DADOS, PILOT: SEM_DADOS },
    alocacao: visaoAlocacao({ alocacao: null, usado: null, elegibilidade: "desconhecida", prova: "ausente" }),
    carteira: "disconnected", tx: "IDLE", txRef: null, snapshot: null, configFingerprint: fingerprintConfig(cfg),
    preco: { status: cfg.statusPreco, porTier }, supplyPago: cfg.supplyPago, reservaPorTier: reservaEfetiva(cfg).porTier,
    taxaBps: { PRO: TAXA_SWAP_BPS.PRO, TRADER: TAXA_SWAP_BPS.TRADER, PILOT: TAXA_SWAP_BPS.PILOT },
    pilotSomenteAllowlist: cfg.pilotSomenteAllowlist, onboarding: null, simulacao: true,
  };
}

function quadro(m: MontagemEnsaio, id: string, o: OpcoesQuadro = {}): QuadroPrevia {
  const s = m.servico, cfg = m.cfg;
  const aut = s.autoridade.ler();
  const venda = o.venda !== undefined ? o.venda : aut.venda;
  const cont = contagem(o.janela ?? { inicioMs: cfg.horarios.allowlistAbre, fimMs: cfg.horarios.vendaFecha }, m.relogio.t);
  const tx: EstadoTx = o.tx ?? "ocioso";
  const eleg: Elegibilidade = o.elegibilidade ?? "desconhecida";
  const resumo = s.progresso();
  const pz = s.precos.precoDaFase("publica") ?? s.precos.precoDaFase("allowlist");
  const porTier = {} as QuadroPrevia["preco"]["porTier"];
  for (const t of TIERS) porTier[t] = { usd: cfg.precoUsd[t], sol: pz ? formatarSol(pz.tiers[t].lamports) : null };
  const snap = s.admin.snapshot();
  const prog = (r: { paid_supply: number; minted: number; reserved: number }) => visaoProgresso({ supply: r.paid_supply, mintados: r.minted, reservados: r.reserved });
  return {
    id,
    estadoUI: estadoDaUI({ venda, contagem: cont, elegibilidade: eleg, tx, txId: o.txRef ?? null, configValida: o.configValida, redeErrada: o.redeErrada, precoDisponivel: o.precoDisponivel, restante: o.restante }),
    publico: aut.publico, contagem: cont,
    progressoTotal: prog(resumo.total),
    progressoPorTier: { PRO: prog(resumo.porTier.PRO), TRADER: prog(resumo.porTier.TRADER), PILOT: prog(resumo.porTier.PILOT) },
    alocacao: visaoAlocacao({ alocacao: o.concedido ?? null, usado: o.usado ?? null, elegibilidade: eleg, prova: o.prova ?? "ausente" }),
    carteira: o.carteira ?? "disconnected", tx: estadoTxPublico(tx), txRef: o.txRef ?? null,
    snapshot: snap ? { id: snap.id, raiz: snap.raiz, versao: snap.versao } : null,
    configFingerprint: s.fingerprint, preco: { status: cfg.statusPreco, porTier }, supplyPago: cfg.supplyPago, reservaPorTier: reservaEfetiva(cfg).porTier,
    taxaBps: { PRO: TAXA_SWAP_BPS.PRO, TRADER: TAXA_SWAP_BPS.TRADER, PILOT: TAXA_SWAP_BPS.PILOT },
    pilotSomenteAllowlist: cfg.pilotSomenteAllowlist, onboarding: o.onboarding ?? null, simulacao: true,
  };
}

export async function quadrosDaPrevia(): Promise<QuadroPrevia[]> {
  const q: QuadroPrevia[] = [];
  const cfg = configDeEnsaio({ supplyPago: { PRO: 12, TRADER: 4, PILOT: 1 } });
  const insc = [...Array.from({ length: 8 }, (_, i) => inscricaoSintetica(i, "PRO")), ...Array.from({ length: 2 }, (_, i) => inscricaoSintetica(50 + i, "TRADER")), inscricaoSintetica(90, "PILOT")];
  const comprador = carteiraSintetica(0);

  // 1. configuração APROVADA sem datas (OD-NFT-08): "em breve", supply aprovado, sem progresso
  q.push(quadroSemVenda("coming-soon", CONFIG_APROVADA));

  // 2. inscrição aberta (serviço A)
  const a = montarEnsaio({ cfg });
  a.relogio.ir(cfg.horarios.inscricaoAbre!);
  await adminExecuta(a.servico, { tipo: "transicao", evento: "abrir_inscricao" });
  q.push(quadro(a, "application-open", { janela: { inicioMs: cfg.horarios.inscricaoFecha, fimMs: null } }));

  // 3. allowlist congelada antes da abertura (serviço B: para no congelamento)
  const b = montarEnsaio({ cfg });
  b.relogio.ir(cfg.horarios.inscricaoAbre!);
  await adminExecuta(b.servico, { tipo: "transicao", evento: "abrir_inscricao" });
  for (const i of insc) qualificar(b.servico, i);
  b.relogio.ir(cfg.horarios.inscricaoFecha!);
  await adminExecuta(b.servico, { tipo: "congelar_snapshot", snapshot: b.servico.montarSnapshot(1) });
  q.push(quadro(b, "allowlist-frozen"));

  // 4–16. sequência principal (serviço C)
  const c = montarEnsaio({ cfg, cadeia: { ticksAteConfirmar: 2, falhar: new Set(["falha-demo"]) } });
  await abrirAteAllowlist(c, insc);
  q.push(quadro(c, "allowlist-check", { elegibilidade: "verificando", carteira: "eligibility_checking", prova: "verificando" }));
  q.push(quadro(c, "eligible", { elegibilidade: "elegivel", carteira: "eligible", concedido: 1, usado: 0, prova: "valida" }));
  q.push(quadro(c, "not-eligible", { elegibilidade: "nao_elegivel", carteira: "not_eligible", prova: "invalida" }));
  q.push(quadro(c, "eligibility-pending", { elegibilidade: "pendente_juridico", carteira: "connected" }));
  q.push(quadro(c, "wrong-network", { elegibilidade: "elegivel", carteira: "wrong_network", redeErrada: true }));
  q.push(quadro(c, "price-unavailable", { elegibilidade: "elegivel", carteira: "eligible", precoDisponivel: false }));
  q.push(quadro(c, "tx-preparing", { elegibilidade: "elegivel", tx: "preparando", carteira: "eligible", concedido: 1, usado: 0, prova: "valida" }));
  q.push(quadro(c, "tx-wallet", { elegibilidade: "elegivel", tx: "assinando", carteira: "signing", concedido: 1, usado: 0, prova: "valida" }));
  const r = await comprar(c, comprador, "PRO", "previa-compra-1");
  if (!r.ok) throw new Error(`previa_compra:${r.erro}`);
  q.push(quadro(c, "tx-pending", { elegibilidade: "elegivel", tx: "confirmando", txRef: r.assinatura, carteira: "pending", concedido: 1, usado: 1, prova: "valida" }));
  const conf = await acompanharAte(c, r.assinatura);
  const ob = c.servico.onboarding(comprador);
  q.push(quadro(c, "tx-confirmed", {
    elegibilidade: "elegivel", tx: conf.status === "CONFIRMED" ? "confirmada" : "confirmando", txRef: conf.status === "CONFIRMED" ? conf.txId : null,
    carteira: conf.status === "CONFIRMED" ? "confirmed" : "pending", concedido: 1, usado: 1, prova: "valida",
    onboarding: {
      tier: "PRO", premiumAte: ob.janelaPremium.estado === "DEFINIDA" ? ob.janelaPremium.fim : null,
      beneficiosAgora: beneficiosPorEstado("PRO", "AVAILABLE_AT_LAUNCH").map((x) => x.id),
      beneficiosDesabilitados: beneficiosPorEstado("PRO", "IMPLEMENTED_DISABLED").map((x) => x.id),
      beneficiosAConfirmar: beneficiosPorEstado("PRO", "A_CONFIRMAR").map((x) => x.id),
      beneficiosPlanejados: beneficiosPorEstado("PRO", "COMING_SOON_ROADMAP").map((x) => x.id),
    },
  }));
  q.push(quadro(c, "wallet-limit", { elegibilidade: "elegivel", carteira: "allocation_exhausted", restante: 0, concedido: 1, usado: 1, prova: "valida" }));
  const rf = await comprar(c, carteiraSintetica(1), "PRO", "falha-demo");
  if (rf.ok) await acompanharAte(c, rf.assinatura);
  q.push(quadro(c, "tx-failed", { elegibilidade: "elegivel", tx: "falhou", carteira: "failed", concedido: 1, usado: 0, prova: "valida" }));
  const pilot = await comprar(c, carteiraSintetica(90), "PILOT", "previa-pilot"); // Pilot só vende na allowlist
  if (pilot.ok) await acompanharAte(c, pilot.assinatura);
  await abrirPublica(c);
  q.push(quadro(c, "public-sale", { elegibilidade: "elegivel", carteira: "connected", janela: { inicioMs: cfg.horarios.publicaAbre, fimMs: cfg.horarios.vendaFecha } }));
  await adminExecuta(c.servico, { tipo: "pausar" });
  q.push(quadro(c, "paused", { carteira: "connected" }));
  await adminExecuta(c.servico, { tipo: "retomar" });
  // 17. esgotado: Pilot esgotou na allowlist (supply de simulação 1); compradores sintéticos esgotam Pro e Trader
  let n = 100;
  for (const t of ["PRO", "TRADER"] as TierVenda[]) {
    while (c.servico.progresso().porTier[t].available > 0) {
      const k = await comprar(c, carteiraSintetica(`prev-${n}`), t, `prev-${n++}`);
      if (!k.ok) break;
      await acompanharAte(c, k.assinatura);
    }
  }
  q.push(quadro(c, "sold-out", { carteira: "connected" }));
  q.push(quadro(c, "config-invalid", { configValida: false }));
  q.push(quadro(c, "unknown-state", { venda: { estado: "estado_inexistente" as never } }));

  // 18. encerrada sem esgotar (serviço D)
  const d = montarEnsaio({ cfg });
  await abrirAteAllowlist(d, insc.slice(0, 2));
  d.relogio.ir(cfg.horarios.vendaFecha!);
  await d.servico.autoridade.tick();
  q.push(quadro(d, "ended"));
  return q;
}
