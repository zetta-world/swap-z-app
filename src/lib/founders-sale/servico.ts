import { createHash } from "node:crypto";
import type { ConfigVenda, TierVenda } from "./config";
import { validarConfig, fingerprintConfig, TIERS } from "./config";
import { VendaAutoritativa, ArmazemEmMemoria, estadoInicial, type ArmazemEstado } from "./autoridade";
import { AdminDaVenda, type ConfigAdmin } from "./admin";
import { EstoqueDaVenda, type FaseVenda } from "./estoque";
import { PrecosDaVenda, type ProvedorReferencia } from "./preco";
import { CadeiaFalsa, lerRecibo, REDE_DA_VENDA, AssinadorFalso, mensagemDePosse } from "./carteira";
import { avaliar, alocar, criarSnapshotAlocacao, verificarProva, type Inscricao, type EntradaCurada, type ProvaAllowlist, type SnapshotAlocacao } from "./allowlist-hibrida";
import { CadeiaDeEvidencia } from "./evidencia";
import { janelaPremium, beneficiosPublicaveis } from "./beneficios";
import { validarEvento } from "./telemetria";
import type { OpcoesLivro } from "./alocacao";

/**
 * SERVIÇO LOCAL DA VENDA — o "backend" do ensaio (sem rede, sem banco hospedado, sem chain real).
 * Compõe as peças sem duplicá-las e aplica, nesta ordem, as checagens de uma compra:
 *   configuração íntegra → estado aberto (autoridade) → rede certa → prova Merkle do snapshot CONGELADO
 *   (allowlist) ou política de país (pública) → preço congelado idêntico → reserva (teto, supply) →
 *   envio à chain falsa → SUCESSO SÓ COM RECIBO `confirmed`.
 * Tudo falha FECHADO; cada passo relevante vira evidência encadeada; telemetria só passa pelo esquema.
 */
export type ErroCompra =
  | "config_invalida" | "venda_fechada" | "rede_errada" | "prova_ausente" | "prova_invalida" | "carteira_diferente_da_prova"
  | "nao_elegivel" | "elegibilidade_pendente_juridico" | "preco_indisponivel" | "preco_adulterado" | "tier_invalido" | "tier_fora_da_fase"
  | "teto_da_carteira" | "esgotado" | "parametro_invalido" | "armazenamento_indisponivel" | "cadeia_indisponivel";

export interface PedidoCompra {
  carteira: string; tier: string; unidades: number; chave: string; rede: string;
  prova?: ProvaAllowlist; pais?: string; lamports: string; precoFingerprint: string;
}

export type ResultadoCompra = { ok: true; reservaId: string; assinatura: string; fase: FaseVenda; replay: boolean } | { ok: false; erro: ErroCompra };
export type Acompanhamento = { status: "CONFIRMED"; txId: string } | { status: "PENDING" } | { status: "FAILED"; motivo: string } | { status: "RECONCILIATION_REQUIRED"; motivo: string };

export interface OpcoesServico {
  cfg: ConfigVenda;
  relogio: () => number;
  provedor: ProvedorReferencia;
  cadeia?: CadeiaFalsa;
  validadeReservaMs?: number;
  admin?: Partial<ConfigAdmin>;
  armazem?: ArmazemEstado;
  opcoesLivro?: OpcoesLivro;
}

export class ServicoDaVenda {
  readonly cfg: ConfigVenda;
  readonly fingerprint: string;
  readonly evidencia = new CadeiaDeEvidencia();
  readonly autoridade: VendaAutoritativa;
  readonly admin: AdminDaVenda;
  readonly estoque: EstoqueDaVenda;
  readonly precos: PrecosDaVenda;
  readonly cadeia: CadeiaFalsa;
  readonly telemetria: unknown[] = [];
  telemetriaRecusada = 0;
  private inscricoes: Inscricao[] = [];
  private curadas: EntradaCurada[] = [];
  private nonces = new Map<string, string>();
  private readonly assinador = new AssinadorFalso("segredo-local-de-teste-apenas");
  private encerramentoOficial: number | null = null;
  private reservaPorAssinatura = new Map<string, { tier: TierVenda; reservaId: string; carteira: string; inicio: number }>();
  private donos = new Map<string, TierVenda[]>();

  constructor(o: OpcoesServico) {
    this.cfg = o.cfg;
    const erros = validarConfig(o.cfg);
    if (erros.length) throw new Error(`config_invalida:${erros.join(",")}`);
    this.fingerprint = fingerprintConfig(o.cfg);
    this.evidencia.emitir("sale_config_fingerprint", { fingerprint: this.fingerprint, rede: o.cfg.rede, statusPreco: o.cfg.statusPreco });
    this.autoridade = new VendaAutoritativa(o.cfg, o.relogio, o.armazem ?? new ArmazemEmMemoria(estadoInicial(o.relogio())), (de, para, evento, origem) => {
      if (para.venda.estado === "encerrada" || para.venda.estado === "esgotada") this.encerramentoOficial ??= o.relogio();
      this.evidencia.emitir("admin_audit", { evento: "transicao_autoritativa", de: de.venda.estado, para: para.venda.estado, versao: para.versao, por: evento, origem });
    });
    this.admin = new AdminDaVenda(this.autoridade, {
      validadeMs: 10 * 60_000, exigeSegundoOperador: true, operadoresAutorizados: ["op-alfa", "op-beta"], motivoMinimo: 10, ...o.admin,
    }, this.evidencia, o.relogio);
    this.estoque = new EstoqueDaVenda(o.cfg, o.relogio, o.validadeReservaMs ?? 10 * 60_000, o.opcoesLivro);
    this.precos = new PrecosDaVenda(o.cfg, o.provedor, o.relogio);
    this.cadeia = o.cadeia ?? new CadeiaFalsa();
    this.relogio = o.relogio;
  }
  private readonly relogio: () => number;

  // ── telemetria: só o que passa no esquema entra ──
  registrar(evento: Record<string, unknown>): boolean {
    const v = validarEvento(evento);
    if (!v.ok) { this.telemetriaRecusada++; return false; }
    this.telemetria.push(v.evento);
    return true;
  }

  // ── inscrição / verificação (Early Access simulado) ──
  inscrever(i: Inscricao) { this.inscricoes.push({ ...i }); }
  curar(c: EntradaCurada) { this.curadas.push({ ...c }); }
  todasInscricoes(): readonly Inscricao[] { return this.inscricoes; }
  verificarEmail(id: string) { const i = this.inscricoes.find((x) => x.id === id); if (i) i.emailVerificado = true; }

  desafioDeCarteira(id: string): string | null {
    const i = this.inscricoes.find((x) => x.id === id);
    if (!i?.carteira) return null;
    const nonce = createHash("sha256").update(`nonce\0${id}\0${this.relogio()}`).digest("hex").slice(0, 16);
    this.nonces.set(id, nonce);
    return mensagemDePosse(i.carteira, nonce, this.relogio());
  }
  /** Só o assinador falso local "assina" (ensaio). Nonce de uso único: replay da assinatura falha. */
  assinarComCarteiraFalsa(mensagem: string): string { return this.assinador.assinar(mensagem); }
  confirmarAssinatura(id: string, mensagem: string, assinatura: string): boolean {
    const i = this.inscricoes.find((x) => x.id === id);
    const nonce = this.nonces.get(id);
    if (!i?.carteira || !nonce || !mensagem.includes(`nonce:${nonce}`) || !mensagem.includes(`wallet:${i.carteira}`)) return false;
    if (!this.assinador.verificar(mensagem, assinatura)) return false;
    this.nonces.delete(id);
    i.carteiraAssinada = true;
    return true;
  }

  montarSnapshot(versao: number): SnapshotAlocacao {
    const { entradas } = alocar(this.inscricoes, this.curadas, this.cfg);
    const s = criarSnapshotAlocacao(versao, entradas);
    this.evidencia.emitir("allowlist_snapshot", { versao, id: s.id, entradas: entradas.length });
    this.evidencia.emitir("merkle_root", { snapshot_id: s.id, raiz: s.raiz });
    this.evidencia.emitir("proof_version", { versao_folha: "founders-allowlist-leaf-v2", hash: "sha256" });
    return s;
  }

  private faseAtual(): FaseVenda | null | "indisponivel" {
    let e: string;
    try { e = this.autoridade.ler().venda.estado; } catch { return "indisponivel"; }
    return e === "allowlist_aberta" ? "allowlist" : e === "publica_aberta" ? "publica" : null;
  }

  async comprar(p: PedidoCompra): Promise<ResultadoCompra> {
    if (validarConfig(this.cfg).length || fingerprintConfig(this.cfg) !== this.fingerprint) return { ok: false, erro: "config_invalida" };
    const fase = this.faseAtual();
    if (fase === "indisponivel") return { ok: false, erro: "armazenamento_indisponivel" };
    if (!fase) return { ok: false, erro: "venda_fechada" };
    if (p.rede !== REDE_DA_VENDA) return { ok: false, erro: "rede_errada" };
    if (!(TIERS as readonly string[]).includes(p.tier)) return { ok: false, erro: "tier_invalido" };
    const tier = p.tier as TierVenda;
    let concedido: number | undefined;
    if (fase === "allowlist") {
      const vigente = this.admin.snapshot();
      if (!p.prova) return { ok: false, erro: "prova_ausente" };
      if (!vigente || !verificarProva(vigente, p.prova)) return { ok: false, erro: "prova_invalida" };
      if (p.prova.entrada.carteira !== p.carteira || p.prova.entrada.tier !== tier) return { ok: false, erro: "carteira_diferente_da_prova" };
      concedido = p.prova.entrada.quantidade;
    } else {
      const juridico = this.cfg.juridico.paisesPermitidos;
      if (juridico.estado !== "CONFIGURADO") return { ok: false, erro: "elegibilidade_pendente_juridico" };
      if (!p.pais || !juridico.valor.includes(p.pais)) return { ok: false, erro: "nao_elegivel" };
    }
    const preco = this.precos.conferir(fase, tier, p.lamports, p.precoFingerprint);
    if (!preco.ok) return { ok: false, erro: preco.erro === "fase_nao_congelada" ? "preco_indisponivel" : "preco_adulterado" };
    const r = await this.estoque.reservar({ tier, carteira: p.carteira, unidades: p.unidades, chave: p.chave, fase, vendaAberta: true, elegivel: true, concedido });
    if (!r.ok) return { ok: false, erro: r.erro as ErroCompra };
    const envio = this.cadeia.enviar({ chave: p.chave, carteira: p.carteira, tier, lamports: preco.lamports, rede: p.rede, precoFingerprint: p.precoFingerprint });
    if (!envio.ok) {
      await this.estoque.cancelar(tier, r.reserva.id);
      return { ok: false, erro: envio.erro === "rede_errada" ? "rede_errada" : "cadeia_indisponivel" };
    }
    if (!this.reservaPorAssinatura.has(envio.assinatura)) this.reservaPorAssinatura.set(envio.assinatura, { tier, reservaId: r.reserva.id, carteira: p.carteira, inicio: this.relogio() });
    this.evidencia.emitir("mock_tx_lifecycle", { etapa: "submitted", assinatura: envio.assinatura, tier, replay: r.replay });
    return { ok: true, reservaId: r.reserva.id, assinatura: envio.assinatura, fase, replay: r.replay };
  }

  async acompanhar(assinatura: string): Promise<Acompanhamento> {
    const reg = this.reservaPorAssinatura.get(assinatura);
    if (!reg) return { status: "FAILED", motivo: "assinatura_desconhecida" };
    let cru: unknown;
    try { cru = this.cadeia.reciboCru(assinatura); }
    catch { return { status: "PENDING" }; } // chain fora: continua pendente, nunca sucesso
    const recibo = lerRecibo(cru, assinatura);
    if (recibo.status === "pending" || recibo.status === "unknown") return { status: "PENDING" };
    if (recibo.status === "failed") {
      await this.estoque.cancelar(reg.tier, reg.reservaId);
      this.evidencia.emitir("mock_tx_lifecycle", { etapa: "failed", assinatura });
      return { status: "FAILED", motivo: "falhou_na_cadeia" };
    }
    const c = await this.estoque.confirmar(reg.tier, reg.reservaId);
    if (!c.ok && c.erro !== "ja_confirmada") {
      this.evidencia.emitir("mock_tx_lifecycle", { etapa: "reconciliation_required", assinatura, motivo: c.erro });
      return { status: "RECONCILIATION_REQUIRED", motivo: c.erro };
    }
    if (c.ok) {
      this.donos.set(reg.carteira, [...(this.donos.get(reg.carteira) ?? []), reg.tier]);
      this.evidencia.emitir("mock_tx_lifecycle", { etapa: "confirmed", assinatura, tier: reg.tier });
    }
    const resumo = this.estoque.resumo();
    let estadoAgora: string | null = null;
    try { estadoAgora = this.autoridade.ler().venda.estado; } catch { estadoAgora = null; }
    if (resumo.esgotado && estadoAgora !== null && estadoAgora !== "esgotada") {
      const r = await this.autoridade.esgotar();
      if (r.ok) this.evidencia.emitir("sold_out_reconciliation", { minted: resumo.total.minted, paid_supply: resumo.total.paid_supply, available: resumo.total.available, reserved: resumo.total.reserved });
    }
    return { status: "CONFIRMED", txId: assinatura };
  }

  progresso() { return this.estoque.resumo(); }

  /** Onboarding do holder: só o que é verdade agora. */
  onboarding(carteira: string) {
    const tiers = this.donos.get(carteira) ?? [];
    return {
      tiers, founder: tiers.length > 0,
      janelaPremium: janelaPremium(this.cfg, this.encerramentoOficial),
      beneficios: tiers.length ? beneficiosPublicaveis(tiers[0]) : [],
      regraPremium: "36 meses a partir do encerramento oficial da venda",
    };
  }

  elegibilidadeDe(id: string) {
    const i = this.inscricoes.find((x) => x.id === id);
    return i ? avaliar(i, this.cfg) : null;
  }
}
