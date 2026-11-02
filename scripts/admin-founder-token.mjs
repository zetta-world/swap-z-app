#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Gera a AUTORIZAÇÃO OPERACIONAL DE USO ÚNICO do SOLO FOUNDER MODE
// (docs/ADMIN-SOLO-FOUNDER-MODE.md §4). Rodar OFFLINE, na máquina do dono.
//
//   node scripts/admin-founder-token.mjs bootstrap   # ou: recovery
//
// Imprime:
//   · o TOKEN `zfb_…` — guarde só com você (gerenciador de senhas); cole UMA vez na tela;
//   · o SHA256 e a janela — vão para a Vercel (Production), NUNCA o token:
//       bootstrap → ADMIN_FOUNDER_BOOTSTRAP_SHA256 + ADMIN_FOUNDER_BOOTSTRAP_UNTIL
//       recovery  → ADMIN_FOUNDER_RECOVERY_SHA256  + ADMIN_FOUNDER_RECOVERY_UNTIL
//
// Nada é gravado em disco nem enviado pela rede. Um token usado não vale de novo (o banco
// guarda o sha256 consumido); um token não usado expira com a janela (≤ 24 h).
// ═══════════════════════════════════════════════════════════════════════════
import { createHash, randomBytes } from "node:crypto";

const proposito = process.argv[2];
if (proposito !== "bootstrap" && proposito !== "recovery") {
  console.error("uso: node scripts/admin-founder-token.mjs bootstrap|recovery");
  process.exit(2);
}
const horas = Number(process.argv[3] ?? "4");
if (!Number.isFinite(horas) || horas <= 0 || horas > 24) {
  console.error("janela em horas: 0 < h ≤ 24 (padrão 4)");
  process.exit(2);
}

const token = `zfb_${randomBytes(32).toString("base64url")}`;
const sha256 = createHash("sha256").update(token, "utf8").digest("hex");
const ate = new Date(Date.now() + horas * 3600_000).toISOString();
const prefixo = proposito === "bootstrap" ? "ADMIN_FOUNDER_BOOTSTRAP" : "ADMIN_FOUNDER_RECOVERY";

console.log(`TOKEN (só com você; cole uma vez na tela /admin-acesso/fundador):\n  ${token}\n`);
console.log("Vercel (Production) — variáveis do SERVIDOR, nunca NEXT_PUBLIC_*:");
console.log(`  ${prefixo}_SHA256=${sha256}`);
console.log(`  ${prefixo}_UNTIL=${ate}`);
