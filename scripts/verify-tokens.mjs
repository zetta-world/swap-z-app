#!/usr/bin/env node
/**
 * VERIFICAÇÃO DO REGISTRO DE TOKENS contra uma fonte externa.
 *
 * POR QUE ESTE SCRIPT EXISTE (auditoria 01/08):
 *
 * `src/lib/tokens.ts` trazia, no próprio comentário, a confissão:
 *
 *     "Curated default token list for the demo. In production, this is fetched
 *      from CoinGecko / TrustWallet token lists"
 *
 * Nunca foi. Os endereços eram digitados à mão e nenhum tinha sido conferido
 * contra fonte nenhuma. E o `token-safety` que entrou dias antes NÃO cobre isso:
 * ele checa se o token é GOLPE, não se é o token CERTO. Um endereço errado ali
 * manda dinheiro para o contrato errado com todos os selos verdes acesos.
 *
 * O QUE ELE FAZ:
 *
 * Para cada token com contrato, busca `info.json` da TrustWallet no caminho por
 * ativo (não o `tokenlist.json`, que é esparso demais — arbitrum tem 6 entradas
 * lá, e tratar "ausente" como "errado" produziria alarme falso em massa) e
 * compara SÍMBOLO e DECIMAIS.
 *
 * Decimais é o campo que mais dói errado: seis casas trocadas por dezoito
 * transformam $1 em $1.000.000.000.000 na conta de notional — e a guarda de
 * impacto, que lê justamente esse número, aprovaria feliz.
 *
 * A consulta usa o endereço em EIP-55 (checksum), calculado aqui. Sem isso um
 * endereço guardado em minúsculas daria 404 e seria reportado como suspeito
 * quando o problema era só a caixa das letras.
 *
 * Uso:
 *   node scripts/verify-tokens.mjs           # relatório
 *   node scripts/verify-tokens.mjs --write   # regrava o manifesto commitado
 *
 * O manifesto (`src/lib/tokens-verified.json`) é o REGISTRO do que foi
 * conferido e quando — não um selo de segurança. "não encontrado" ali significa
 * exatamente isso, nunca "aprovado".
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "src/lib/tokens-verified.json");

/** Nossa ChainId → pasta da TrustWallet. */
const TW_FOLDER = {
  ethereum: "ethereum", bsc: "smartchain", polygon: "polygon", base: "base",
  arbitrum: "arbitrum", optimism: "optimism", avalanche: "avalanchec", solana: "solana",
};

function readRegistry() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/tokens.ts"), "utf8");
  const re = /\{\s*symbol:\s*"([^"]+)",\s*name:\s*"([^"]+)",\s*chain:\s*"([^"]+)",\s*address:\s*"([^"]+)",\s*decimals:\s*(\d+)/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    out.push({ symbol: m[1], name: m[2], chain: m[3], address: m[4], decimals: Number(m[5]) });
  }
  return out;
}

async function verify(t) {
  if (t.address === "native") return { status: "native" };
  // A chain `zetta` é mock: não existe fonte externa para conferir, e fingir que
  // existe seria o mesmo defeito que este script conserta.
  if (t.chain === "zetta") return { status: "mock_chain" };

  let addr = t.address;
  if (t.chain !== "solana") {
    try {
      addr = getAddress(t.address);
    } catch {
      return { status: "invalid_address" };
    }
  }
  const folder = TW_FOLDER[t.chain];
  if (!folder) return { status: "no_source" };

  const url = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${addr}/info.json`;
  try {
    const r = await fetch(url);
    if (r.status === 404) return { status: "not_found", checksum: addr };
    if (!r.ok) return { status: "source_error", http: r.status };
    const j = await r.json();
    const symbolOk = String(j.symbol ?? "").toUpperCase() === t.symbol.toUpperCase();
    const decimalsOk = Number(j.decimals) === t.decimals;
    if (symbolOk && decimalsOk) return { status: "verified", checksum: addr };
    return {
      status: "mismatch", checksum: addr,
      external: { symbol: j.symbol, decimals: j.decimals, name: j.name },
    };
  } catch (e) {
    return { status: "source_error", error: String(e.message ?? e) };
  }
}

const tokens = readRegistry();
const entries = [];
for (const t of tokens) {
  const v = await verify(t);
  entries.push({ chain: t.chain, symbol: t.symbol, address: t.address, decimals: t.decimals, ...v });
}

const counts = entries.reduce((a, e) => ((a[e.status] = (a[e.status] ?? 0) + 1), a), {});
console.log(`\n${tokens.length} tokens no registro\n`);
for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${k.padEnd(16)} ${n}`);

const bad = entries.filter((e) => e.status === "mismatch" || e.status === "invalid_address");
if (bad.length) {
  console.log("\n⛔ DIVERGÊNCIA — o registro discorda da fonte externa:");
  for (const e of bad) console.log(`   ${e.chain}:${e.symbol} ${e.address} → ${JSON.stringify(e.external ?? {})}`);
}
const missing = entries.filter((e) => e.status === "not_found");
if (missing.length) {
  console.log("\n◌ NÃO ENCONTRADO na fonte (≠ errado — a lista de terceiro pode não ter o ativo):");
  for (const e of missing) console.log(`   ${e.chain}:${e.symbol} ${e.address}`);
}

if (process.argv.includes("--write")) {
  // A data entra à mão no manifesto quando alguém roda com --write. Sem
  // timestamp, "verificado" viraria uma afirmação sem validade, e um registro
  // de 2026 conferido em 2025 é quase tão ruim quanto nenhum.
  const doc = { checkedAt: new Date().toISOString(), source: "trustwallet/assets", tokens: entries };
  fs.writeFileSync(MANIFEST, JSON.stringify(doc, null, 2) + "\n");
  console.log(`\n✍  manifesto gravado em ${path.relative(ROOT, MANIFEST)}`);
}

process.exit(bad.length ? 1 : 0);
