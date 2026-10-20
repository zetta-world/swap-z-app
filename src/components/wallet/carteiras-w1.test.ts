/**
 * W1 (20/10) — conexão de carteiras no celular e travas de arquitetura.
 *
 * Defeito confirmado: o botão "+" (adicionar a 2ª carteira) era `hidden sm:inline-flex` — no
 * navegador da Phantom (≈360 px) quem conectava só Solana não tinha como conectar EVM.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const s = vi.hoisted(() => ({ evm: false, sol: false }));
vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: s.evm, address: s.evm ? "0x" + "a".repeat(40) : undefined }) }));
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => ({ connected: s.sol, publicKey: s.sol ? { toBase58: () => "H7zw" } : null }) }));
vi.mock("@/components/wallet/ConnectModal", () => ({ default: () => null }));
vi.mock("@/components/wallet/AccountMenu", () => ({ default: () => createElement("span", null, "[EVM]") }));
vi.mock("@/components/wallet/SolanaAccountChip", () => ({ default: () => createElement("span", null, "[SOL]") }));
vi.mock("@/lib/i18n", () => ({ useT: () => (k: string) => k }));
// No SSR o `useEffect` não roda e o botão ficaria em "montando": simula o estado já montado
// (o `open` do modal também vira true, mas o modal está mockado).
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()),
  useState: (inicial: unknown) => [inicial === false ? true : inicial, () => {}] }));

import ConnectButton from "@/components/wallet/ConnectButton";

const render = () => renderToStaticMarkup(createElement(ConnectButton));
const botaoMais = (html: string) => html.match(/<button[^>]*data-testid="add-second-wallet"[^>]*>/)?.[0] ?? null;
beforeEach(() => { s.evm = false; s.sol = false; });

describe("botão + (2ª carteira) aparece no CELULAR", () => {
  it("só Solana conectada: chip Solana + botão 'adicionar EVM' SEM classe que esconda no celular", () => {
    s.sol = true;
    const html = render();
    expect(html).toContain("[SOL]");
    const b = botaoMais(html);
    expect(b).not.toBeNull();
    expect(b).not.toMatch(/(^|\s|")hidden(\s|")/);
    expect(b).toContain('aria-label="topbar.addEvmWallet"');
  });

  it("só EVM conectada: botão 'adicionar Solana' visível", () => {
    s.evm = true;
    const b = botaoMais(render());
    expect(b).not.toBeNull();
    expect(b).not.toMatch(/(^|\s|")hidden(\s|")/);
    expect(b).toContain('aria-label="topbar.addSolanaWallet"');
  });

  it("as duas conectadas: os dois chips, sem botão +", () => {
    s.evm = true; s.sol = true;
    const html = render();
    expect(html).toContain("[EVM]");
    expect(html).toContain("[SOL]");
    expect(botaoMais(html)).toBeNull();
  });

  it("nenhuma: botão Conectar", () => {
    expect(render()).toContain("topbar.connectWallet");
  });
});

/** Arquivos .ts/.tsx de `src`, fora testes. */
function fontes(dir = path.resolve(__dirname, "../..")): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return fontes(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const ler = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("travas de arquitetura (W1)", () => {
  it("nenhum código de NAVEGADOR lê saldo direto de RPC (o RPC público dá 403 a navegador)", () => {
    const ofensores = fontes().filter((f) => {
      const t = readFileSync(f, "utf8");
      if (!t.startsWith('"use client"')) return false;
      return /\.(getBalance|getParsedTokenAccountsByOwner|getTokenAccountsByOwner)\(/.test(t);
    }).map((f) => path.relative(process.cwd(), f));
    expect(ofensores).toEqual([]);
  });

  it("a credencial Helius nunca é pública: nenhum NEXT_PUBLIC_HELIUS em lugar nenhum", () => {
    const comHeliusPublico = fontes().filter((f) => /NEXT_PUBLIC_HELIUS/.test(readFileSync(f, "utf8")));
    expect(comHeliusPublico).toEqual([]);
    expect(ler("lib/solana/saldos.ts")).not.toMatch(/^"use client"/);
  });

  it("25%/50%/MAX só com saldo LIDO (saldoPronto) — nunca com saldo desconhecido", () => {
    const swap = ler("components/swap/SwapCard.tsx");
    expect(swap).toContain("{editable && onPercent && saldoPronto(balance) && (");
    expect(swap).toContain("if (!saldoPronto(fromBalance) || !fromToken) return;");
  });

  it("os menus dizem a família: 'Phantom · Solana' e '<carteira> · EVM', e explicam os dois endereços", () => {
    const chip = ler("components/wallet/SolanaAccountChip.tsx");
    const evm = ler("components/wallet/AccountMenu.tsx");
    expect(chip).toContain("{wallet?.adapter.name ?? t(\"common.connected\")} · Solana");
    expect(evm).toContain("· EVM</div>");
    expect(chip).toContain('t("topbar.balanceSeparate")');
    expect(evm).toContain('t("topbar.balanceSeparate")');
  });

  it("o chip Solana usa a MESMA leitura do Swap/Portfólio (useTokenBalance), não um RPC próprio", () => {
    const chip = ler("components/wallet/SolanaAccountChip.tsx");
    expect(chip).toContain("useTokenBalance(SOL, null)");
    expect(chip).not.toContain("useConnection");
  });

  it("Solana não entra no switchChain do wagmi (só redes EVM)", () => {
    expect(ler("components/wallet/AccountMenu.tsx")).toContain("CHAINS.filter((c) => c.evm && !c.comingSoon)");
  });
});
