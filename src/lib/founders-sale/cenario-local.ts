import { createHash } from "node:crypto";
import { CONFIG_APROVADA, configurado, type ConfigVenda, type ParametrosConversao, type TierVenda } from "./config";
import { ServicoDaVenda } from "./servico";
import { ProvedorReferenciaFixo } from "./preco";
import { CadeiaFalsa, REDE_DA_VENDA, type OpcoesCadeia } from "./carteira";
import { provaPara, type Inscricao, type EntradaCurada } from "./allowlist-hibrida";
import type { Acompanhamento, ResultadoCompra } from "./servico";
import type { FaseVenda } from "./estoque";
import type { OpcoesLivro } from "./alocacao";

/**
 * CENÁRIO LOCAL DETERMINÍSTICO — só para teste, ensaio e prévia local. NADA aqui é configuração de produção.
 *
 *   · horários relativos a um t0 fixo (nenhuma data real — OD-NFT-08);
 *   · política de país SINTÉTICA: só "ZZ" (código ISO de uso privado, não é país) — marca `ENSAIO_LOCAL_SINTETICO`.
 *     A política real é do jurídico (OD-NFT-16) e continua PENDING_LEGAL em `CONFIG_APROVADA`;
 *   · carteiras sintéticas com formato base58 derivadas de sha256 — não são chaves, ninguém tem a privada;
 *   · referência SOL/USD fixa local (sem oráculo), chain falsa, assinador falso.
 */
export const T0 = Date.UTC(2030, 0, 15, 12, 0, 0);
const H = 3_600_000;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function carteiraSintetica(n: number | string): string {
  const d = createHash("sha256").update(`carteira-sintetica\0${n}`).digest();
  let out = "";
  for (let i = 0; i < 43; i++) out += B58[(d[i % 32] + i * 7) % 58];
  return out;
}

export function configDeEnsaio(over: Partial<ConfigVenda> = {}): ConfigVenda {
  const allowlistAbre = T0 + 48 * H;
  return {
    ...CONFIG_APROVADA,
    horarios: {
      inscricaoAbre: T0, inscricaoFecha: T0 + 24 * H, allowlistAbre,
      publicaAbre: allowlistAbre + CONFIG_APROVADA.duracaoAllowlistMs,
      vendaFecha: allowlistAbre + CONFIG_APROVADA.duracaoAllowlistMs + 7 * 24 * H,
    },
    juridico: { ...CONFIG_APROVADA.juridico, paisesPermitidos: configurado(["ZZ"], "ENSAIO_LOCAL_SINTETICO") },
    ...over,
  };
}

/**
 * Parâmetros de conversão SÓ DE TESTE — exercitam o simulador; NÃO são recomendação nem decisão (OD-NFT-22: números
 * reais dependem de análise de risco documentada + revisão contábil/jurídica). Contrapartes fictícias.
 */
export const PARAMETROS_CONVERSAO_TESTE: ParametrosConversao = {
  solRetidoBps: 0, stableBps: 5_000, fiatBps: 5_000,
  trancheMaxBrlCentavos: 5_000_000, tranchesPorDiaMax: 4, limitePorContraparteBps: 5_000,
  contrapartes: ["contraparte-ficticia-a", "contraparte-ficticia-b"],
};

export class RelogioManual {
  constructor(public t: number = T0) {}
  agora = () => this.t;
  ir(t: number) { this.t = t; }
  avancar(ms: number) { this.t += ms; }
}

export function inscricaoSintetica(n: number, tier: TierVenda | "indeciso" | null, extra: Partial<Inscricao> = {}): Inscricao {
  return {
    id: `insc-${n}`, emailHash: createHash("sha256").update(`email-sintetico-${n}`).digest("hex"),
    emailVerificado: false, carteira: carteiraSintetica(n), carteiraAssinada: false, pais: "ZZ",
    preferenciaTier: tier, intencao: "pretende_comprar", precoIntencaoUsd: tier && tier !== "indeciso" ? CONFIG_APROVADA.precoUsd[tier] : null,
    fonte: "ensaio_local", referral: null, em: T0 + n, ...extra,
  };
}

export interface MontagemEnsaio {
  servico: ServicoDaVenda; relogio: RelogioManual; provedor: ProvedorReferenciaFixo; cadeia: CadeiaFalsa; cfg: ConfigVenda;
}

export function montarEnsaio(o: { cfg?: ConfigVenda; solUsd?: number; cadeia?: OpcoesCadeia; validadeReservaMs?: number; opcoesLivro?: OpcoesLivro; exigeSegundoOperador?: boolean } = {}): MontagemEnsaio {
  const relogio = new RelogioManual(T0);
  const cfg = o.cfg ?? configDeEnsaio();
  const provedor = new ProvedorReferenciaFixo(o.solUsd ?? 150, relogio.agora);
  const cadeia = new CadeiaFalsa(o.cadeia);
  const servico = new ServicoDaVenda({ cfg, relogio: relogio.agora, provedor, cadeia, validadeReservaMs: o.validadeReservaMs, opcoesLivro: o.opcoesLivro,
    admin: { exigeSegundoOperador: o.exigeSegundoOperador ?? true } });
  return { servico, relogio, provedor, cadeia, cfg };
}

/** Executa uma ação de admin de dois passos com os operadores do ensaio (op-alfa pede, op-beta confirma). */
export async function adminExecuta(s: ServicoDaVenda, acao: Parameters<ServicoDaVenda["admin"]["solicitar"]>[0], motivo = "operação do ensaio local") {
  const p = s.admin.solicitar(acao, "op-alfa", motivo);
  if (!p.ok) return p;
  return s.admin.confirmar(p.id, "op-beta", p.frase);
}

/** Inscreve, verifica e-mail e assina a carteira (fluxo completo do Early Access simulado). */
export function qualificar(s: ServicoDaVenda, i: Inscricao): boolean {
  s.inscrever(i);
  s.verificarEmail(i.id);
  const msg = s.desafioDeCarteira(i.id);
  if (!msg) return false;
  return s.confirmarAssinatura(i.id, msg, s.assinarComCarteiraFalsa(msg));
}

export const REDE = REDE_DA_VENDA;

/**
 * Leva o ensaio até a venda de allowlist ABERTA: inscrição → qualificação → snapshot congelado (2 operadores) →
 * preço da allowlist congelado 1 min antes → abertura no horário. Devolve o snapshot vigente.
 */
export async function abrirAteAllowlist(m: MontagemEnsaio, inscricoes: Inscricao[], curadas: EntradaCurada[] = []) {
  const { servico: s, relogio: r, cfg } = m;
  const h = cfg.horarios;
  r.ir(h.inscricaoAbre!);
  const a = await adminExecuta(s, { tipo: "transicao", evento: "abrir_inscricao" });
  if (!a.ok) throw new Error(`abrir_inscricao:${a.erro}`);
  for (const i of inscricoes) qualificar(s, i);
  for (const c of curadas) s.curar(c);
  r.ir(h.inscricaoFecha!);
  const snap = s.montarSnapshot(1);
  const c = await adminExecuta(s, { tipo: "congelar_snapshot", snapshot: snap });
  if (!c.ok) throw new Error(`congelar:${c.erro}`);
  r.ir(h.allowlistAbre! - 60_000);
  const pz = await s.precos.congelarFase("allowlist");
  if (!pz.ok) throw new Error(`preco:${pz.erro}`);
  r.ir(h.allowlistAbre!);
  const o = await adminExecuta(s, { tipo: "transicao", evento: "abrir_allowlist" });
  if (!o.ok) throw new Error(`abrir_allowlist:${o.erro}`);
  return s.admin.snapshot()!;
}

/** Congela o preço da pública 1 min antes e deixa o relógio do servidor abrir a fase. */
export async function abrirPublica(m: MontagemEnsaio) {
  const h = m.cfg.horarios;
  m.relogio.ir(h.publicaAbre! - 60_000);
  const pz = await m.servico.precos.congelarFase("publica");
  if (!pz.ok) throw new Error(`preco_publica:${pz.erro}`);
  m.relogio.ir(h.publicaAbre!);
  return m.servico.autoridade.tick();
}

export async function comprar(m: MontagemEnsaio, carteira: string, tier: TierVenda, chave: string, o: { unidades?: number; rede?: string; pais?: string; semProva?: boolean } = {}): Promise<ResultadoCompra> {
  const s = m.servico;
  const fase: FaseVenda = s.autoridade.ler().venda.estado === "publica_aberta" ? "publica" : "allowlist";
  const preco = s.precos.precoDaFase(fase);
  const snap = s.admin.snapshot();
  return s.comprar({
    carteira, tier, unidades: o.unidades ?? 1, chave, rede: o.rede ?? REDE_DA_VENDA, pais: o.pais ?? "ZZ",
    prova: o.semProva || !snap ? undefined : provaPara(snap, carteira, tier) ?? undefined,
    lamports: preco?.tiers[tier].lamports ?? "0", precoFingerprint: preco?.fingerprint ?? "",
  });
}

export async function acompanharAte(m: MontagemEnsaio, assinatura: string, maxTicks = 10): Promise<Acompanhamento> {
  let ult: Acompanhamento = { status: "PENDING" };
  for (let i = 0; i < maxTicks; i++) {
    ult = await m.servico.acompanhar(assinatura);
    if (ult.status !== "PENDING") return ult;
  }
  return ult;
}
