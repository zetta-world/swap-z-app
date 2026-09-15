/**
 * ⚠️⚠️ DESCONECTAR UMA CORRETORA DEIXAVA A CHAVE VIVA EM DOIS LUGARES.
 * Achado A15 da auditoria externa — e maior do que ele descreve.
 *
 * A credencial mora em TRÊS lugares:
 *
 *   1. keystore cifrado do navegador  — `removeExchange`, e só este era limpo;
 *   2. cofre DECIFRADO em memória     — o autopilot lê `getActive()`, e ele
 *      seguia armado por até 8 HORAS depois do "desconectado";
 *   3. cópia cifrada no SERVIDOR      — a que o CRON usa com o dono ausente,
 *      no DCA real e no autopilot de fundo.
 *
 * ⚠️⚠️ E `revogarConexao` EXISTIA, SEM NINGUÉM CHAMAR. O cabeçalho dela declara
 * em caixa alta: "REVOGAR É AQUI... É o ponto inteiro do cofre: um lugar para
 * desligar tudo que usa esta chave." Não havia rota, nem botão, nem chamada.
 *
 * ⚠️ E ELA ESCAPOU DA MINHA VARREDURA DE DUPLICIDADE porque as duas únicas
 * menções ao nome estavam DENTRO DE COMENTÁRIOS de outros arquivos — comentário
 * fez função morta parecer ligada. A varredura contava identificadores sem
 * remover comentários na contagem entre arquivos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const TELA  = semComentarios(leia("src/components/settings/CexSettings.tsx"));
const VAULT = semComentarios(leia("src/lib/cex/vault.ts"));
const MSG   = leia("src/lib/i18n/messages.ts");
const ROTA_PATH = "src/app/api/cex/revogar/route.ts";

describe("① a rota que finalmente liga `revogarConexao`", () => {
  it("⚠️⚠️ ela existe — antes a função não era chamada por NINGUÉM", () => {
    expect(existsSync(join(process.cwd(), ROTA_PATH)), `${ROTA_PATH} sumiu`).toBe(true);
  });

  it("⚠️ exige sessão e limita rajada", () => {
    const rota = semComentarios(leia(ROTA_PATH));
    expect(rota).toMatch(/const session = await getSession\(\)/);
    expect(rota).toMatch(/error: "auth_required" \}, \{ status: 401 \}/);
    expect(rota).toMatch(/rateLimitDurable\(`cex_revogar:\$\{session\.sub\}`/);
  });

  it("⚠️⚠️ revoga pela CARTEIRA DA SESSÃO, não por uma do corpo do pedido", () => {
    // Aceitar a carteira do corpo deixaria qualquer um revogar a chave alheia.
    const rota = semComentarios(leia(ROTA_PATH));
    expect(rota).toMatch(/revogarConexao\(session\.sub, exchangeId\)/);
  });

  it("⚠️⚠️ falha FECHADO e diz o que continua de pé", () => {
    const rota = semComentarios(leia(ROTA_PATH));
    expect(rota).toMatch(/if \(!revogou\)/);
    expect(rota).toMatch(/status: 500/);
    expect(leia(ROTA_PATH)).toMatch(/o robô ainda pode negociar/);
    expect(rota).toMatch(/recordEvent\("cex_revogacao_falhou"/);
  });
});

describe("② o cofre em memória esquece só a corretora desconectada", () => {
  it("⚠️⚠️ `esquecer(id)` existe — o autopilot lia `getActive()` por 8h", () => {
    expect(VAULT).toMatch(/esquecer:\s+\(id: CexId\) => void;/);
    expect(VAULT).toMatch(/esquecer: \(id\) => set\(/);
  });

  it("⚠️ é por corretora, não `lock()` — desconectar uma não tranca as outras", () => {
    expect(VAULT).toMatch(/delete resto\[id\]/);
  });

  it("⚠️⚠️ e sem nenhuma sobrando o cofre fica VAZIO, não um objeto vazio", () => {
    // `{}` faria `getActive()` devolver "destrancado" com zero credenciais.
    expect(VAULT).toMatch(/Object\.keys\(resto\)\.length === 0\s*\?\s*\{ creds: null/);
  });
});

describe("③ e a tela alcança os TRÊS lugares", () => {
  it("⚠️⚠️ desconectar limpa keystore, cofre em memória E servidor", () => {
    const i = TELA.indexOf("const onDisconnect");
    expect(i).toBeGreaterThan(0);
    const corpo = TELA.slice(i, TELA.indexOf("const onForgetAll"));
    expect(corpo).toMatch(/await removeExchange\(passphrase, id\)/);
    expect(corpo).toMatch(/useCexVault\.getState\(\)\.esquecer\(id\)/);
    expect(corpo).toMatch(/fetch\("\/api\/cex\/revogar"/);
  });

  it("⚠️⚠️ e NÃO diz 'desconectada' quando o servidor recusou", () => {
    const i = TELA.indexOf("const onDisconnect");
    const corpo = TELA.slice(i, TELA.indexOf("const onForgetAll"));
    // O sucesso mora no `else` da conferência — nunca incondicional.
    expect(corpo).toMatch(/if \(!r\.ok \|\| !j\?\.ok\) \{[\s\S]{0,200}\} else \{[\s\S]{0,160}settingsDisconnectedToast/);
    expect(corpo).not.toMatch(/\}\s*\n\s*toast\.success\(t\("cex\.settingsDisconnectedToast"/);
  });

  it("⚠️ 'esquecer tudo' tem o mesmo alcance, e nomeia o que falhou", () => {
    const corpo = TELA.slice(TELA.indexOf("const onForgetAll"));
    expect(corpo).toMatch(/forgetEverything\(\)/);
    expect(corpo).toMatch(/useCexVault\.getState\(\)\.lock\(\)/);
    expect(corpo).toMatch(/fetch\("\/api\/cex\/revogar"/);
    expect(corpo).toMatch(/if \(!falharam\.length\) toast\.success/);
  });

  it("as duas frases existem nos QUATRO locales", () => {
    expect([...MSG.matchAll(/revogacaoFalhou:/g)]).toHaveLength(4);
    expect([...MSG.matchAll(/revogacaoFalhouLista:/g)]).toHaveLength(4);
  });
});
