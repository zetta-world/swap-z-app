"use client";

import type { ReactNode } from "react";
import { exibirMetrica, type OperationalMetric } from "@/lib/admin/metrica";

/**
 * Um `adm-stat` que respeita o contrato de verdade: "—" + selo quando a fonte não respondeu,
 * PARCIAL quando é recorte, ZERO quando é zero de fato. `cor` só vale para o número `ok`.
 */
export default function StatMetrica<T>({ rotulo, m, formatar, cor, sub }: {
  rotulo: string;
  m: OperationalMetric<T> | null | undefined;
  formatar: (v: T) => string;
  cor?: string;
  sub?: ReactNode;
}) {
  const e = exibirMetrica(m, formatar);
  return (
    <div className="adm-stat" title={e.dica}>
      <span className="adm-stat-label">{rotulo}</span>
      <span className={`adm-stat-value ${e.selo ? "" : cor ?? ""}`} style={e.cor ? { color: e.cor } : undefined}>{e.texto}</span>
      {e.selo
        ? <span className="adm-stat-sub" style={{ color: e.cor ?? undefined }}>{e.selo}</span>
        : sub != null ? <span className="adm-stat-sub">{sub}</span> : null}
    </div>
  );
}
