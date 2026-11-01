import type { KeyboardEvent } from "react";

/**
 * R3 (Admin CC 2.0) — elemento clicável que NÃO é `<button>` (linha de tabela que abre detalhe, valor
 * que vira campo de edição, endereço que copia) precisa de TECLADO: foco, Enter e Espaço. Sem isso,
 * quem navega por teclado ou leitor de tela não alcança a ação.
 *
 * `papel: "button"` para ação sobre um elemento genérico; em `<tr>` passe `papel: null` (a linha
 * continua linha da tabela; ganha só foco e teclado). `expandido` liga `aria-expanded`.
 */
export function ativavel(
  acao: () => void,
  opcoes: { papel?: "button" | null; expandido?: boolean; rotulo?: string } = {},
) {
  const papel = opcoes.papel === undefined ? "button" : opcoes.papel;
  return {
    ...(papel ? { role: papel } : {}),
    tabIndex: 0,
    onClick: acao,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); acao(); }
    },
    ...(opcoes.expandido !== undefined ? { "aria-expanded": opcoes.expandido } : {}),
    ...(opcoes.rotulo ? { "aria-label": opcoes.rotulo } : {}),
  };
}
