import type { ReactNode } from "react";
import AppShell from "@/components/layout/AppShell";

/**
 * CASCO DA PRÉVIA FOUNDERS — o mesmo `AppShell` da plataforma, mas SEM o `loading.tsx` de `(plataforma)`.
 *
 * ⚠️ POR QUE UM GRUPO À PARTE (04/10, L-038): dentro de `(plataforma)` a fronteira de loading abre um Suspense
 * acima da página; o Next começa a transmitir a resposta com status 200 e o `notFound()` da porta chega tarde —
 * o corpo é o 404, mas o STATUS sai 200 (provado com `next start`). Aqui não há fronteira de loading: a porta
 * roda antes de qualquer byte e a rota fechada responde HTTP 404 de verdade. Não criar `loading.tsx` neste grupo.
 */
export default function PreviaLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
