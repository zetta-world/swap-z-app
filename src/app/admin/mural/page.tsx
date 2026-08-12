import { requireAdmin } from "@/lib/admin/require";
import MuralView from "@/components/admin/mural/MuralView";

export const metadata = { title: "Mural · Z-SWAP" };
export const dynamic = "force-dynamic";

/**
 * O MURAL — tela cheia, sem cromo, feita para ficar aberta.
 *
 * ⚠️ ROTA PRÓPRIA, e não um painel do dashboard. Um painel vive dentro de uma
 * grade com abas, cabeçalho e vizinhos disputando atenção; esta tela existe
 * para ser vista de três metros por alguém que não vai interagir com ela. São
 * usos diferentes o bastante para não caberem no mesmo layout.
 *
 * ⚠️ E ELA PASSA PELO `requireAdmin` COMO QUALQUER OUTRA. É a tela mais
 * tentadora do painel para deixar aberta ao público — mostra dinheiro, fluxo e
 * origem de acesso. Nada aqui é menos sensível por ser bonito.
 */
export default async function MuralPage() {
  await requireAdmin();
  return <MuralView />;
}
