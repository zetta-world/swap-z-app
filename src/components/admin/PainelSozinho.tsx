"use client";

import Link from "next/link";
import { PANELS } from "./panel-map";
import { MODULE_BY_ID, type ModuleId } from "@/lib/admin/modules";
import { areaDoModulo } from "@/lib/admin/areas";

/**
 * O PAINEL RENDERIZADO SOZINHO, com a largura toda.
 *
 * ⚠️ POR QUE ISTO É UM COMPONENTE E NÃO `{PANELS[id]}` NA PÁGINA: a página é
 * servidor (precisa de `notFound()` e dos `params`), e o mapa é cliente — 51
 * componentes com `useState`, `useEffect` e `fetch`. A fronteira tem de existir
 * em algum lugar; aqui ela é explícita e fica com o mapa.
 *
 * ⚠️⚠️ E ESTE É O ÚNICO LUGAR QUE DETECTA A INVARIANTE Nº 32.
 *
 * `lib/admin/modules.ts` diz que um painel EXISTE; `panel-map.tsx` diz quem o
 * DESENHA. Um id declarado lá e ausente daqui compila, passa no lint, passa nos
 * 1373 testes — e a tela fica vazia. Eu cometi exatamente isso em 15/08 com o
 * painel da taxa da corretora: o dono foi procurar o botão e não achou.
 *
 * Na grade o sintoma era um buraco entre outros cartões, fácil de não ver. Aqui
 * seria a página INTEIRA em branco. Então em vez de renderizar nada, este
 * componente ACUSA — com o id, o arquivo que falta e o que fazer.
 */
export default function PainelSozinho({ id }: { id: ModuleId }) {
  const conteudo = PANELS[id];
  const m = MODULE_BY_ID[id];

  if (!conteudo) {
    const area = areaDoModulo(id);
    return (
      <div style={{
        border: "1px solid var(--adm-red)", borderRadius: 6, padding: "14px 16px",
        fontSize: 12, lineHeight: 1.7, color: "var(--adm-ink-2)",
      }}>
        <div style={{ color: "var(--adm-red)", letterSpacing: "0.1em", marginBottom: 6 }}>
          ⚠ PAINEL DECLARADO E NÃO DESENHADO
        </div>
        <div>
          O módulo <code>{id}</code>{m ? ` ("${m.title}")` : ""} existe em{" "}
          <code>lib/admin/modules.ts</code> e <b>não tem entrada</b> em{" "}
          <code>components/admin/panel-map.tsx</code>.
        </div>
        <div style={{ color: "var(--adm-ink-4)", marginTop: 6 }}>
          Isto compila, passa no lint e passa nos testes — é a invariante nº 25/32.
          O conserto é uma linha no mapa: <code>&quot;{id}&quot;: &lt;SeuPainel /&gt;,</code>
        </div>
        {area && (
          <div style={{ marginTop: 8 }}>
            <Link href={`/admin/area/${area}`} className="adm-toggle" style={{ textDecoration: "none" }}>
              ← voltar para a área
            </Link>
          </div>
        )}
      </div>
    );
  }

  /**
   * ⚠️ SEM COLUNA DE 400px. Na grade o `auto-fill minmax(400px, 1fr)` dava a
   * mesma caixa para uma tabela de sete colunas e para um número solto. Aqui o
   * painel recebe a largura disponível e decide sozinho o que fazer com ela.
   */
  return <div style={{ width: "100%" }}>{conteudo}</div>;
}
