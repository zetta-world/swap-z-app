import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";

/**
 * O CASCO DA PLATAFORMA — barra lateral, topo, ZION, navegação móvel.
 *
 * ⚠️ ELE EXISTE PARA O ADMIN NÃO VIVER DENTRO DELE (12/08).
 *
 * Até aqui o `AppShell` estava no layout RAIZ, então ele embrulhava TUDO —
 * inclusive `/admin`. O painel administrativo abria com a barra lateral de
 * Swap / Bridge / Pools / NFT do lado, a topbar de trader em cima e o botão do
 * ZION flutuando: duas interfaces com propósitos opostos disputando a mesma
 * tela, e a de operação sempre ganhando, porque é ela que fica na borda.
 *
 * ⚠️ E A ALTERNATIVA ERRADA ERA TENTADORA: um `if (pathname.startsWith("/admin"))
 * return children` dentro do `AppShell`. Três linhas, e recriaria o defeito que
 * esta sessão passou o dia inteiro desfazendo — um componente fingindo ser dois,
 * com a diferença escondida numa condição no meio dele.
 *
 * Grupo de rota resolve de verdade: `(plataforma)` não aparece na URL, então
 * nada muda de endereço, e `/admin` simplesmente **não é filho deste layout**.
 * Dois cascos, nenhum sabendo do outro, e o JavaScript de um não vai para o
 * outro.
 *
 * ⚠️ O QUE MORA AQUI E NÃO NO ADMIN: `useOperationSync` (dentro do `AppShell`)
 * espelha operações confirmadas para o livro. Ele acompanha a plataforma
 * porque é lá que se opera — o painel administrativo LÊ o livro, não escreve
 * nele.
 */
export default function PlataformaLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
