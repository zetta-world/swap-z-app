/**
 * W3-D (21/10) — reconciliação financeira pela assinatura pública. Transações FICTÍCIAS no formato
 * `jsonParsed` do RPC; nada vai à rede.
 */
import { describe, expect, it } from "vitest";
import { avaliarTransacao, colunasDaVerificacao, verificarOperacaoSolana, PRAZO_SEM_REGISTRO_MS, type TxParseada } from "@/lib/solana/reconciliacao";
import { resumirVerificacao, MINT_USDC, MINT_WSOL } from "@/lib/admin/atribuicao";

const PAGADOR = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const DONO_TAXA = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const CONTA_USDC = "En1J8udXpzyAwuziqdpWWHvHV7p95RG1b2iAgpcvxNuo";
const CONTA_WSOL = "7PPDQWck54V79XwgThz9hcPJQTwWbRT8aP4TV9iT5qFW";
const JUP = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const CONTAS = [CONTA_USDC, CONTA_WSOL];

function tx(o: { err?: unknown; pagador?: string; semJup?: boolean; pre?: string; pos?: string; donoConta?: string; semConta?: boolean } = {}): TxParseada {
  const chaves = [{ pubkey: o.pagador ?? PAGADOR, signer: true }, { pubkey: "Outra111111111111111111111111111111111111111" },
    ...(o.semConta ? [] : [{ pubkey: CONTA_USDC }])];
  const bal = (a: string | undefined) => a === undefined ? [] : [{ accountIndex: 2, mint: MINT_USDC, owner: o.donoConta ?? DONO_TAXA, uiTokenAmount: { amount: a } }];
  return {
    meta: { err: "err" in o ? o.err : null, preTokenBalances: bal(o.pre), postTokenBalances: bal(o.pos) },
    transaction: { message: { accountKeys: chaves, instructions: [{ programId: "ComputeBudget111111111111111111111111111111" }, ...(o.semJup ? [] : [{ programId: JUP }])] } },
  };
}
const esp = { carteira: PAGADOR, taxaDeclarada: true };

describe("avaliarTransacao — estado financeiro medido na rede", () => {
  it("swap pousou sem erro, pagador certo, taxa chegou à conta USDC → verificada, com a taxa MEDIDA", () => {
    expect(avaliarTransacao(tx({ pre: "5000000", pos: "5011000" }), esp, CONTAS))
      .toEqual({ verificacao: "verificada_onchain", pagador: PAGADOR, taxaRaw: "11000", taxaMint: MINT_USDC });
  });
  it("conta de taxa criada na própria transação (sem saldo anterior) → delta = saldo final", () => {
    expect(avaliarTransacao(tx({ pos: "11000" }), esp, CONTAS)).toMatchObject({ verificacao: "verificada_onchain", taxaRaw: "11000" });
  });
  it("não encontrada → aguardando (nada inventado)", () => {
    expect(avaliarTransacao(null, esp, CONTAS)).toEqual({ verificacao: "aguardando", motivo: "sem_registro" });
  });
  it("pousou COM erro → divergente: falhou_na_rede", () => {
    expect(avaliarTransacao(tx({ err: { InstructionError: [1, "x"] } }), esp, CONTAS)).toMatchObject({ verificacao: "divergente", motivo: "falhou_na_rede" });
  });
  it("⚠️ `err` ausente NÃO é sucesso", () => {
    const t = tx(); delete (t.meta as { err?: unknown }).err;
    expect(avaliarTransacao(t, esp, CONTAS)).toMatchObject({ verificacao: "aguardando" });
  });
  it("outro pagador → divergente: pagador", () => {
    expect(avaliarTransacao(tx({ pagador: "Fh8nWt7QBhLNGjSSHB3oZqfLSWBRHmwH4TrjYH4Wrn6L", pre: "0", pos: "1" }), esp, CONTAS))
      .toMatchObject({ verificacao: "divergente", motivo: "pagador" });
  });
  it("não é swap da Jupiter → divergente", () => {
    expect(avaliarTransacao(tx({ semJup: true }), esp, CONTAS)).toMatchObject({ verificacao: "divergente", motivo: "nao_e_swap_jupiter" });
  });
  it("⚠️ taxa DECLARADA que não chegou à conta → divergente", () => {
    expect(avaliarTransacao(tx({ semConta: true }), esp, CONTAS)).toMatchObject({ verificacao: "divergente", motivo: "taxa_declarada_nao_recebida" });
  });
  it("sem taxa declarada (par sem USDC/SOL, tier 0) e nada recebido → verificada com taxa 0", () => {
    expect(avaliarTransacao(tx({ semConta: true }), { carteira: PAGADOR, taxaDeclarada: false }, CONTAS))
      .toMatchObject({ verificacao: "verificada_onchain", taxaRaw: "0", taxaMint: null });
  });
  it("⚠️ pagador é o DONO das contas de taxa → receita 0 (o delta inclui o próprio swap), com motivo", () => {
    expect(avaliarTransacao(tx({ pagador: DONO_TAXA, pre: "0", pos: "9000000" }), { carteira: DONO_TAXA, taxaDeclarada: true }, CONTAS))
      .toEqual({ verificacao: "verificada_onchain", pagador: DONO_TAXA, taxaRaw: "0", taxaMint: null, motivo: "pagador_e_dono_da_conta_de_taxa" });
  });
});

describe("verificarOperacaoSolana", () => {
  it("RPC fora → aguardando (nunca verificada nem divergente por acidente)", async () => {
    const v = await verificarOperacaoSolana("s", esp, { ler: async () => { throw new Error("down"); } });
    expect(v).toEqual({ verificacao: "aguardando", motivo: "rpc_indisponivel" });
  });
  it("sem registro depois do prazo → divergente: sem_registro_onchain", async () => {
    const v = await verificarOperacaoSolana("s", { ...esp, criadaEm: 0 }, { ler: async () => null, agora: PRAZO_SEM_REGISTRO_MS + 1 });
    expect(v).toMatchObject({ verificacao: "divergente", motivo: "sem_registro_onchain" });
  });
  it("sem registro dentro do prazo → aguardando", async () => {
    const v = await verificarOperacaoSolana("s", { ...esp, criadaEm: 0 }, { ler: async () => null, agora: 1000 });
    expect(v.verificacao).toBe("aguardando");
  });
  it("colunas: verificada grava medição completa; aguardando não grava veredito", () => {
    expect(colunasDaVerificacao({ verificacao: "verificada_onchain", pagador: PAGADOR, taxaRaw: "5", taxaMint: MINT_USDC }, "T"))
      .toEqual({ verificacao: "verificada_onchain", verificacao_motivo: null, verificada_em: "T", pagador_onchain: PAGADOR, taxa_onchain_raw: "5", taxa_onchain_mint: MINT_USDC });
    expect(colunasDaVerificacao({ verificacao: "aguardando", motivo: "x" })).toEqual({ verificacao: "aguardando", verificacao_motivo: "x" });
  });
});

describe("resumirVerificacao — duas dimensões sem mistura", () => {
  it("separa verificado × aguardando × divergente × declarado, e identidade à parte", () => {
    const r = resumirVerificacao([
      { verificacao: "verificada_onchain", pagador_onchain: PAGADOR, taxa_onchain_raw: "11000", taxa_onchain_mint: MINT_USDC, wallet_address: null },
      { verificacao: "verificada_onchain", pagador_onchain: PAGADOR, taxa_onchain_raw: "500000", taxa_onchain_mint: MINT_WSOL, wallet_address: PAGADOR },
      { verificacao: "aguardando", wallet_address: PAGADOR, platform_fee_usd: 1 },
      { verificacao: "divergente", verificacao_motivo: "pagador", wallet_address: null },
      { verificacao: "declarada", wallet_address: "0xabc", platform_fee_usd: 0.5 },
      { wallet_address: null, platform_fee_usd: 2 },
    ]);
    expect(r.financeiro.verificada).toEqual({ operacoes: 2, taxaUsdc: 0.011, taxaWsolLamports: "500000", outrosMints: 0, autoTaxa: 0 });
    expect(r.financeiro.aguardando).toBe(1);
    expect(r.financeiro.divergente).toEqual({ operacoes: 1, motivos: { pagador: 1 } });
    // ⚠️ o declarado NÃO entra no verificado; o aguardando também não
    expect(r.financeiro.declarada).toEqual({ operacoes: 2, taxaDeclaradaUsd: 2.5 });
    expect(r.identidade).toEqual({ origemComprovada: 2, autenticada: 2, naoAtribuida: 2 });
  });
});
