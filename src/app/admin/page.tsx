import Link from "next/link";
import { AREAS, modulosDaArea } from "@/lib/admin/areas";
import { MODULE_BY_ID } from "@/lib/admin/modules";

export const metadata = { title: "Odin Control · Z-SWAP" };

/**
 * A CASA — sete portas, e nenhuma delas é um monte.
 *
 * ⚠️ ESTA PÁGINA ERA A GRADE INTEIRA. 51 painéis de uma vez, num
 * `auto-fill minmax(400px)` sem hierarquia: tudo do mesmo tamanho, tudo com a
 * mesma importância, e a "categoria" era um chip que filtrava sem levar a
 * lugar nenhum.
 *
 * ⚠️ O QUE CADA CARTÃO MOSTRA É A PERGUNTA, não o nome. "MEDIÇÕES" não diz
 * nada a quem não construiu o sistema; *"o que o histórico diz sobre cada
 * estratégia?"* diz. É a mesma decisão do subtítulo das mesas, que o dono
 * pediu em 05/08: *"se eu mostrar a um leigo ele não vai saber o que é o quê"*.
 *
 * A grade completa continua existindo — em `/admin/area/<área>?all=1`, dentro
 * da área. Nunca mais como porta de entrada.
 */
export default function AdminPage() {
  return (
    <div style={{ padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 12, letterSpacing: "0.18em", color: "var(--adm-cyan)" }}>
          ODIN CONTROL
        </div>
        <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 2 }}>
          escolha uma área · cada painel abre em tela própria
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 12,
      }}>
        {AREAS.map((a) => {
          const ids = modulosDaArea(a.id);
          return (
            <Link
              key={a.id}
              href={`/admin/area/${a.id}`}
              style={{
                textDecoration: "none", display: "block",
                background: "var(--adm-bg-raise)",
                border: "1px solid var(--adm-border)",
                borderRadius: 8, padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{a.icon}</span>
                <span style={{ fontSize: 13, letterSpacing: "0.14em", color: "var(--adm-ink-1)" }}>
                  {a.label}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--adm-ink-4)", fontVariantNumeric: "tabular-nums" }}>
                  {ids.length}
                </span>
              </div>

              {/* A PERGUNTA, não o nome. */}
              <div style={{ fontSize: 11, color: "var(--adm-ink-3)", lineHeight: 1.6, marginTop: 6 }}>
                {a.pergunta}
              </div>

              {/* Amostra do que tem dentro — o menu diz para onde leva antes de
                  o dono gastar um clique para descobrir. */}
              <div style={{ fontSize: 10, color: "var(--adm-ink-4)", marginTop: 6, lineHeight: 1.5 }}>
                {ids.slice(0, 4).map((id) => MODULE_BY_ID[id]?.title).filter(Boolean).join(" · ")}
                {ids.length > 4 && ` · +${ids.length - 4}`}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
