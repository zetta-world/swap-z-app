/**
 * CÉLULA DE CSV — escapar para o PARSER é metade do trabalho.
 *
 * ⚠️⚠️ ACHADO A29 DA AUDITORIA EXTERNA: entrada anônima chegava ao CSV
 * administrativo como FÓRMULA.
 *
 * A versão anterior citava corretamente aspas, vírgulas e quebras de linha — o
 * bastante para o arquivo ser LIDO certo. Só que Excel, Google Sheets e
 * LibreOffice não apenas leem: eles AVALIAM. Uma célula que começa com `=`,
 * `+`, `-`, `@`, TAB ou CR vira fórmula ao abrir.
 *
 * ⚠️ E O CONTEÚDO NÃO É NOSSO. `logOperation` grava `pair` vindo de cartão de
 * LLM e `route` de texto livre; `wallet_address` vem de quem se conectar. O
 * exportador entrega isso para a planilha de quem opera a plataforma — a
 * máquina com mais acesso da casa.
 *
 * O estrago não é teórico: `=HYPERLINK(…)` e `=IMPORTXML(…)` mandam o conteúdo
 * do próprio extrato para fora no primeiro clique, e o DDE (`=cmd|…`) chega a
 * executar comando em Excel antigo.
 *
 * ⚠️ POR QUE O APÓSTROFO E NÃO APAGAR O CARACTERE: a planilha precisa mostrar o
 * dado COMO ELE É. Remover o `=` falsificaria o extrato — o registro passaria a
 * dizer outra coisa que aconteceu. O apóstrofo é a marca de "isto é texto" e o
 * valor continua legível e auditável.
 */

/** Os caracteres que fazem uma planilha AVALIAR em vez de exibir. */
const ABRE_FORMULA = /^[=+\-@\t\r]/;

/**
 * O valor é um número de verdade?
 *
 * ⚠️ TAB e CR no início NÃO contam, mesmo que `Number("\t5")` dê 5: nenhum
 * número vindo do banco começa com controle, e deixá-los passar reabriria a
 * porta por um caractere que o próprio `Number` ignora.
 */
function ehNumero(s: string): boolean {
  if (s.trim() === "") return false;
  if (/^[\t\r]/.test(s)) return false;
  return Number.isFinite(Number(s));
}

export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);

  /**
   * ⚠⚠ NÚMERO NEGATIVO NÃO É FÓRMULA — e a primeira versão desta função
   * quebrou a contabilidade por não distinguir os dois (achado do revisor no
   * #433, depois de eu ter mandado para produção).
   *
   * `-` abre fórmula, então eu o pus na lista. Só que `pnl_usd` é
   * ROTINEIRAMENTE negativo: todo prejuízo do extrato virava o texto `'-53.2`,
   * ficava fora do `SUM` da planilha, e o total de quem fecha a contabilidade
   * saía errado. O arquivo existe para isso — *"ledger as CSV for accounting"*.
   *
   * ⚠️ O QUE ME ESCAPOU NA VERIFICAÇÃO: eu quebrei a trava em cinco direções e
   * todas testavam que o guarda DISPARA. Nenhuma testava que um valor legítimo
   * SOBREVIVE. Teste de um lado só não vê falso positivo.
   *
   * O critério certo não é o primeiro caractere, é o que o valor É: um número
   * finito passa inteiro; o resto que comece com abre-fórmula leva apóstrofo.
   */
  if (!ehNumero(s) && ABRE_FORMULA.test(s)) {
    /**
     * ⚠️ O apóstrofo vem ANTES do escape de aspas, e a ordem importa: colocá-lo
     * depois o deixaria fora do campo citado, onde a planilha o ignoraria.
     */
    s = `'${s}`;
  }

  /**
   * ⚠️ `\r` ENTROU NA LISTA. A versão anterior citava só `" , \n` — um valor com
   * CR sozinho saía sem aspas e quebrava a linha do CSV em leitores que tratam
   * CR como fim de registro. Escapar para o parser também estava incompleto.
   */
  return /["',\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
