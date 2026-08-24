"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AREAS, contagemPorArea } from "@/lib/admin/areas";

/**
 * O MENU DAS ÁREAS — a bandeja que substituiu o amontoado.
 *
 * ⚠️ POR QUE ELE EXISTE (16/08). O admin tinha 51 painéis num grid chapado
 * (`auto-fill minmax(400px)`), com chips de categoria que FILTRAVAM em vez de
 * levar a algum lugar. Vinte deles moravam na mesma categoria. O dono:
 * *"tudo amontoado (…) muita coisa ali merece sua própria UI"*.
 *
 * ⚠️ A DIFERENÇA ENTRE FILTRO E MENU não é estética. Um filtro esconde o resto
 * e mantém você na mesma tela — a página continua sendo "tudo", só que com
 * menos coisa à vista. Um menu te LEVA a um lugar, e o lugar pode ter layout
 * próprio, título próprio, respiro próprio. Era isso que faltava.
 *
 * ⚠️ E O CAMINHO É LINK DE VERDADE, não estado. O dono deixa o painel aberto
 * no PC do escritório e abre no celular quando viaja: sem URL por área, "manda
 * o link do torneio" não existe, o botão voltar não volta, e recarregar joga
 * ele no começo.
 */
export default function AreaNav() {
  const path = usePathname();
  const contagem = contagemPorArea();
  const atual = AREAS.find((a) => path?.startsWith(`/admin/area/${a.id}`))?.id ?? null;

  return (
    <nav
      aria-label="áreas do painel"
      style={{
        display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
        padding: "10px 20px 0",
      }}
    >
      <Link href="/admin" className={`adm-toggle ${path === "/admin" ? "active" : ""}`}
            style={{ textDecoration: "none" }}>
        ⌂ INÍCIO
      </Link>

      <span style={{ width: 1, height: 16, background: "var(--adm-border)", margin: "0 2px" }} />

      {AREAS.map((a) => (
        <Link
          key={a.id}
          href={`/admin/area/${a.id}`}
          title={a.pergunta}
          className={`adm-toggle ${atual === a.id ? "active" : ""}`}
          style={{ textDecoration: "none" }}
        >
          {a.icon} {a.label}
          {/* ⚠️ A CONTAGEM FICA À VISTA. Vinte painéis numa categoria só não
              apareceu do nada — foi crescendo um por vez, e nada na tela
              contava. Agora conta. */}
          <span style={{ marginLeft: 5, color: "var(--adm-ink-3)", fontSize: 11 }}>
            {contagem[a.id]}
          </span>
        </Link>
      ))}
    </nav>
  );
}
