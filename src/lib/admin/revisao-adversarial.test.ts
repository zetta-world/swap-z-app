/**
 * Regressão dos achados CONFIRMADOS da revisão adversarial do Admin CC 2.0
 * (9 achados, 8 confirmados por verificador independente). Cada `it` trava um.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ler = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("revisão adversarial — achados confirmados", () => {
  it("#1 COMMAND conta high-sev no BANCO (sem amostra de 1.000) e heartbeat ilegível não é fresco", () => {
    const c = ler("src/app/admin/api/command/route.ts");
    expect(c).toMatch(/eq\("event_type", "security"\)\.eq\("metadata->>severity", "high"\)/);
    expect(c).toMatch(/count: "exact", head: true \}\)\s*\.eq\("event_type", "security"\)/);
    expect(c).toMatch(/!Number\.isFinite\(t\) \|\|/);
    expect(c).toMatch(/agregarUsoDeIa\(ai, now\)/);
  });

  it("#2 recapitalize lê { error } de cada escrita e a rota não chama parcial de executado", () => {
    const r = ler("src/lib/paper/recapitalize.ts");
    for (const v of ["erroConta", "erroArquivo", "erroCapital", "erroMarco"]) expect(r, v).toContain(v);
    expect(ler("src/app/admin/api/paper-recap/route.ts")).toMatch(/codigo: "parcial"/);
  });

  it("#3 kill switch com valor inválido é gravável (CAS no valor bruto), desconhecido segue travado", () => {
    expect(ler("src/app/admin/api/killswitch/route.ts")).toMatch(/antes !== esperadoBruto/);
    const cli = ler("src/components/admin/interruptores-cliente.ts");
    expect(cli).toMatch(/conhecido\(e\) \|\| e === "invalido"/);
    for (const p of ["KillSwitchesPanel", "AiControlsPanel"]) {
      expect(ler(`src/components/admin/panels/${p}.tsx`), p).toMatch(/disabled=\{mutating === key \|\| !gravavel\(estado\)\}/);
    }
  });

  it("#4 CAS dos pilotos por updated_at, nunca a lista inteira na URL", () => {
    const l = ler("src/lib/autopilot/liberacao.ts");
    expect(l).toMatch(/\.eq\("updated_at", anterior\.updatedAt\)/);
    expect(l).not.toMatch(/\.eq\("value", anterior\)/);
  });

  it("#5 grant/revoke de admin só aceita endereço EVM/base58 (sem curinga de ilike); plano não apaga admin legado", () => {
    expect(ler("src/app/admin/api/admins/route.ts")).toContain("/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/");
    expect(ler("src/app/admin/api/tier/route.ts")).toMatch(/atual\?\.source === "admin"/);
  });

  it("#6 export do ledger é fotografia por chave (t0), sem offset e sem CSV parcial", () => {
    const e = ler("src/app/admin/api/ledger/export/route.ts");
    expect(e).toMatch(/\.lte\("created_at", t0\)/);
    expect(e).toContain("lerTodasPorChave");
    expect(e).not.toContain("lerTodasAsPaginas");
    expect(e).toMatch(/acima_do_teto/);
  });

  it("#8 páginas usam o ponto único", () => {
    expect(ler("src/app/admin/layout.tsx")).toContain('autorizarPaginaAdmin("shell")');
    expect(ler("src/app/admin/mural/page.tsx")).toContain('autorizarPaginaAdmin("mural")');
  });

  it("#9 o que o registro chama de durável usa comandoAuditado", () => {
    expect(ler("src/app/admin/api/ulfhednar/route.ts")).toMatch(/comandoAuditado<true>\(\{\s*acao: "agents\.mailbox\.write"/);
    expect(ler("src/app/admin/api/audit-bench/route.ts")).toMatch(/acao: "security\.bench\.run"/);
  });
});
