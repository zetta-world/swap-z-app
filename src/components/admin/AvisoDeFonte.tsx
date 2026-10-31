"use client";

import { exibirMetrica, rotuloQualidade, type OperationalMetric } from "@/lib/admin/metrica";

/**
 * A linha que diz COMO o número foi obtido — e, quando não foi, que não foi.
 *
 * `ok`: só a qualidade (MEDIDO/ESTIMADO/DECLARADO…), discreta. Qualquer outro
 * estado: selo colorido + dica. Métrica ausente na resposta = INDISPONÍVEL
 * (`exibirMetrica`), nunca silêncio.
 */
export default function AvisoDeFonte({ m, rotulo }: { m: OperationalMetric<unknown> | null | undefined; rotulo?: string }) {
  const e = exibirMetrica(m, () => "");
  if (!e.selo) {
    return (
      <div title={e.dica} style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 6 }}>
        {rotulo ? `${rotulo} · ` : ""}{m ? rotuloQualidade(m.quality) : ""}
      </div>
    );
  }
  return (
    <div role={e.selo === "INDISPONÍVEL" || e.selo === "ERRO" ? "alert" : undefined} title={e.dica}
      style={{ fontSize: 11, color: e.cor ?? "var(--adm-ink-3)", marginBottom: 6, lineHeight: 1.5 }}>
      {rotulo ? `${rotulo}: ` : ""}<b>{e.selo}</b>
      {e.selo === "INDISPONÍVEL" || e.selo === "ERRO"
        ? " — não consegui ler esta fonte. Isto NÃO é zero."
        : e.selo === "PARCIAL" ? " — só parte das linhas foi lida; não é o total." : ""}
      <span style={{ color: "var(--adm-ink-4)" }}> ({e.dica})</span>
    </div>
  );
}
