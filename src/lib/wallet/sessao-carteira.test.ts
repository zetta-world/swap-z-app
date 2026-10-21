import { describe, expect, it } from "vitest";
import { MARCADOR_CONECTAR, pedidoDeConexao, sessaoDeOutraCarteira, urlBrowsePhantom } from "@/lib/wallet/sessao-carteira";

const A = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const X = "0xAbCdEf0000000000000000000000000000000001";

describe("W4 · deeplink da Phantom (formato oficial + pedido de conexão)", () => {
  it("usa `phantom.com/ul/browse/<url>?ref=<ref>` (sem /v1) e leva o marcador na URL de destino", () => {
    const u = urlBrowsePhantom("https://swap-z-app.vercel.app/swap?x=1", "https://swap-z-app.vercel.app");
    expect(u.startsWith("https://phantom.com/ul/browse/")).toBe(true);
    const alvo = decodeURIComponent(u.slice("https://phantom.com/ul/browse/".length).split("?ref=")[0]);
    expect(alvo).toBe(`https://swap-z-app.vercel.app/swap?x=1&${MARCADOR_CONECTAR}=phantom`);
    expect(u.endsWith(`?ref=${encodeURIComponent("https://swap-z-app.vercel.app")}`)).toBe(true);
  });
  it("na chegada, detecta o pedido e devolve a URL limpa (sem repetir o pedido no reload)", () => {
    expect(pedidoDeConexao(`https://z.app/swap?x=1&${MARCADOR_CONECTAR}=phantom`)).toEqual({ pedido: true, limpa: "https://z.app/swap?x=1" });
    expect(pedidoDeConexao("https://z.app/swap?x=1")).toEqual({ pedido: false, limpa: "https://z.app/swap?x=1" });
  });
});

describe("W4 · sessão de A nunca vale para B", () => {
  it("Phantom trocou de A para B com sessão de A → encerra", () => {
    expect(sessaoDeOutraCarteira(A, { solana: B, evm: null })).toBe(true);
  });
  it("mesma carteira → mantém", () => {
    expect(sessaoDeOutraCarteira(A, { solana: A, evm: null })).toBe(false);
  });
  it("sem carteira conectada (reconexão desligada) → mantém a sessão", () => {
    expect(sessaoDeOutraCarteira(A, { solana: null, evm: null })).toBe(false);
  });
  it("Solana A + EVM X conectadas, sessão EVM X → mantém (identidades separadas)", () => {
    expect(sessaoDeOutraCarteira(X, { solana: A, evm: X.toLowerCase() })).toBe(false);
  });
  it("sessão EVM X, EVM trocada para outra conta → encerra", () => {
    expect(sessaoDeOutraCarteira(X, { solana: null, evm: "0x" + "1".repeat(40) })).toBe(true);
  });
  it("sessão Solana A com só EVM conectada → mantém", () => {
    expect(sessaoDeOutraCarteira(A, { solana: null, evm: X })).toBe(false);
  });
  it("sem sessão → nada a encerrar", () => {
    expect(sessaoDeOutraCarteira(null, { solana: B, evm: X })).toBe(false);
  });
});
