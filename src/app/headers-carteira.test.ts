import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * OS HEADERS QUE A CARTEIRA PRECISA — e o que apertá-los custa.
 *
 * ⚠️⚠️ A CICATRIZ (18/08). O `next.config.mjs` servia
 * `Cross-Origin-Opener-Policy: same-origin`, e com isso a **Coinbase Smart
 * Wallet nunca funcionou**. O popup abre em `keys.coinbase.com`, o usuário
 * conecta, e na volta a tela diz:
 *
 *   "Esse aplicativo não é compatível com carteiras inteligentes.
 *    O problema é que window.opener está inacessível."
 *
 * A trava cortava nos DOIS sentidos. O objetivo era impedir que outros sites
 * mexessem na nossa janela; o efeito colateral foi impedir que um popup que NÓS
 * abrimos mantivesse o canal de volta — que é o fluxo inteiro de assinatura.
 *
 * ⚠️ E NINGUÉM SOUBE POR SEMANAS. O header entrou num commit de endurecimento
 * de segurança, o CI ficou verde, e nada no repositório conecta carteira. Um
 * meio de conexão morreu sem produzir um único erro em log nosso — o defeito só
 * existe no navegador do usuário, e só aparece se alguém clicar. O dono achou
 * por acaso, testando outra coisa (o override do axios).
 *
 * ⚠️ POR QUE ISTO É UM TESTE E NÃO UM COMENTÁRIO. O valor "seguro" é o que
 * qualquer varredura de segurança vai recomendar, e a próxima pessoa que ler
 * "same-origin-allow-popups" vai querer apertar. Sem este teste, apertar é uma
 * linha e a consequência é invisível até um usuário reclamar. Com ele, apertar
 * falha no CI com a explicação junto.
 */

const config = readFileSync("next.config.mjs", "utf8");

/** O valor de um header, lido do config como ele é servido. */
function header(nome: string): string | null {
  const re = new RegExp(`key:\\s*"${nome}"\\s*,\\s*value:\\s*"([^"]+)"`);
  return re.exec(config)?.[1] ?? null;
}

/**
 * ⚠️ `readdirSync` recursivo, e não `fs.globSync`: o glob do Node ainda é
 * EXPERIMENTAL e avisa que pode mudar a qualquer momento. Teste que depende de
 * API instável falha por motivo errado — e este repositório já usa esta mesma
 * varredura em `read-safety.test.ts` e `botoes-distintos.test.ts`.
 */
function fontes(dir = "src", out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) fontes(caminho, out);
    else if (/\.tsx?$/.test(nome) && !nome.includes(".test.")) out.push(caminho);
  }
  return out;
}

describe("os headers que a carteira precisa", () => {
  /**
   * ⚠️ O TESTE CENTRAL. `same-origin` mata o popup de assinatura; a única
   * variante que preserva o fluxo é `same-origin-allow-popups`.
   */
  it("COOP permite popups — senão a Smart Wallet não devolve a assinatura", () => {
    const coop = header("Cross-Origin-Opener-Policy");
    expect(coop, "o header COOP sumiu do next.config").not.toBeNull();
    expect(
      coop,
      'COOP "same-origin" quebra a Coinbase Smart Wallet: o popup conecta e não '
        + "consegue devolver a assinatura porque window.opener fica inacessível. "
        + 'Use "same-origin-allow-popups" — ele mantém a proteção que importa '
        + "(quem ABRE a gente segue sem acesso à nossa janela) e libera só o que "
        + "nós mesmos abrimos.",
    ).toBe("same-origin-allow-popups");
  });

  /**
   * ⚠️ O QUE A TROCA CUSTOU, FIXADO. Relaxar a COOP derruba
   * `crossOriginIsolated`, o que desliga `SharedArrayBuffer` e timers de alta
   * resolução. Isso foi MEDIDO antes de trocar: nenhum uso em `src/`.
   *
   * Se algum dia alguém precisar de `SharedArrayBuffer`, este teste falha e
   * força a conversa — em vez de a pessoa descobrir na execução que a API não
   * existe e não entender por quê. As duas decisões são incompatíveis, e o
   * lugar de descobrir isso é aqui.
   */
  it("nada no código depende de crossOriginIsolated", () => {
    const culpados = fontes().filter((f) => {
      const src = readFileSync(f, "utf8");
      // O comentário de `cex/keystore.ts` cita SharedArrayBuffer sem usar.
      return /\bnew SharedArrayBuffer\b|\bAtomics\.\w|\bcrossOriginIsolated\b/.test(src);
    });
    expect(
      culpados,
      "algo passou a depender de isolamento cross-origin — isso é incompatível "
        + "com o COOP que a Smart Wallet exige. Decidir qual dos dois fica.",
    ).toEqual([]);
  });

  /**
   * ⚠️ O RESTO DO ENDURECIMENTO CONTINUA. Relaxar a COOP não é desculpa para
   * afrouxar o que não estava no caminho do popup — este teste separa o que
   * mudou por necessidade do que não pode mudar por descuido.
   */
  it("as outras travas de origem seguem no lugar", () => {
    expect(header("Cross-Origin-Embedder-Policy")).toBe("credentialless");
    expect(header("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(header("X-Frame-Options")).toBe("DENY");
    expect(header("Origin-Agent-Cluster")).toBe("?1");
    expect(header("Strict-Transport-Security")).toContain("preload");
  });
});
