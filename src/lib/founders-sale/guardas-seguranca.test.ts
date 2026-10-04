import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_APROVADA, validarConfig } from "./config";
import { ServicoDaVenda } from "./servico";
import { ProvedorReferenciaFixo } from "./preco";
import { MintFalso } from "./mint-falso";
import { CadeiaFalsa, REDE_DA_VENDA } from "./carteira";
import { FOUNDERS_PRICE_STATUS } from "@/lib/pricing/plans";

/**
 * TRAVAS DE SEGURANÇA DA VENDA FOUNDERS (fase 17). Escopo: código Founders (`src/lib/founders-sale`,
 * `src/components/founders`, rota de prévia). Docs ficam fora (auditorias citam o legado como evidência).
 * `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF` como trava, não promessa.
 */
const RAIZ = process.cwd();
function fontes(dir: string, out: Array<{ p: string; s: string }> = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) fontes(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push({ p: p.replace(RAIZ + "/", ""), s: readFileSync(p, "utf8") });
  }
  return out;
}
const CODIGO = [
  ...fontes(join(RAIZ, "src/lib/founders-sale")),
  ...fontes(join(RAIZ, "src/components/founders")),
  ...fontes(join(RAIZ, "src/app/(plataforma)/founders-pass")),
];
const achados = (re: RegExp) => CODIGO.filter((f) => re.test(f.s)).map((f) => f.p);

describe("Founders — nada real pode ser acionado", () => {
  it("há código para varrer", () => expect(CODIGO.length).toBeGreaterThan(15));
  it("sem conexão a mainnet / RPC real / URL de rede", () => {
    expect(achados(/mainnet-beta|api\.mainnet|devnet\.solana\.com|helius-rpc|rpc\.ankr|quiknode|https?:\/\/[a-z0-9.-]+\.(com|io|net|org|xyz)/i)).toEqual([]);
  });
  it("sem SDK de chain, provedor de mint real, oráculo de produção ou chave", () => {
    expect(achados(/@solana\/web3\.js|@metaplex|@solana\/spl|umi-bundle|pyth|switchboard|Keypair|secretKey|fromSecretKey|PRIVATE KEY|mnemonic|seed phrase/i)).toEqual([]);
    expect(achados(/process\.env\.(?!FOUNDERS_SALE_PREVIEW\b)[A-Z_]+/)).toEqual([]);
  });
  it("sem chamada de rede no domínio e nos componentes", () => {
    expect(achados(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|axios/)).toEqual([]);
  });
  it("rede da venda é a falsa local; config com outra rede é recusada e o serviço não sobe", () => {
    expect(REDE_DA_VENDA).toBe("solana:localnet-fake");
    expect(CONFIG_APROVADA.rede).toBe("solana:localnet-fake");
    expect(new MintFalso().rede).toBe("FAKE_LOCAL_ONLY");
    expect(new CadeiaFalsa().rede).toBe("solana:localnet-fake");
    const cfg = { ...CONFIG_APROVADA, rede: "solana:mainnet-beta" as never };
    expect(validarConfig(cfg)).toContain("rede_nao_permitida");
    expect(() => new ServicoDaVenda({ cfg, relogio: () => 0, provedor: new ProvedorReferenciaFixo(1, () => 0) })).toThrow(/config_invalida/);
  });
  it("tesouraria sem endereço/chave no código: signatários e endereço pendentes; nenhuma string base58 longa de chave", () => {
    expect(CONFIG_APROVADA.tesouraria.signatarios.estado).toBe("PENDING_OWNER");
    expect(CONFIG_APROVADA.tesouraria.endereco.estado).toBe("PENDING_EXTERNAL");
    expect(achados(/["'`][1-9A-HJ-NP-Za-km-z]{60,90}["'`]/)).toEqual([]);
  });
  it("preço provisório nunca como final; royalty sem percentual e sem holders", () => {
    expect(CONFIG_APROVADA.statusPreco).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    expect(FOUNDERS_PRICE_STATUS).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    expect(CONFIG_APROVADA.royalty).toMatchObject({ destino: "TESOURARIA", distribuicaoAHolders: false, percentual: { estado: "PENDING_OWNER" } });
    expect(achados(/statusPreco:\s*"FINAL"|FOUNDERS_PRICE_STATUS\s*=\s*"FINAL"/)).toEqual([]);
    expect(achados(/royalty[^\n]{0,40}\b5\s?%|percentual:\s*configurado\(\s*5\b/i)).toEqual([]);
  });
  it("sem linguagem de retorno/receita a holders, governança de tesouraria, v3, julho/2026, first-come no código Founders", () => {
    expect(achados(/guaranteed (return|profit|yield)|passive income|revenue share|dividend|lucro garantido|renda passiva/i)).toEqual([]);
    expect(achados(/treasury governance|governança de tesouraria/i)).toEqual([]);
    expect(achados(/\buntil v3\b|\bor v3\b|ou até a v3/i)).toEqual([]);
    expect(achados(/July 2026|julho de 2026/i)).toEqual([]);
    expect(achados(/(?<!not )first-come/i)).toEqual([]);
  });
  it("sem progresso/esgotado fabricado: SOLD_OUT só do estado autoritativo; mocks de UI só no cenário/galeria", () => {
    const comNumeroDeVenda = achados(/mintados:\s*\d{2,}|minted:\s*\d{2,}/).filter((p) => !/galeria\.ts$|cenario-local\.ts$/.test(p));
    expect(comNumeroDeVenda).toEqual([]);
  });
});
