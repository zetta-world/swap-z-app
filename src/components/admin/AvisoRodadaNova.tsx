"use client";

import { useCallback, useState } from "react";
import { useAutoRefresh } from "./useAutoRefresh";
import { temRodadaNova } from "./rodada-nova";

/**
 * "HÁ UMA RODADA MAIS RECENTE QUE ESTA" — o aviso dos painéis de botão.
 *
 * ⚠️ Painel de MEDIÇÃO não recarrega sozinho, e isso é decisão, não descuido:
 * relógio ali dispararia medição de hora em hora, gastando API e gravando
 * `lab_runs` que ninguém pediu. O preço dessa decisão é a tela poder mostrar um
 * número velho como se fosse o atual — e é esse buraco que este aviso fecha.
 *
 * ⚠️ ELE AVISA, NUNCA RECARREGA. Recarregar sozinho apagaria o resultado que o
 * dono está lendo e substituiria por outro sem ele pedir. Quem decide se quer o
 * novo é ele; o trabalho daqui é garantir que ele SAIBA que existe.
 */
export default function AvisoRodadaNova({
  slugs,
  vistoEm,
}: {
  /** Slugs do laboratório que este painel mede. */
  slugs: readonly string[];
  /** `Date.now()` de quando a tela recebeu o que está mostrando. 0 = nada ainda. */
  vistoEm: number;
}) {
  const [ultima, setUltima] = useState<Record<string, string>>({});

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/lab/ultima");
      if (!res.ok) return;
      const json = await res.json() as { ultima?: Record<string, string> };
      setUltima(json.ultima ?? {});
    } catch { /* o aviso é conforto, não pode derrubar o painel */ }
  }, []);

  /**
   * ⚠️ Herda o comportamento do hook de propósito: para quando a aba esconde,
   * busca ao voltar, estrangula a rajada. Um aviso que sondasse por conta
   * própria seria a segunda política de atualização do painel — e duas
   * políticas divergem, é só questão de tempo.
   */
  useAutoRefresh({ onRefresh: carregar, intervalMs: 120_000 });

  const { nova, quandoMs } = temRodadaNova(ultima, slugs, vistoEm);
  if (!nova || quandoMs === null) return null;

  const min = Math.max(0, Math.round((Date.now() - quandoMs) / 60_000));
  const quando = new Date(quandoMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      style={{
        fontSize: 11, lineHeight: 1.6, color: "var(--adm-amber)",
        border: "1px solid var(--adm-border)", borderRadius: 4,
        padding: "4px 6px", marginBottom: 8,
      }}
    >
      ⟳ há uma rodada <b>mais recente</b> que esta — de {quando}
      {min > 0 && ` (${min} min atrás)`}.
      <div style={{ color: "var(--adm-ink-4)" }}>
        A tela mostra a rodada que <b>você</b> pediu. Rode de novo para ver a nova —
        este painel nunca troca o seu resultado sozinho.
      </div>
    </div>
  );
}
