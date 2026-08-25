import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️⚠️ O RISCO QUE ESTA TRAVA FECHA — e ele é de COORDENAÇÃO, não de código.
 *
 * Mais de uma sessão trabalha neste repositório, e as duas aplicam DDL no MESMO
 * banco de produção pela própria ferramenta. Em 24/08 escapou por sorte: as
 * duas entregaram no mesmo dia e só uma criou migration.
 *
 * Se as duas tivessem criado, ambas partiriam do último número que enxergavam e
 * chegariam ao MESMO. O segundo a aplicar acharia a tabela já existente, ou —
 * pior — aplicaria DDL diferente sob o mesmo nome, e o histórico do repositório
 * passaria a descrever um banco que não existe.
 *
 * ⚠️ O git NÃO pega isto: dois arquivos com nomes diferentes (`0034_a.sql` e
 * `0034_b.sql`) não são conflito para ele. Mergeia os dois, calado.
 */

const DIR = join(process.cwd(), "supabase/migrations");
const ARQUIVOS = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

function numeroDe(nome: string): number | null {
  const m = /^(\d{4})_/.exec(nome);
  return m ? Number(m[1]) : null;
}

describe("migrations — a numeração é a coordenação entre as sessões", () => {
  it("existem migrations para conferir (senão a trava é decorativa)", () => {
    // Invariante nº 33: varredura que não achou nada precisa provar que olhou.
    expect(ARQUIVOS.length).toBeGreaterThan(20);
  });

  it("toda migration segue o padrão NNNN_nome.sql", () => {
    const fora = ARQUIVOS.filter((f) => numeroDe(f) === null);
    expect(fora, "nome fora do padrão não entra na conta de duplicidade").toEqual([]);
  });

  it("⚠️⚠️ NENHUM NÚMERO REPETIDO — é isto que impede duas sessões de colidirem", () => {
    const porNumero = new Map<number, string[]>();
    for (const f of ARQUIVOS) {
      const n = numeroDe(f)!;
      porNumero.set(n, [...(porNumero.get(n) ?? []), f]);
    }
    const repetidos = [...porNumero.entries()]
      .filter(([, fs]) => fs.length > 1)
      .map(([n, fs]) => `${String(n).padStart(4, "0")}: ${fs.join(" + ")}`);

    expect(repetidos,
      "duas migrations com o mesmo número. O git NÃO pega isso — nomes diferentes "
      + "não são conflito para ele. Quem chegou depois renumera para o próximo livre, "
      + "e confere se a DDL já foi aplicada no banco antes de reaplicar.",
    ).toEqual([]);
  });

  it("a sequência não pula número", () => {
    /**
     * ⚠️ Buraco na sequência quase sempre significa migration APAGADA depois de
     * aplicada — e aí o repositório descreve um banco diferente do que existe.
     * Quem clonar do zero chega a outro estado.
     */
    const numeros = ARQUIVOS.map((f) => numeroDe(f)!).sort((a, b) => a - b);
    const buracos: string[] = [];
    for (let i = 1; i < numeros.length; i++) {
      if (numeros[i] !== numeros[i - 1] + 1) {
        buracos.push(`entre ${numeros[i - 1]} e ${numeros[i]}`);
      }
    }
    expect(buracos, "buraco na sequência sugere migration apagada depois de aplicada").toEqual([]);
  });

  it("⚠️ toda tabela criada tem RLS habilitada em ALGUMA migration", () => {
    /**
     * O padrão da casa: RLS ligada com ZERO políticas, acesso só pela service
     * key. Tabela sem `enable row level security` fica legível pela chave
     * ANÔNIMA — que o navegador tem. Seria vazamento no dia do deploy, e nada
     * na tela denunciaria.
     *
     * ⚠️ E A CONTA É SOBRE O CONJUNTO, NÃO ARQUIVO A ARQUIVO — a primeira
     * versão desta trava conferia dentro do mesmo arquivo e acusou o
     * `rate_limits` do `0008`. Fui ver: ele foi criado sem a linha em 0008 e
     * consertado em `0014_rls_rate_limits.sql`, que existe exatamente para
     * isso. O banco confirma zero tabelas com RLS desligada.
     *
     * A trava estava errada, não o código. Conserto legítimo vindo depois é o
     * caso NORMAL numa sequência de migrations — exigir tudo no mesmo arquivo
     * transformaria a trava num gerador de falso positivo, e trava que grita à
     * toa é trava que se aprende a ignorar.
     */
    const tudo = ARQUIVOS.map((f) => readFileSync(join(DIR, f), "utf8").toLowerCase()).join("\n");
    const criadas = new Map<string, string>();
    for (const f of ARQUIVOS) {
      const sql = readFileSync(join(DIR, f), "utf8").toLowerCase();
      for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z0-9_]+)/g)) {
        if (!criadas.has(m[1])) criadas.set(m[1], f);
      }
    }
    const faltando = [...criadas.entries()]
      .filter(([t]) => !new RegExp(`alter table (?:if exists )?(?:public\\.)?${t}\\s+enable row level security`).test(tudo))
      .map(([t, f]) => `${t} (criada em ${f})`);

    expect(faltando,
      "tabela sem `enable row level security` em NENHUMA migration. O padrão "
      + "desta casa é RLS ligada com ZERO políticas — sem ela a chave anônima, "
      + "que o navegador tem, lê tudo.",
    ).toEqual([]);
  });
});
