import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * TRAVA DA ERRATA RB-02 (L-029): o runbook do ensaio citava `DCA_PAUSE_GLOBAL` e
 * um "kill-switch do autopilot" por env como controles reais — nenhum código lia
 * nenhum dos dois. Esta trava lê a seção VIGENTE de `docs/RELEASE-RUNBOOK.md`
 * (antes de "## HISTÓRICO") e exige que todo controle citado exista no código.
 */
const RAIZ = process.cwd();
const RUNBOOK = readFileSync(join(RAIZ, "docs/RELEASE-RUNBOOK.md"), "utf8").split("## HISTÓRICO")[0];
const TOKENS = Array.from(new Set(Array.from(RUNBOOK.matchAll(/`([^`\n]+)`/g), (m) => m[1].trim())));

function fontes(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) fontes(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(readFileSync(p, "utf8"));
  }
  return out;
}
const SRC = fontes(join(RAIZ, "src")).join("\n");

/** Rótulos de status do control plane e códigos externos: não são controles de runtime. */
const ROTULOS = new Set(["RELEASE_CANDIDATE", "SAFE_KNOWN_SKEW", "HOST_OPERATIONAL_REBOOT", "AGENT_INDUCED_OOM", "UNAPPROVED", "DEPLOYMENT_DISABLED"]);
/** Nomes que o runbook só pode citar para dizer que NÃO existem. */
const INEXISTENTES = new Set(["DCA_PAUSE_GLOBAL", "AUTOPILOT_GLOBAL_KILL_SWITCH"]);
const CHAVE_KV = /^(disable_[a-z_]+|maintenance_mode|pause_[a-z0-9_]+|[a-z_]+_liberado(:motivo)?|autopilot_cex_pilotos)$/;

describe("RELEASE-RUNBOOK (seção vigente): nenhum controle inventado", () => {
  it("a seção vigente existe e cita controles", () => {
    expect(TOKENS.length).toBeGreaterThan(20);
  });

  it("toda variável de ambiente citada é lida pelo código (ou é rótulo/constante de código)", () => {
    for (const t of TOKENS.filter((x) => /^[A-Z][A-Z0-9_]{3,}$/.test(x))) {
      if (ROTULOS.has(t) || INEXISTENTES.has(t)) continue;
      const lidaComoEnv = SRC.includes(`process.env.${t}`);
      const constante = new RegExp(`\\b${t}\\b`).test(SRC);
      expect(lidaComoEnv || constante, `${t} citado no runbook mas não existe no código`).toBe(true);
    }
  });

  it("nomes inexistentes só aparecem em frase que diz que não existem, e o código não os lê", () => {
    for (const n of INEXISTENTES) {
      expect(SRC.includes(`process.env.${n}`)).toBe(false);
      for (const linha of RUNBOOK.split("\n").filter((l) => l.includes(n))) {
        expect(/não existem|não são lidas/.test(linha), `linha cita ${n} sem negar: ${linha.slice(0, 120)}`).toBe(true);
      }
    }
  });

  it("toda chave de admin_kv citada existe como literal no código", () => {
    for (const t of TOKENS.filter((x) => CHAVE_KV.test(x))) {
      expect(SRC.includes(`"${t}"`), `chave ${t} citada no runbook mas não existe no código`).toBe(true);
    }
  });

  it("toda migration citada existe", () => {
    const migs = readdirSync(join(RAIZ, "supabase/migrations"));
    for (const t of TOKENS.filter((x) => /^00\d\d$/.test(x))) {
      expect(migs.some((m) => m.startsWith(`${t}_`)), `migration ${t}`).toBe(true);
    }
  });

  it("todo arquivo src/… citado existe", () => {
    for (const t of TOKENS.filter((x) => /^src\/\S+\.(ts|tsx)$/.test(x))) {
      expect(existsSync(join(RAIZ, t)), t).toBe(true);
    }
  });
});
