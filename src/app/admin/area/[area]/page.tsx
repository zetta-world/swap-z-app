import Link from "next/link";
import { notFound } from "next/navigation";
import { areaPorId, modulosDaArea } from "@/lib/admin/areas";
import { MODULE_BY_ID } from "@/lib/admin/modules";
import DashboardClient from "@/components/admin/DashboardClient";
import AvisoDaArea from "@/components/admin/AvisoDaArea";

/**
 * A ÁREA — a lista dos painéis dela, e o `ALL` como escape.
 *
 * ⚠️ O MODELO É O QUE O DONO DESCREVEU, palavra por palavra:
 *
 *   "quando escolher laboratório vai aparecer todos os itens que tem no
 *    laboratório, daí você navega no menu e escolhe o item que você quer ir e
 *    vai abrir o item com sua UI dedicada; e caso selecione a opção ALL do
 *    laboratório pode ir para a UI que rola dentro de cada área"
 *
 * Então são dois modos, e o padrão é o da LISTA:
 *
 *   · lista (padrão) — cada painel é um cartão com título e o que ele responde.
 *     Cabe na tela, não rola, e nada compete por atenção.
 *   · `?all=1`       — a grade rolável, com TODOS os painéis da área abertos.
 *     É a visão antiga, agora restrita a uma área em vez de às 51 de uma vez.
 *
 * ⚠️ O MODO VIVE NA URL, não em estado. É o que faz "manda o link" funcionar e
 * o botão voltar voltar — e o dono abre este painel no PC do escritório e no
 * celular quando viaja.
 */
export default async function AreaPage({
  params, searchParams,
}: {
  params: Promise<{ area: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { area: areaId } = await params;
  const { all } = await searchParams;
  const area = areaPorId(areaId);
  // URL digitada à mão não pode derrubar a página nem mostrar área vazia
  // fingindo que existe.
  if (!area) notFound();

  const ids = modulosDaArea(area.id);
  const modoGrade = all === "1";

  return (
    <div style={{ padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 18 }}>{area.icon}</span>
        <span style={{ fontSize: 14, letterSpacing: "0.16em", color: "var(--adm-ink-1)" }}>
          {area.label}
        </span>
        <span style={{ fontSize: 11, color: "var(--adm-ink-3)" }}>{area.pergunta}</span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <Link href={`/admin/area/${area.id}`}
                className={`adm-toggle ${modoGrade ? "" : "active"}`}
                style={{ textDecoration: "none" }}>
            LISTA
          </Link>
          {/* ⚠️ O `ALL` é escape, não padrão: é ele que produz o amontoado, e
              agora produz o amontoado de UMA área em vez do das sete. */}
          <Link href={`/admin/area/${area.id}?all=1`}
                className={`adm-toggle ${modoGrade ? "active" : ""}`}
                style={{ textDecoration: "none" }}>
            ALL ({ids.length})
          </Link>
        </div>
      </div>

      <AvisoDaArea aviso={area.aviso} areaId={area.id} />

      {modoGrade ? (
        <DashboardClient only={ids} />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: 10,
        }}>
          {ids.map((id) => {
            const m = MODULE_BY_ID[id];
            if (!m) return null;
            return (
              <Link
                key={id}
                href={`/admin/area/${area.id}/${id}`}
                style={{
                  textDecoration: "none", display: "block",
                  background: "var(--adm-bg-raise)",
                  border: "1px solid var(--adm-border)",
                  borderRadius: 6, padding: "10px 12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span>{m.icon}</span>
                  <span style={{ fontSize: 12, letterSpacing: "0.08em", color: "var(--adm-ink-1)" }}>
                    {m.title}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "var(--adm-ink-4)", lineHeight: 1.55, marginTop: 4 }}>
                  {m.subtitle}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
