import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { VARIAVEIS, avaliarAmbiente, faltandoPorNome, presente } from "./server-env";
import { checkRequiredServerEnv } from "@/lib/admin/audit";

const RAIZ = process.cwd();

function arquivosTs(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivosTs(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
const FONTES = arquivosTs(join(RAIZ, "src")).map((p) => ({ p, s: readFileSync(p, "utf8") }));

const CHEIO: Record<string, string> = Object.fromEntries(
  VARIAVEIS.map((v) => [v.nome, `valor-sintetico-${v.nome.toLowerCase()}-0123456789abcdef`]),
);

describe("catálogo de env do release — amarrado ao código", () => {
  it("nomes únicos, escopo válido", () => {
    const nomes = VARIAVEIS.map((v) => v.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const v of VARIAVEIS) expect(["release", "public_gate"]).toContain(v.escopo);
  });

  it("cada variável é lida no arquivo de evidência (process.env.NOME ou env.NOME com env = process.env)", () => {
    for (const v of VARIAVEIS) {
      const s = readFileSync(join(RAIZ, v.evidencia), "utf8");
      expect(new RegExp(`\\benv\\.${v.nome}\\b`).test(s), `${v.nome} em ${v.evidencia}`).toBe(true);
    }
  });

  it("toda env cuja ausência LANÇA server_configuration_error está no catálogo com escopo release (classe RB-01)", () => {
    const achadas = new Set<string>();
    for (const { s } of FONTES) {
      const linhas = s.split("\n");
      linhas.forEach((l, i) => {
        const m = /process\.env\.([A-Z][A-Z0-9_]+)/.exec(l);
        if (!m) return;
        const janela = linhas.slice(i, i + 6).join("\n");
        if (/throw new Error\(\s*["'`]server_configuration_error/.test(janela)) achadas.add(m[1]);
      });
    }
    expect(achadas.size).toBeGreaterThan(0);
    const release = new Set(VARIAVEIS.filter((v) => v.escopo === "release").map((v) => v.nome));
    for (const n of achadas) expect(release.has(n), `${n} lança server_configuration_error mas não está no catálogo`).toBe(true);
  });

  it("CEX_RECOVERY_HMAC_KEY é release e marcada como nova no alvo (R-02)", () => {
    const v = VARIAVEIS.find((x) => x.nome === "CEX_RECOVERY_HMAC_KEY");
    expect(v?.escopo).toBe("release");
    expect(v?.novaNoAlvo).toBe(true);
  });
});

describe("avaliarAmbiente — só nomes, nunca valores", () => {
  it("ambiente completo: nada ausente", () => {
    expect(avaliarAmbiente("release", CHEIO).ausentes).toEqual([]);
    expect(avaliarAmbiente("public_gate", CHEIO).ausentes).toEqual([]);
  });

  it("sem CEX_RECOVERY_HMAC_KEY: ausente por nome", () => {
    const env = { ...CHEIO, CEX_RECOVERY_HMAC_KEY: undefined };
    expect(avaliarAmbiente("release", env).ausentes).toEqual(["CEX_RECOVERY_HMAC_KEY"]);
  });

  it("vazio, só espaço e abaixo do mínimo contam como ausentes", () => {
    const v = VARIAVEIS.find((x) => x.nome === "AUTH_JWT_SECRET")!;
    expect(presente(v, "")).toBe(false);
    expect(presente(v, "   ")).toBe(false);
    expect(presente(v, "x".repeat(15))).toBe(false);
    expect(presente(v, "x".repeat(16))).toBe(true);
  });

  it("o resultado não contém nenhum valor", () => {
    const r = JSON.stringify([avaliarAmbiente("release", CHEIO), avaliarAmbiente("public_gate", CHEIO)]);
    for (const valor of Object.values(CHEIO)) expect(r).not.toContain(valor);
  });

  it("faltandoPorNome: lista do hospedado sem valores", () => {
    const nomes = VARIAVEIS.filter((v) => v.escopo === "release" && v.nome !== "CEX_RECOVERY_HMAC_KEY").map((v) => v.nome);
    expect(faltandoPorNome("release", nomes)).toEqual(["CEX_RECOVERY_HMAC_KEY"]);
    expect(faltandoPorNome("release", [...nomes, " CEX_RECOVERY_HMAC_KEY "])).toEqual([]);
  });
});

describe("check de auditoria admin required_server_env", () => {
  it("passa com tudo presente e não expõe valor", () => {
    const f = checkRequiredServerEnv(CHEIO);
    expect(f.pass).toBe(true);
    for (const valor of Object.values(CHEIO)) expect(JSON.stringify(f)).not.toContain(valor);
  });

  it("reprova e nomeia a ausente; gate aberto não reprova o release", () => {
    const env = { ...CHEIO, CEX_RECOVERY_HMAC_KEY: undefined, EARLY_ACCESS_HMAC_SECRET: undefined };
    const f = checkRequiredServerEnv(env);
    expect(f.pass).toBe(false);
    expect(f.detail).toContain("CEX_RECOVERY_HMAC_KEY");
    expect(f.detail).not.toContain("AUSENTES: CEX_RECOVERY_HMAC_KEY, EARLY_ACCESS");
    const soGate = checkRequiredServerEnv({ ...CHEIO, EARLY_ACCESS_HMAC_SECRET: undefined });
    expect(soGate.pass).toBe(true);
  });
});

describe("scripts/release/check-env-names.mjs", () => {
  const cli = join(RAIZ, "scripts/release/check-env-names.mjs");
  const rodar = (conteudo: string, ...extra: string[]) => {
    const d = mkdtempSync(join(tmpdir(), "envnames-"));
    const f = join(d, "nomes.txt");
    writeFileSync(f, conteudo);
    return spawnSync(process.execPath, [cli, ...extra, f], { encoding: "utf8" });
  };

  it("exit 1 e nome ausente quando falta a chave nova", () => {
    const nomes = VARIAVEIS.filter((v) => v.escopo === "release" && v.nome !== "CEX_RECOVERY_HMAC_KEY").map((v) => v.nome);
    const r = rodar(nomes.join("\n"));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("AUSENTE  CEX_RECOVERY_HMAC_KEY");
  });

  it("exit 0 com todas", () => {
    const r = rodar(VARIAVEIS.filter((v) => v.escopo === "release").map((v) => v.nome).join("\n"));
    expect(r.status).toBe(0);
  });

  it("recusa entrada com valor (exit 2) e não ecoa o valor", () => {
    const r = rodar("CRON_SECRET=nao-deveria-estar-aqui\n");
    expect(r.status).toBe(2);
    expect(r.stdout + r.stderr).not.toContain("nao-deveria-estar-aqui");
  });
});
